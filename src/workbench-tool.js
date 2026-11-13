// 原生 Agent 工具：复用 Host 的 Store/Producer，不为 Agent 另开 HTTP 或文件写入口。
import { defineTool } from '@deepseek-ai/dsh-tools'
import { harvest } from './harvest.js'
import { computeInsights } from './learn.js'
import { applyOps } from './ops.js'
import { applyRevision } from './produce.js'
import { draftFormat } from './style.js'

export const ACTIONS = Object.freeze([
  'context', 'search', 'navigate', 'open_item', 'capture', 'update_item', 'schedule',
  'set_style', 'set_format', 'produce', 'production_status', 'cancel_produce', 'revise', 'insights',
])
export const MAX_CONTEXT_CHARS = 24_000
export const WORKBENCH_SYSTEM_PROMPT = [
  '在「自媒体工作台」所属会话中，用户可通过 media_workbench 操作左侧工作台。先调用 context 获取实时 view、focusId 和条目，不能从旧对话猜测当前选择。',
  'produce 只负责启动长任务；之后用 production_status 查询真实进度，完成前不要声称成稿或图片已生成。已完成的成稿只有用户明确要求重新生成时才传 regenerate=true，覆盖前要说明影响。',
  '生成封面、配图和分镜图片会消耗生图额度；withImages=false 可只做文字与分镜文案。生图不可用时如实说明，不得伪造图片或进度。',
  '工具不提供 settings、API Key、Monid、save/export 目录或任意文件写能力。不能绕过会话归属，不得通过 HTTP、shell 或改文件间接执行这些操作；保存成稿由用户在左侧工作台选择文件夹后自行完成。',
  '修改已成稿内容用 revise（revision 是 JSON 字符串）；capture、update_item、schedule、set_style、set_format 只使用工具内的白名单操作。',
].join('\n')

const UPDATE_FIELDS = Object.freeze([
  'title', 'body', 'kind', 'url', 'source', 'tags', 'status', 'angleId', 'personaIds',
  'parentId', 'rel', 'scheduledAt', 'platform', 'pinned', 'media', 'pos', 'score',
])
const READ_ACTIONS = new Set(['context', 'search', 'production_status', 'insights'])
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : value

function failure(message, status = 400) {
  return Object.assign(new Error(message), { status })
}

function summarizeItem(item) {
  return {
    id: item.id,
    kind: item.kind,
    title: clip(item.title, 160),
    body: clip(item.body, 160),
    url: item.url,
    source: clip(item.source, 100),
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 6).map(tag => clip(tag, 40)) : [],
    status: item.status,
    scheduledAt: item.scheduledAt,
    platform: item.platform,
    pinned: item.pinned,
    production: item.production ? { status: item.production.status, stage: item.production.stage, title: clip(item.production.title, 160) } : undefined,
  }
}

function assetContext(asset, kind, index) {
  if (!asset) return null
  const base = {
    status: asset.status,
    src: asset.src,
    prompt: clip(asset.prompt, 500),
  }
  if (kind === 'image') return { no: index + 1, caption: clip(asset.caption, 100), anchor: clip(asset.anchor, 100), ...base }
  if (kind === 'shot') return { no: index + 1, shot: clip(asset.shot, 30), visual: clip(asset.visual, 240), voice: clip(asset.voice, 300), seconds: asset.seconds, ...base }
  return base
}

function productionContext(production) {
  if (!production) return null
  if (production.status !== 'done') return { status: production.status, stage: production.stage, title: production.title }
  return {
    status: production.status,
    stage: production.stage,
    format: draftFormat(production.format),
    title: clip(production.title, 300),
    coverText: clip(production.coverText, 80),
    article: clip(production.article, 16_000),
    facts: Array.isArray(production.facts) ? production.facts.slice(0, 8).map(row => clip(row, 160)) : [],
    outline: Array.isArray(production.outline) ? production.outline.slice(0, 8).map(row => clip(row, 120)) : [],
    cover: assetContext(production.cover, 'cover'),
    images: (production.images ?? []).slice(0, 4).map((row, index) => assetContext(row, 'image', index)),
    shots: (production.shots ?? []).slice(0, 12).map((row, index) => assetContext(row, 'shot', index)),
    withImages: production.withImages,
    needsProvider: production.needsProvider,
  }
}

