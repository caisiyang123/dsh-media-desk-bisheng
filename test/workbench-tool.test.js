import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import hostDefault, {
  Config,
  OWNER as HOST_OWNER,
  apply,
  inject,
  name,
  requestRejection,
} from '../src/host.js'
import { applyOps } from '../src/ops.js'
import { Settings } from '../src/settings.js'
import { Store } from '../src/store.js'
import {
  ACTIONS,
  MAX_CONTEXT_CHARS,
  WORKBENCH_SYSTEM_PROMPT,
  createMediaWorkbenchTool,
} from '../src/workbench-tool.js'
import {
  OWNER,
  WorkbenchSessions,
  createOwnershipGuard,
} from '../src/workbench.js'

class FakeProducer {
  constructor(store, { canDraw = true } = {}) {
    this.store = store
    this.canDraw = canDraw
    this.live = new Map()
    this.starts = []
    this.regenerations = []
    this.cancellations = []
  }

  ready() {
    return this.canDraw
  }

  isRunning(id) {
    return this.live.has(id)
  }

  status(id) {
    return this.live.has(id) ? { running: true, stage: 'brief', text: 'progress' } : { running: false }
  }

  async start(id, { withImages } = {}) {
    if (this.live.has(id)) return false
    this.starts.push({ id, withImages })
    this.live.set(id, true)
    await this.store.mutate('fake produce', (state) => {
      const item = state.items.find(row => row.id === id)
      item.production = { status: 'running', stage: 'brief', title: item.title, article: '', cover: null, images: [], shots: [], withImages }
      return state
    }, { undoable: false })
    return true
  }

  async cancel(id) {
    this.cancellations.push(id)
    this.live.delete(id)
    await this.store.mutate('fake cancel', (state) => {
      const item = state.items.find(row => row.id === id)
      if (item?.production) item.production.status = 'cancelled'
      return state
    }, { undoable: false })
  }

  async settle(id) {
    if (this.live.has(id)) return
    await this.store.mutate('fake settle', (state) => {
      const item = state.items.find(row => row.id === id)
      if (item?.production?.status === 'running') {
        item.production.status = 'failed'
        item.production.stage = 'done'
      }
      return state
    }, { undoable: false })
  }

  async regenerate(id, target) {
    this.regenerations.push({ id, target })
  }
}

function richProduction() {
  return {
    status: 'done',
    stage: 'done',
    format: 'article',
    title: '旧标题',
    coverText: '旧封面',
    article: `开头 UNIQUE-ARTICLE\n\n${'用于修改测试的长正文。'.repeat(5000)}`,
    aiArticle: '不应重复占用上下文的旧稿',
    cover: { prompt: 'old cover', status: 'done', src: 'media-desk/files/cover.png' },
    images: [{ no: 1, caption: '图注', anchor: '第一节', prompt: 'old image', status: 'done', src: 'media-desk/files/image.png' }],
    shots: [{ no: 1, shot: '中景', visual: '旧画面', voice: '旧口播', seconds: 5, prompt: 'old shot', status: 'done' }],
    startedAt: '2026-11-01T00:00:00.000Z',
    finishedAt: '2026-11-01T00:01:00.000Z',
    savedPath: '/private-export/saved-production',
    savedAt: '2026-11-01T00:01:00.000Z',
  }
}

