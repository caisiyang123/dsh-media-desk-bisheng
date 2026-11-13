import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  OWNER,
  VIEWS,
  WorkbenchSessions,
  createOwnershipGuard,
} from '../src/workbench.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'media-desk-workbench-'))
  return { root, sessions: new WorkbenchSessions(root) }
}

async function cleanup(root) {
  await rm(root, { recursive: true, force: true })
}

test('WorkbenchSessions 默认首页，五个视图均可持久化且会话相互隔离', async () => {
  const { root, sessions } = await fixture()
  try {
    assert.deepEqual(VIEWS, ['home', 'content', 'schedule', 'insights', 'style'])
    assert.deepEqual(await sessions.read('s1'), { revision: 0, view: 'home', focusId: null })
    let revision = 0
    for (const view of VIEWS) {
      const next = await sessions.sync('s1', { view })
      assert.equal(next.view, view)
      assert.equal(next.revision, view === 'home' ? revision : ++revision)
    }
    await sessions.sync('s2', { view: 'insights', focusId: 'item-other' })
    const reopened = new WorkbenchSessions(root)
    assert.deepEqual(await reopened.snapshot('s1'), { revision, view: 'style', focusId: null })
    assert.deepEqual(await reopened.snapshot('s2'), { revision: 1, view: 'insights', focusId: 'item-other' })
    const saved = JSON.parse(await readFile(join(root, 'workbench-sessions.json'), 'utf8'))
    assert.equal(saved.sessions.s1.view, 'style')
    assert.equal(saved.sessions.s2.focusId, 'item-other')
  } finally {
    await cleanup(root)
  }
})

test('WorkbenchSessions 只在实际变化时递增 revision，重复同步不刷版本', async () => {
  const { root, sessions } = await fixture()
  try {
    const first = await sessions.sync('s1', { view: 'content', focusId: 'item-1' })
    assert.deepEqual(first, { revision: 1, view: 'content', focusId: 'item-1' })
    assert.deepEqual(await sessions.sync('s1', { view: 'content', focusId: 'item-1' }), first)
    assert.deepEqual(await sessions.command('s1', { action: 'navigate', view: 'schedule' }), { revision: 2, view: 'schedule', focusId: 'item-1' })
    assert.deepEqual(await sessions.command('s1', { action: 'open_item', id: 'item-2' }), { revision: 3, view: 'content', focusId: 'item-2' })
    assert.deepEqual(await sessions.command('s1', { action: 'open_item', focusId: null }), { revision: 4, view: 'content', focusId: null })
  } finally {
    await cleanup(root)
  }
})

test('WorkbenchSessions 拒绝非法视图、focusId、sessionId 和未知命令，且不产生部分写入', async () => {
  const { root, sessions } = await fixture()
  try {
    const before = await sessions.sync('s1', { view: 'content', focusId: 'valid' })
    for (const view of ['settings', 'home ', '', null, 1, {}, '__proto__']) {
      await assert.rejects(sessions.sync('s1', { view }), /视图|view/, String(view))
    }
    for (const focusId of ['', ' ', 1, false, {}, [], 'x'.repeat(201)]) {
      await assert.rejects(sessions.sync('s1', { focusId }), /focusId|条目/, String(focusId))
    }
    for (const sessionId of ['', ' ', 1, false, {}, [], 'x'.repeat(201)]) {
      await assert.rejects(sessions.read(sessionId), /会话|session/, String(sessionId))
    }
    await assert.rejects(sessions.command('s1', { action: 'settings' }), /命令|action/)
    await assert.rejects(sessions.sync('s1', null), /对象|同步/)
    await assert.rejects(sessions.sync('s1', { view: 'insights', focusId: '' }), /focusId|条目/)
    assert.deepEqual(await sessions.read('s1'), before)
  } finally {
    await cleanup(root)
  }
})

test('WorkbenchSessions 同一进程并发写串行落盘，revision 连续且 JSON 可重读', async () => {
  const { root, sessions } = await fixture()
  try {
    const writes = Array.from({ length: 24 }, (_, index) => sessions.sync('shared', {
      view: 'content',
      focusId: `item-${index}`,
    }))
    const settled = await Promise.all(writes)
    assert.deepEqual(settled.map(row => row.revision), Array.from({ length: 24 }, (_, index) => index + 1))
    const reopened = new WorkbenchSessions(root)
    assert.deepEqual(await reopened.read('shared'), { revision: 24, view: 'content', focusId: 'item-23' })
    const saved = JSON.parse(await readFile(join(root, 'workbench-sessions.json'), 'utf8'))
    assert.equal(saved.sessions.shared.revision, 24)
  } finally {
    await cleanup(root)
  }
})

test('createOwnershipGuard 每次读取实时 sessionBindings，只接受精确 OWNER', async () => {
  const bindings = { owned: OWNER }
  const ctx = { desktopWorkbenchOwnership: { read: async () => ({ sessionBindings: bindings }) } }
  const own = createOwnershipGuard(ctx)
  await own('owned')
  await assert.rejects(own('foreign'), /不属于|归属/)
  await assert.rejects(own(''), /会话/)
  await assert.rejects(own(null), /会话/)
  await assert.rejects(own('toString'), /不属于|归属/)
  bindings.foreign = OWNER
  await own('foreign')
  delete bindings.owned
  await assert.rejects(own('owned'), /不属于|归属/)
  const unavailable = createOwnershipGuard({})
  await assert.rejects(unavailable('owned'), /归属|ownership/)
})