function currentItemContext(item) {
  if (!item) return null
  return {
    ...summarizeItem(item),
    body: clip(item.body, 1600),
    angleId: item.angleId,
    personaIds: item.personaIds,
    parentId: item.parentId,
    rel: clip(item.rel, 100),
    production: productionContext(item.production),
  }
}

function styleContext(style) {
  return {
    id: style.id,
    name: clip(style.name, 100),
    icon: clip(style.icon, 30),
    category: clip(style.category, 60),
    summary: clip(style.summary, 240),
    tone: clip(style.tone, 300),
    preset: style.preset,
  }
}

/** 优先保留当前成稿正文，再逐步减少摘要；不把超长文章直接截成无效 JSON。 */
function fitContext(context) {
  const production = context.currentItem?.production
  const fullArticle = typeof production?.article === 'string' ? production.article : ''
  const allItems = context.items
  const fullBody = context.currentItem?.body ?? ''
  const allStyles = context.styles
  const counts = [Math.min(30, allItems.length), Math.min(20, allItems.length), Math.min(10, allItems.length), 0]
  for (const count of [...new Set(counts)]) {
    for (const bodyLimit of [1600, 400, 0]) {
      context.items = allItems.slice(0, count)
      if (context.currentItem) context.currentItem.body = clip(fullBody, bodyLimit)
      if (production) {
        production.article = ''
        production.articleTruncated = Boolean(fullArticle)
        const fixed = JSON.stringify(context).length
        const budget = Math.max(0, MAX_CONTEXT_CHARS - fixed)
        production.article = fullArticle.slice(0, budget)
        production.articleTruncated = production.article.length < fullArticle.length
      }
      if (JSON.stringify(context).length <= MAX_CONTEXT_CHARS) return context
    }
  }
  // 极端的长 ID/风格数量下仍保证有界；当前条目与成稿主体优先于列表。
  context.items = []
  context.styles = allStyles.slice(0, 5)
  if (production) {
    production.images = (production.images ?? []).map(row => ({ ...row, prompt: clip(row.prompt, 100) }))
    production.shots = (production.shots ?? []).map(row => ({ ...row, prompt: clip(row.prompt, 100), visual: clip(row.visual, 100), voice: clip(row.voice, 100) }))
    production.article = ''
    production.articleTruncated = Boolean(fullArticle)
    const budget = Math.max(0, MAX_CONTEXT_CHARS - JSON.stringify(context).length)
    production.article = fullArticle.slice(0, budget)
    production.articleTruncated = production.article.length < fullArticle.length
  }
  return context
}

function itemId(args, ui, { allowCurrent = true } = {}) {
  const id = args.id ?? args.item_id ?? (allowCurrent ? ui.focusId : undefined)
  if (typeof id !== 'string' || !id.trim()) throw failure('需要条目 id；也可以先 open_item 选择当前灵感')
  return id
}

function findItem(state, id) {
  const item = state.items.find(row => row.id === id)
  if (!item) throw failure('找不到这条灵感', 404)
  return item
}

function parseRevision(value) {
  if (typeof value !== 'string') throw failure('revision 必须是 JSON 字符串')
  if (value.length > 240_000) throw failure('revision 太大')
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw failure('revision 不是有效的 JSON 字符串')
  }
  if (!isObject(parsed)) throw failure('revision JSON 必须是对象')
  return parsed
}

function assetCounts(rows) {
  const counts = { total: rows.length, done: 0, failed: 0, pending: 0, running: 0, idle: 0, skipped: 0 }
  for (const row of rows) {
    if (row && Object.hasOwn(counts, row.status)) counts[row.status] += 1
  }
  return counts
}