async function fixture({ canDraw = true, rich = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'media-desk-tool-'))
  const store = new Store(root)
  await store.read()
  await store.mutate('fixture', (state) => {
    state.items = Array.from({ length: 35 }, (_, index) => ({
      id: `item-${index}`,
      kind: 'note',
      title: `灵感 ${index}`,
      body: `正文 ${index}`,
      tags: index < 25 ? ['共同'] : [],
      status: 'idea',
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      drafts: {},
    }))
    if (rich) state.items[0].production = richProduction()
    state.styles = [
      { id: 'style-1', name: '测试风格', summary: '摘要', tone: '真诚', reference: '长参考'.repeat(1000), samples: ['样句'] },
      { id: 'style-2', name: '另一风格', summary: '另一摘要', tone: '简洁' },
    ]
    state.activeStyleId = null
    state.draftFormat = 'article'
    state.metrics = []
    state.accounts = []
    state.skills = []
    state.people = []
    state.angles = []
    state.chat = []
    return state
  }, { undoable: false })
  const workbench = new WorkbenchSessions(root)
  const bindings = { 'session-1': OWNER }
  const ctx = {
    desktopWorkbenchOwnership: { read: async () => ({ sessionBindings: bindings }) },
    get: () => undefined,
  }
  const own = createOwnershipGuard(ctx)
  const producer = new FakeProducer(store, { canDraw })
  const settings = {
    read: async () => ({
      image: { baseUrl: 'https://images.invalid/v1', model: 'secret-model', apiKey: 'sk-test-secret' },
      exportDir: '/private-export',
      assistant: { provider: 'secret-provider', model: 'secret-model' },
    }),
  }
  const harvestCalls = []
  const harvestUrl = async (url) => {
    harvestCalls.push(url)
    if (!/^https:\/\//.test(url)) throw new Error('只支持安全的公开链接')
    return {
      url,
      title: '抓取标题',
      description: '抓取简介',
      image: 'https://93.184.216.34/cover.png',
      siteName: 'example',
    }
  }
  const tool = createMediaWorkbenchTool({
    ctx,
    store,
    workbench,
    own,
    settings,
    producer,
    model: () => 'unit-model',
    harvestUrl,
  })
  const execute = (args, sessionId = 'session-1') => tool.execute(args, { agent: { session: { id: sessionId } } })
  return {
    root,
    store,
    workbench,
    bindings,
    producer,
    settings,
    tool,
    execute,
    harvestCalls,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

test('Host 与 media_workbench 符合 BISHENG 导出、动作和输出契约', async () => {
  const f = await fixture()
  try {
    assert.equal(name, 'dsh-media-desk-bisheng')
    assert.equal(HOST_OWNER, 'caisiyang123/dsh-media-desk-bisheng')
    assert.equal(HOST_OWNER, OWNER)
    for (const service of ['webServer', 'connection', 'tools', 'desktopWorkbenchOwnership', 'systemPrompt']) assert.ok(inject.includes(service), service)
    assert.ok(Config)
    assert.equal(hostDefault.name, name)
    assert.equal(hostDefault.OWNER, OWNER)
    assert.equal(hostDefault.apply, apply)
    assert.equal(hostDefault.Config, Config)
    assert.equal(f.tool.name, 'media_workbench')
    for (const action of ['context', 'search', 'navigate', 'open_item', 'capture', 'update_item', 'schedule', 'set_style', 'set_format', 'produce', 'production_status', 'cancel_produce', 'revise', 'insights']) assert.ok(ACTIONS.includes(action), action)
    assert.deepEqual(f.tool.parameters.properties.action.enum, ACTIONS)
    assert.equal(f.tool.output.schema.type, 'string')
    assert.deepEqual(f.tool.output.render({}, 'text'), [{ type: 'text', text: 'text' }])
    assert.equal(f.tool.presentCall({ action: 'context' }).kind, 'read')
    assert.equal(f.tool.presentCall({ action: 'produce' }).kind, 'other')
    assert.match(WORKBENCH_SYSTEM_PROMPT, /context/)
    assert.match(WORKBENCH_SYSTEM_PROMPT, /production_status/)
    assert.match(WORKBENCH_SYSTEM_PROMPT, /额度/)
    assert.match(WORKBENCH_SYSTEM_PROMPT, /HTTP/)
    assert.match(WORKBENCH_SYSTEM_PROMPT, /shell/)
  } finally {
    await f.cleanup()
  }
})

test('media_workbench 在读取业务数据前检查 Agent 会话和实时归属', async () => {
  const f = await fixture()
  try {
    let reads = 0
    const read = f.store.read.bind(f.store)
    f.store.read = (...args) => { reads += 1; return read(...args) }
    await assert.rejects(f.execute({ action: 'context' }, 'foreign'), /不属于|归属/)
    assert.equal(reads, 0)
    await assert.rejects(f.tool.execute({ action: 'context' }, {}), /Agent/)
    assert.equal(reads, 0)
    f.bindings.foreign = OWNER
    assert.equal(JSON.parse(await f.execute({ action: 'context' }, 'foreign')).ui.view, 'home')
    assert.ok(reads > 0)
  } finally {
    await f.cleanup()
  }
})

test('context 有当前 UI、可修改成稿、30 条摘要和公开能力状态，约 24k 且不泄密', async () => {
  const f = await fixture({ rich: true })
  try {
    await f.execute({ action: 'open_item', id: 'item-0' })
    const raw = await f.execute({ action: 'context' })
    const result = JSON.parse(raw)
    assert.deepEqual(result.ui, { revision: 1, view: 'content', focusId: 'item-0' })
    assert.equal(result.items.length, 30)
    assert.equal(result.currentItem.id, 'item-0')
    assert.match(result.currentItem.production.article, /UNIQUE-ARTICLE/)
    assert.ok(result.currentItem.production.article.length > 100)
    assert.equal(result.currentItem.production.savedPath, undefined)
    assert.equal(result.currentItem.production.aiArticle, undefined)
    assert.equal(result.styles.length, 2)
    assert.equal(result.styles[0].reference, undefined)
    assert.equal(result.draftFormat, 'article')
    assert.equal(result.model, 'unit-model')
    assert.equal(result.imageReady, true)
    assert.ok(raw.length <= MAX_CONTEXT_CHARS, `context ${raw.length} > ${MAX_CONTEXT_CHARS}`)
    for (const forbidden of ['sk-test-secret', 'private-export', 'secret-provider', 'secret-model', 'apiKey', 'savedPath']) assert.equal(raw.includes(forbidden), false, forbidden)
    const noDraw = await fixture({ canDraw: false })
    try {
      assert.equal(JSON.parse(await noDraw.execute({ action: 'context' })).imageReady, false)
    } finally {
      await noDraw.cleanup()
    }
  } finally {
    await f.cleanup()
  }
})

test('search 模糊匹配标题、正文和标签，最多返回 20 条', async () => {
  const f = await fixture()
  try {
    const result = JSON.parse(await f.execute({ action: 'search', query: '共同' }))
    assert.equal(result.items.length, 20)
    assert.ok(result.items.every(row => row.tags.includes('共同')))
    const body = JSON.parse(await f.execute({ action: 'search', query: '正文 34' }))
    assert.deepEqual(body.items.map(row => row.id), ['item-34'])
    await assert.rejects(f.execute({ action: 'search', query: 42 }), /query|搜索/)
  } finally {
    await f.cleanup()
  }
})

test('navigate/open_item 同步会话 UI，非法视图和不存在条目不会留下半次更新', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(JSON.parse(await f.execute({ action: 'navigate', view: 'style' })).ui, { revision: 1, view: 'style', focusId: null })
    assert.deepEqual(JSON.parse(await f.execute({ action: 'open_item', id: 'item-3' })).ui, { revision: 2, view: 'content', focusId: 'item-3' })
    await assert.rejects(f.execute({ action: 'navigate', view: 'settings' }), /视图|view/)
    await assert.rejects(f.execute({ action: 'open_item', id: 'missing' }), /找不到/)
    assert.deepEqual(await f.workbench.read('session-1'), { revision: 2, view: 'content', focusId: 'item-3' })
  } finally {
    await f.cleanup()
  }
})

