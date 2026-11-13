// 每个 Agent 会话独立保存左侧工作台 UI；业务数据仍由 Store 统一管理。
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const OWNER = 'caisiyang123/dsh-media-desk-bisheng'
export const VIEWS = Object.freeze(['home', 'content', 'schedule', 'insights', 'style'])

const MAX_ID = 200
const DEFAULT_SESSION = 'sandbox'
const initial = () => ({ revision: 0, view: 'home', focusId: null })
const clone = value => structuredClone(value)
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function invalid(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function identifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID) {
    throw invalid(`${label}必须是不超过 ${MAX_ID} 个字符的非空字符串`)
  }
  return value
}

export function normalizeView(value) {
  if (!VIEWS.includes(value)) throw invalid(`视图无效：${String(value)}`)
  return value
}

export function normalizeFocusId(value) {
  if (value === null) return null
  return identifier(value, 'focusId（条目 ID）')
}

export function normalizeSessionId(value) {
  return identifier(value, '会话 sessionId')
}

/**
 * 从 Desktop 的实时绑定判断归属。调用方不能把界面可见性当作归属证据。
 * @param {object} ctx - BISHENG/Cordis 上下文。
 * @returns {(sessionId: string) => Promise<string>} 归属校验函数。
 */
export function createOwnershipGuard(ctx) {
  return async function own(sessionId) {
    try {
      normalizeSessionId(sessionId)
    } catch {
      throw invalid('需要属于本工作台的会话', 403)
    }
    const service = ctx?.desktopWorkbenchOwnership
    if (typeof service?.read !== 'function') throw invalid('工作台归属服务不可用', 403)
    const ownership = await service.read()
    if (ownership?.sessionBindings?.[sessionId] !== OWNER) {
      throw invalid('此会话不属于自媒体工作台，拒绝跨会话操作', 403)
    }
    return sessionId
  }
}

/**
 * JSON 原子持久化的按会话 UI 状态。所有写操作共用一个串行队列，
 * 因此 navigate/open_item 与 UI POST 不会发生同进程覆盖。
 */
export class WorkbenchSessions {
  constructor(root) {
    this.root = root
    this.file = join(root, 'workbench-sessions.json')
    this.sessions = new Map()
    this.loaded = false
    this.queue = Promise.resolve()
  }

  run(task) {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => {})
    return next
  }

  async load() {
    if (this.loaded) return
    await mkdir(this.root, { recursive: true })
    let saved = null
    try {
      saved = JSON.parse(await readFile(this.file, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (saved) {
      const records = isObject(saved.sessions) ? saved.sessions : {}
      for (const [sessionId, value] of Object.entries(records)) {
        try {
          normalizeSessionId(sessionId)
          if (!isObject(value)) continue
          const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0
          const view = VIEWS.includes(value.view) ? value.view : 'home'
          const focusId = value.focusId === null || value.focusId === undefined
            ? null
            : normalizeFocusId(value.focusId)
          this.sessions.set(sessionId, { revision, view, focusId })
        } catch {
          // 单条损坏记录不应使其他会话无法打开；下一次写入会保留合法记录。
        }
      }
    }
    this.loaded = true
  }

  current(sessionId) {
    return this.sessions.get(sessionId) ?? initial()
  }

  async persist() {
    const sessions = Object.fromEntries([...this.sessions.entries()].map(([key, value]) => [key, clone(value)]))
    const tmp = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, sessions }))
    await rename(tmp, this.file)
  }

  async read(sessionId = DEFAULT_SESSION) {
    normalizeSessionId(sessionId)
    return this.run(async () => {
      await this.load()
      return clone(this.current(sessionId))
    })
  }

  snapshot(sessionId = DEFAULT_SESSION) {
    return this.read(sessionId)
  }

  async sync(sessionId = DEFAULT_SESSION, patch) {
    normalizeSessionId(sessionId)
    if (!isObject(patch)) throw invalid('同步内容必须是对象')
    const unknown = Object.keys(patch).filter(key => !['view', 'focusId'].includes(key))
    if (unknown.length) throw invalid(`不支持的 UI 字段：${unknown.join(', ')}`)
    if (patch.view === undefined && patch.focusId === undefined) throw invalid('同步内容至少需要 view 或 focusId')
    // 在排队前验证完整 patch，避免 view 已改而 focusId 失败的部分更新。
    const view = patch.view === undefined ? undefined : normalizeView(patch.view)
    const focusId = patch.focusId === undefined ? undefined : normalizeFocusId(patch.focusId)
    return this.run(async () => {
      await this.load()
      const before = this.current(sessionId)
      const next = {
        revision: before.revision,
        view: view === undefined ? before.view : view,
        focusId: focusId === undefined ? before.focusId : focusId,
      }
      if (next.view === before.view && next.focusId === before.focusId) return clone(before)
      next.revision += 1
      this.sessions.set(sessionId, next)
      await this.persist()
      return clone(next)
    })
  }

  async command(sessionId = DEFAULT_SESSION, args) {
    if (!isObject(args)) throw invalid('工作台命令必须是对象')
    switch (args.action) {
      case 'navigate':
        return this.sync(sessionId, { view: args.view })
      case 'open_item': {
        const focusId = Object.hasOwn(args, 'focusId') ? args.focusId : args.id
        return this.sync(sessionId, { view: 'content', focusId })
      }
      default:
        throw invalid(`未知工作台命令：${String(args.action)}`)
    }
  }
}