function productionProgress(production) {
  if (!production) return null
  const cover = production.cover ? [production.cover] : []
  const images = production.images ?? []
  const shots = production.shots ?? []
  return {
    status: production.status,
    stage: production.stage,
    title: clip(production.title, 160),
    format: production.format,
    error: clip(production.error, 500),
    withImages: production.withImages,
    startedAt: production.startedAt,
    finishedAt: production.finishedAt,
    assets: {
      cover: assetCounts(cover),
      images: assetCounts(images),
      shots: assetCounts(shots),
      total: assetCounts([...cover, ...images, ...shots]),
    },
  }
}

function liveProgress(live) {
  return {
    running: Boolean(live?.running),
    stage: live?.stage,
    title: clip(live?.title, 160),
    visuals: Array.isArray(live?.visuals) ? live.visuals.slice(0, 12).map(row => clip(row, 200)) : [],
    textChars: typeof live?.text === 'string' ? live.text.length : 0,
  }
}

/**
 * 创建原生工具定义。own 必须在任何 Store/设置读取之前完成。
 * @param {object} deps - Host 已初始化的服务。
 */
export function createMediaWorkbenchTool({
  ctx,
  store,
  workbench,
  own,
  settings,
  producer,
  model = () => null,
  harvestUrl = harvest,
}) {
  const starting = new Set()

  async function mutateOps(label, ops) {
    return store.mutate(label, (state) => applyOps(state, ops))
  }

  async function productionStatus(id) {
    await producer.settle(id)
    const state = await store.read()
    const item = state.items.find(row => row.id === id)
    return {
      id,
      live: liveProgress(producer.status(id)),
      production: productionProgress(item?.production),
      itemStatus: item?.status ?? null,
    }
  }

  async function open(sessionId, id) {
    const state = await store.read()
    const item = findItem(state, id)
    const ui = await workbench.command(sessionId, { action: 'open_item', id })
    return { ui, item }
  }

  async function produce(sessionId, args) {
    const ui = await workbench.read(sessionId)
    const id = itemId(args, ui)
    const live = producer.status(id)
    if (starting.has(id) || live.running || producer.isRunning(id)) {
      const nextUi = args.open === false ? ui : (await open(sessionId, id)).ui
      return { started: false, reason: 'running', ui: nextUi, ...(await productionStatus(id)) }
    }
    starting.add(id)
    try {
      let state = await store.read()
      let item = findItem(state, id)
      if (item.production?.status === 'running') {
        // Host 重启后内存任务已消失，先按原 Producer 规则结算中断状态。
        await producer.settle(id)
        state = await store.read()
        item = findItem(state, id)
      }
      if (item.production?.status === 'done' && args.regenerate !== true) {
        throw failure('这条灵感已经成稿；只有明确传 regenerate=true 才能覆盖重新生成', 409)
      }
      if (producer.status(id).running || producer.isRunning(id)) {
        const nextUi = args.open === false ? ui : (await open(sessionId, id)).ui
        return { started: false, reason: 'running', ui: nextUi, ...(await productionStatus(id)) }
      }
      const started = await producer.start(id, { withImages: args.withImages })
      const nextUi = args.open === false ? await workbench.read(sessionId) : (await open(sessionId, id)).ui
      return { started, ui: nextUi, ...(await productionStatus(id)) }
    } finally {
      starting.delete(id)
    }
  }

  return defineTool({
    name: 'media_workbench',
    description: '操作左侧自媒体工作台并读取当前创作证据，仅允许本工作台归属 Agent 会话。先 context 获取实时 UI；支持搜索、记灵感、打开条目、白名单修改、排期、风格、成稿、进度、取消、改稿与复盘。长任务用 production_status；生成图片消耗额度。不能读取/修改设置或 API Key，不提供 Monid、保存目录、导出目录或任意文件写能力，不得绕过归属/HTTP/shell。',
    parameters: {
      action: { type: 'string', required: true, enum: ACTIONS },
      id: { type: 'string', description: '条目 ID；produce/status/revise 缺省使用当前 focusId' },
      item_id: { type: 'string', description: '条目 ID 的别名' },
      query: { type: 'string', description: 'search 的关键词' },
      view: { type: 'string', enum: ['home', 'content', 'schedule', 'insights', 'style'] },
      title: { type: 'string' },
      text: { type: 'string', description: 'capture 的正文/笔记' },
      body: { type: 'string', description: 'capture 正文的别名' },
      note: { type: 'string', description: 'capture 笔记的别名' },
      url: { type: 'string', description: '公开 http(s) 链接；capture 时使用安全 harvest' },
      source: { type: 'string' },
      kind: { type: 'string', enum: ['image', 'video', 'web', 'quote', 'note'] },
      tags: { type: 'array', items: { type: 'string' } },
      media: { type: 'object', additionalProperties: true },
      patch: { type: 'object', additionalProperties: true, description: 'update_item 字段；只接受白名单，不接受 ops' },
      scheduledAt: { oneOf: [{ type: 'string' }, { type: 'null' }], description: 'ISO 8601 时间；null 取消排期' },
      platform: { type: 'string' },
      style_id: { type: 'string', description: '风格 ID；空字符串表示不使用特定风格' },
      format: { type: 'string', enum: ['article', 'script'] },
      withImages: { type: 'boolean', description: '是否生成图片；会消耗额度' },
      regenerate: { type: 'boolean', description: '已 done 时必须显式传 true 才允许覆盖' },
      open: { type: 'boolean', description: 'produce 默认 true，打开目标条目' },
      revision: { type: 'string', description: 'revise 的 JSON 字符串，复用 applyRevision 字段' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (!exec?.agent) throw failure('需要当前 Agent 会话', 403)
      const sessionId = exec.agent.session?.id
      await own(sessionId)
      if (!ACTIONS.includes(args.action)) throw failure(`未知动作：${String(args.action)}`)

      switch (args.action) {
        case 'context': {
          const [ui, state, saved] = await Promise.all([workbench.read(sessionId), store.read(), settings.read()])
          const current = ui.focusId ? state.items.find(row => row.id === ui.focusId) : null
          const context = {
            ui,
            currentItem: currentItemContext(current),
            items: state.items.slice(0, 30).map(summarizeItem),
            styles: (state.styles ?? []).slice(0, 40).map(styleContext),
            activeStyleId: state.activeStyleId ?? null,
            draftFormat: draftFormat(state.draftFormat),
            model: typeof model === 'function' ? model() : model,
            imageReady: Boolean(producer.ready(saved)),
          }
          return JSON.stringify(fitContext(context))
        }
        case 'search': {
          if (typeof args.query !== 'string') throw failure('search.query 必须是字符串')
          const query = args.query.trim().toLocaleLowerCase()
          const state = await store.read()
          const items = state.items.filter((item) => {
            if (!query) return true
            const haystack = [item.title, item.body, item.source, item.url, ...(item.tags ?? [])].filter(Boolean).join('\n').toLocaleLowerCase()
            return haystack.includes(query)
          }).slice(0, 20).map(summarizeItem)
          return JSON.stringify({ items })
        }
        case 'navigate': {
          const ui = await workbench.command(sessionId, { action: 'navigate', view: args.view })
          return JSON.stringify({ ui })
        }
        case 'open_item': {
          const ui = await workbench.read(sessionId)
          const id = itemId(args, ui, { allowCurrent: false })
          const result = await open(sessionId, id)
          return JSON.stringify({ ui: result.ui, item: summarizeItem(result.item) })
        }
        case 'capture': {
          const hasUrl = args.url !== undefined && args.url !== null && args.url !== ''
          if (hasUrl && typeof args.url !== 'string') throw failure('url 必须是字符串')
          let op
          if (hasUrl) {
            const info = await harvestUrl(args.url.trim())
            op = {
              op: 'add_item', kind: 'web', title: args.title || info.title || info.url,
              body: args.note ?? args.text ?? args.body ?? info.description ?? '',
              url: info.url, source: args.source || info.siteName,
              tags: Array.isArray(args.tags) ? args.tags : [],
              media: args.media ?? (info.image ? { src: info.image } : null),
            }
          } else {
            op = {
              op: 'add_item', kind: args.kind ?? 'note', title: args.title ?? '',
              body: args.note ?? args.text ?? args.body ?? '', tags: args.tags,
              source: args.source, media: args.media,
            }
          }
          const result = await mutateOps('Agent 记下灵感', [op])
          const id = result.receipts[0]?.target
          if (!id) throw failure(result.errors[0] ?? '灵感内容为空')
          const ui = (await open(sessionId, id)).ui
          return JSON.stringify({ ...result, id, ui })
        }
        case 'update_item': {
          const ui = await workbench.read(sessionId)
          const id = itemId(args, ui)
          if (!isObject(args.patch)) throw failure('update_item.patch 必须是对象')
          const patch = Object.fromEntries(UPDATE_FIELDS.filter(key => args.patch[key] !== undefined).map(key => [key, args.patch[key]]))
          if (!Object.keys(patch).length) throw failure('patch 没有可更新的白名单字段')
          const result = await mutateOps('Agent 更新灵感', [{ op: 'update_item', id, ...patch }])
          return JSON.stringify(result)
        }
        case 'schedule': {
          const ui = await workbench.read(sessionId)
          const id = itemId(args, ui)
          if (!Object.hasOwn(args, 'scheduledAt')) throw failure('schedule 需要 scheduledAt（null 表示取消）')
          const result = await mutateOps('Agent 排期', [{ op: 'schedule_item', id, scheduledAt: args.scheduledAt, platform: args.platform }])
          return JSON.stringify(result)
        }
        case 'set_style': {
          const value = args.style_id !== undefined ? args.style_id : args.id
          if (value === undefined) throw failure('set_style 需要 style_id；空字符串表示不使用特定风格')
          const result = await mutateOps('Agent 切换风格', [{ op: 'set_style', id: value === '' ? null : value }])
          return JSON.stringify(result)
        }
        case 'set_format': {
          const result = await mutateOps('Agent 切换成稿体裁', [{ op: 'set_format', format: args.format }])
          return JSON.stringify(result)
        }
        case 'produce':
          return JSON.stringify(await produce(sessionId, args))
        case 'production_status': {
          const ui = await workbench.read(sessionId)
          return JSON.stringify(await productionStatus(itemId(args, ui)))
        }
        case 'cancel_produce': {
          const ui = await workbench.read(sessionId)
          const id = itemId(args, ui)
          await producer.cancel(id)
          return JSON.stringify({ ok: true, ...(await productionStatus(id)) })
        }
        case 'revise': {
          const ui = await workbench.read(sessionId)
          const id = itemId(args, ui)
          const revision = parseRevision(args.revision)
          const saved = await settings.read()
          const canDraw = Boolean(producer.ready(saved))
          const result = await store.mutate('Agent 修改成稿', (state) => {
            const item = findItem(state, id)
            if (item.production?.status !== 'done') throw failure('只有已完成且未在重新生成的成稿可以修改', 409)
            return applyRevision(item.production, revision, { canDraw })
          })
          const redrawErrors = []
          if (canDraw) {
            for (const target of result.targets) {
              try {
                await producer.regenerate(id, target)
              } catch (error) {
                redrawErrors.push({ target, error: clip(error instanceof Error ? error.message : String(error), 500) })
              }
            }
          }
          return JSON.stringify({ ...result, redrawErrors })
        }
        case 'insights':
          return JSON.stringify(computeInsights(await store.read()))
        default:
          throw failure(`未知动作：${String(args.action)}`)
      }
    },
    presentCall: args => ({
      card: 'generic',
      title: `自媒体工作台 · ${args.action}`,
      kind: READ_ACTIONS.has(args.action) ? 'read' : 'other',
      rawInput: args,
    }),
  })
}

export function registerMediaWorkbenchTool(deps) {
  return deps.ctx.tools.register(createMediaWorkbenchTool(deps))
}