test('capture 复用安全 harvest，update/schedule/style/format 只走白名单 ops', async () => {
  const f = await fixture()
  try {
    const captured = JSON.parse(await f.execute({ action: 'capture', url: 'https://93.184.216.34/post', note: '我的笔记', tags: ['网页'] }))
    assert.deepEqual(f.harvestCalls, ['https://93.184.216.34/post'])
    let state = await f.store.read()
    let item = state.items.find(row => row.id === captured.id)
    assert.equal(item.kind, 'web')
    assert.equal(item.title, '抓取标题')
    assert.equal(item.body, '我的笔记')
    assert.equal(item.media.src, 'https://93.184.216.34/cover.png')

    const updated = JSON.parse(await f.execute({ action: 'update_item', id: item.id, patch: { title: '改后', status: 'draft', evil: 'ignored', ops: [{ op: 'delete_item', id: item.id }] } }))
    assert.equal(updated.errors.length, 0)
    state = await f.store.read()
    item = state.items.find(row => row.id === item.id)
    assert.equal(item.title, '改后')
    assert.equal(item.status, 'draft')
    assert.equal(item.evil, undefined)
    assert.equal(item.ops, undefined)
    await assert.rejects(f.execute({ action: 'update_item', id: item.id, patch: { evil: true } }), /字段|patch/)

    await f.execute({ action: 'schedule', id: item.id, scheduledAt: '2026-12-01T12:00:00+08:00', platform: '小红书' })
    await f.execute({ action: 'set_style', style_id: 'style-1' })
    await f.execute({ action: 'set_format', format: 'script' })
    state = await f.store.read()
    item = state.items.find(row => row.id === captured.id)
    assert.equal(item.scheduledAt, '2026-12-01T04:00:00.000Z')
    assert.equal(item.platform, '小红书')
    assert.equal(state.activeStyleId, 'style-1')
    assert.equal(state.draftFormat, 'script')
    await f.execute({ action: 'set_style', style_id: '' })
    assert.equal((await f.store.read()).activeStyleId, null)
    await assert.rejects(f.execute({ action: 'settings', apiKey: 'steal' }), /动作|action/)
  } finally {
    await f.cleanup()
  }
})

test('produce 默认打开条目，done 必须 regenerate=true，运行中不重复，状态与取消可读', async () => {
  const f = await fixture({ rich: true })
  try {
    await assert.rejects(f.execute({ action: 'produce', id: 'item-0' }), /regenerate|重新|覆盖/)
    assert.equal(f.producer.starts.length, 0)
    assert.match((await f.store.read()).items[0].production.article, /UNIQUE-ARTICLE/)

    const started = JSON.parse(await f.execute({ action: 'produce', id: 'item-0', regenerate: true, withImages: false }))
    assert.equal(started.started, true)
    assert.equal(started.ui.focusId, 'item-0')
    assert.equal(started.ui.view, 'content')
    assert.equal(f.producer.starts.length, 1)
    assert.equal(f.producer.starts[0].withImages, false)

    const running = JSON.parse(await f.execute({ action: 'produce', id: 'item-0', regenerate: true }))
    assert.equal(running.started, false)
    assert.equal(running.reason, 'running')
    assert.equal(f.producer.starts.length, 1)
    const status = JSON.parse(await f.execute({ action: 'production_status', id: 'item-0' }))
    assert.equal(status.live.running, true)
    assert.equal(status.production.status, 'running')

    await f.execute({ action: 'cancel_produce', id: 'item-0' })
    assert.deepEqual(f.producer.cancellations, ['item-0'])
    const cancelled = JSON.parse(await f.execute({ action: 'production_status', id: 'item-0' }))
    assert.equal(cancelled.live.running, false)
    assert.equal(cancelled.production.status, 'cancelled')
  } finally {
    await f.cleanup()
  }
})

test('production_status 只返回有界进度摘要，不回灌长文、prompt 或保存路径', async () => {
  const f = await fixture({ rich: true })
  try {
    const raw = await f.execute({ action: 'production_status', id: 'item-0' })
    const result = JSON.parse(raw)
    assert.ok(raw.length < 4000, `status ${raw.length} bytes`)
    assert.equal(result.live.running, false)
    assert.equal(result.live.text, undefined)
    assert.equal(result.production.status, 'done')
    assert.equal(result.production.stage, 'done')
    assert.equal(result.production.startedAt, '2026-11-01T00:00:00.000Z')
    assert.equal(result.production.finishedAt, '2026-11-01T00:01:00.000Z')
    assert.equal(result.production.assets.total.done, 3)
    assert.equal(result.production.assets.images.done, 1)
    assert.equal(result.production.assets.shots.done, 1)
    assert.equal(result.production.article, undefined)
    for (const forbidden of ['UNIQUE-ARTICLE', 'prompt', 'savedPath', 'private-export']) assert.equal(raw.includes(forbidden), false, forbidden)
  } finally {
    await f.cleanup()
  }
})

test('revise 只接受 revision JSON 字符串，复用 applyRevision 并按能力重画 targets', async () => {
  const f = await fixture({ rich: true })
  try {
    const raw = await f.execute({
      action: 'revise',
      id: 'item-0',
      revision: JSON.stringify({
        title: '新标题',
        edits: [{ find: '开头 UNIQUE-ARTICLE', replace: '新开头' }],
        cover: { prompt: 'new cover' },
        shots: [{ no: 1, voice: '新口播', prompt: 'new shot' }],
      }),
    })
    const result = JSON.parse(raw)
    const production = (await f.store.read()).items[0].production
    assert.equal(production.title, '新标题')
    assert.match(production.article, /^新开头/)
    assert.equal(production.cover.prompt, 'new cover')
    assert.equal(production.shots[0].voice, '新口播')
    assert.deepEqual(result.targets, ['cover', 'shot:0'])
    assert.deepEqual(f.producer.regenerations, [{ id: 'item-0', target: 'cover' }, { id: 'item-0', target: 'shot:0' }])
    await assert.rejects(f.execute({ action: 'revise', id: 'item-0', revision: '{bad' }), /JSON/)
    await assert.rejects(f.execute({ action: 'revise', id: 'item-0', revision: { title: '对象不可' } }), /string|字符串/)
    const insights = JSON.parse(await f.execute({ action: 'insights' }))
    assert.equal(insights.views, 0)
    assert.equal(insights.published, 0)
  } finally {
    await f.cleanup()
  }
})

function fakeHostContext(root, registrations) {
  const connection = { requestRejection: () => undefined }
  const ctx = {
    webServer: { register: (definition) => { registrations.web = definition; return () => {} } },
    connection,
    tools: { register: (definition) => { registrations.tool = definition; return () => {} } },
    desktopWorkbenchOwnership: { read: async () => ({ sessionBindings: { 'session-1': OWNER } }) },
    systemPrompt: { section: (definition) => { registrations.prompt = definition; return () => {} } },
    effect: (callback) => callback(),
    get: (service) => service === 'connection' ? connection : undefined,
  }
  return ctx
}

async function callRoute(handler, method, url, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = { 'sec-fetch-site': 'same-origin' }
  const res = {
    statusCode: 200,
    headers: {},
    headersSent: false,
    body: '',
    setHeader(key, value) { this.headers[key] = value },
    end(chunk = '') { this.body += chunk; this.headersSent = true },
  }
  await handler(req, res)
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }
}

test('Host 保留 webServer 鉴权，GET/POST workbench 支持 sandbox 且命名会话强制 own', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-desk-host-'))
  try {
    const registrations = {}
    const ctx = fakeHostContext(root, registrations)
    apply(ctx, { root })
    assert.equal(registrations.web.path, '/media-desk')
    assert.equal(registrations.tool.name, 'media_workbench')
    assert.match(registrations.prompt.text, /不能绕过|不得绕过/)

    const anonymous = await callRoute(registrations.web.handler, 'GET', '/media-desk/workbench')
    assert.deepEqual(anonymous, { status: 200, body: { revision: 0, view: 'home', focusId: null } })
    const posted = await callRoute(registrations.web.handler, 'POST', '/media-desk/workbench', { session_id: 'session-1', view: 'content', focusId: 'item-1' })
    assert.deepEqual(posted, { status: 200, body: { revision: 1, view: 'content', focusId: 'item-1' } })
    const read = await callRoute(registrations.web.handler, 'GET', '/media-desk/workbench?session_id=session-1')
    assert.deepEqual(read.body, { revision: 1, view: 'content', focusId: 'item-1' })
    const foreign = await callRoute(registrations.web.handler, 'POST', '/media-desk/workbench', { session_id: 'foreign', view: 'style' })
    assert.equal(foreign.status, 403)
    const empty = await callRoute(registrations.web.handler, 'GET', '/media-desk/workbench?session_id=')
    assert.equal(empty.status, 403)
    const invalid = await callRoute(registrations.web.handler, 'POST', '/media-desk/workbench', { view: 'settings' })
    assert.equal(invalid.status, 400)
    const sandbox = await callRoute(registrations.web.handler, 'POST', '/media-desk/workbench', { view: 'insights', focusId: null })
    assert.deepEqual(sandbox.body, { revision: 1, view: 'insights', focusId: null })

    assert.equal(requestRejection({ get: () => undefined }, { headers: {} }), 403)
    assert.equal(requestRejection(ctx, { headers: {} }), undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('produce/save 未选择 exportDir 时拒绝创建默认目录，明确目录后才保存', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-desk-save-guard-'))
  try {
    const store = new Store(root)
    await store.read()
    await store.mutate('fixture production', (state) => {
      const item = state.items.find(row => row.id === 'seed_2')
      item.production = { status: 'done', title: '保存测试', article: '正文', cover: null, images: [], shots: [] }
      return state
    }, { undoable: false })
    const registrations = {}
    apply(fakeHostContext(root, registrations), { root })

    const rejected = await callRoute(registrations.web.handler, 'POST', '/media-desk/produce/save', { id: 'seed_2' })
    assert.equal(rejected.status, 400)
    assert.match(rejected.body.error, /选择保存文件夹/)
    assert.equal((await store.read()).items.find(row => row.id === 'seed_2').production.savedPath, undefined)

    const exportDir = join(root, 'chosen-export')
    await new Settings(root).update({ exportDir })
    const saved = await callRoute(registrations.web.handler, 'POST', '/media-desk/produce/save', { id: 'seed_2' })
    assert.equal(saved.status, 200)
    assert.ok(saved.body.path.startsWith(exportDir))
    assert.ok(saved.body.files.includes('脚本.md'))
    assert.equal((await store.read()).items.find(row => row.id === 'seed_2').production.savedPath, saved.body.path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
