import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = file => readFileSync(new URL(`../client/${file}`, import.meta.url), 'utf8')
const index = () => read('index.jsx')
const workbench = () => read('workbench.jsx')
const studio = () => read('studio.jsx')
const desk = () => read('desk.js')
const styles = () => read('styles.css')

test('客户端注册为 customFrame 工作台，只注入宿主需要的服务', () => {
  const source = index()
  assert.match(source, /desktopWorkbenches\.register\s*\(\s*\{/)
  assert.match(source, /title:\s*'自媒体工作台 · BISHENG 版'/)
  assert.match(source, /panelTitle:\s*'灵感与内容创作'/)
  assert.match(source, /repository:\s*'https:\/\/github\.com\/caisiyang123\/dsh-media-desk-bisheng'/)
  assert.match(source, /description:\s*'基于「蜗牛的科技笔记」原作的 BISHENG 适配版/)
  assert.match(source, /category:\s*'内容创作'/)
  assert.match(source, /customFrame:\s*true/)
  assert.match(source, /export const inject = \['desktopWorkbenches', 'uiSession', 'uiWorkspace'\]/)
  assert.doesNotMatch(source, /slots\.inject|sidebar\.panellist|betterSidebar/)
  assert.doesNotMatch(source, /<ChatDock\b|from '\.\/chat\.jsx'/)
})

test('工作台顶部展示原作者署名并链接原作者主页', async () => {
  const source = index()
  assert.match(source, /const ORIGINAL_AUTHOR = \{/)
  assert.match(source, /name: '蜗牛的科技笔记'/)
  assert.match(source, /https:\/\/www\.xiaohongshu\.com\/user\/profile\/5faedce8000000000101c8a3/)
  assert.match(source, /className="md-author"/)
  assert.match(source, /原作者：\{name\}。点击查看原作者主页。/)
  assert.match(source, /rel="noopener noreferrer"/)
  const css = styles()
  assert.match(css, /\.md-author\s*\{[^}]*max-width:\s*175px/)
  assert.match(css, /\.md-author\s*\{[^}]*overflow:\s*hidden/)
  const { EN } = await import('../client/en/index.js')
  for (const key of ['原作者', '原作者：{name}。点击查看原作者主页。']) assert.ok(EN[key], `缺少英文翻译：${key}`)
})

test('Desk 消费宿主 conversation，并按 entry.id 校验会话归属', () => {
  const source = `${index()}\n${workbench()}`
  assert.match(source, /function Desk\(\{ service, entry, conversation \}/)
  assert.match(source, /service\.getSnapshot/)
  assert.match(source, /service\.subscribe/)
  assert.match(source, /service\?\.currentSession/)
  assert.match(source, /sessionBindings\?\.\[sid\]\s*===\s*entry\?\.id/)
  assert.match(source, /current\.subscribe/)
  assert.match(source, /NativeChatDock/)
  assert.match(source, /hidden=\{!owned \|\| !dockOpen\}/)
  assert.match(source, /\{conversation\}/)
  assert.match(source, /选择资料位置并开始对话/)
})

test('主动创建会话先选目录，取消不创建；askAgent 只追加原生草稿', () => {
  const source = workbench()
  const pick = source.indexOf('pickDirectory()')
  const cancel = source.indexOf('if (!folder) return null')
  const ensure = source.indexOf('ensureSession({ folder })')
  assert.ok(pick >= 0 && cancel > pick && ensure > cancel, '目录选择、取消守卫、ensureSession 的顺序不正确')
  assert.match(source, /ownsSession\(target\)/)
  assert.match(source, /uiSession\.current\.getSnapshot\(\)/)
  assert.match(source, /inputActions/)
  assert.match(source, /setDraft\(/)
  assert.match(source, /currentDraft[\s\S]*\\n\\n|draft[\s\S]*\\n\\n/)
  assert.doesNotMatch(source, /sendChat|inputActions\.send|\.submit\(/)
  assert.match(desk(), /dockOpen:\s*false/)
})

test('Studio 只保留成稿控制栏，建议和选段通过原生助手草稿并携带 focusId', () => {
  const source = studio()
  assert.doesNotMatch(source, /<ChatPanel\b|<ChatDock\b|md-chat-toggle|sendChat|from '\.\/chat\.jsx'/)
  assert.match(source, /md-studio-control/)
  assert.match(source, /IdeaCard/)
  assert.match(source, /DONE_SUGGESTIONS/)
  assert.match(source, /askAgent\(/)
  assert.match(source, /focusId:/)
  assert.match(source, /picked\.text/)
  assert.match(source, /md-sheet/)
})

test('可调分隔条具备方向公式、键盘、持久化与完整清理', () => {
  const source = `${workbench()}\n${read('dock-layout.js')}`
  assert.match(source, /startWidth\s*\+\s*startX\s*-\s*moveEvent\.clientX/)
  assert.match(source, /setPointerCapture\(event\.pointerId\)/)
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    assert.match(source, new RegExp(`addEventListener\\('${type}'`))
    assert.match(source, new RegExp(`removeEventListener\\('${type}'`))
  }
  assert.match(source, /resizeCleanupRef\.current/)
  assert.match(source, /return \(\) =>[\s\S]*resizeCleanupRef|resizeCleanupRef[\s\S]*return \(\) =>/)
  assert.match(source, /role="separator"/)
  assert.match(source, /tabIndex=\{0\}/)
  assert.match(source, /aria-orientation="vertical"/)
  assert.match(source, /aria-valuenow=\{dockWidth\}/)
  assert.match(source, /event\.key === 'ArrowLeft' \? 16 : -16/)
  assert.match(source, /event\.key === 'Home'/)
  assert.match(source, /onDoubleClick=/)
  assert.match(source, /bisheng-media-desk-layout-v1/)
  assert.match(source, /JSON\.stringify\(\{ width \}\)/)
  assert.doesNotMatch(source, /localStorage\.setItem\([^\n]*(?:view|focusId|session)/)
})

test('根节点实测宽度并钳制，原生对话窄屏改为右侧抽屉', () => {
  const source = `${workbench()}\n${index()}`
  const css = styles()
  assert.match(source, /new ResizeObserver/)
  assert.match(source, /observer\.observe\(el\)/)
  assert.match(source, /clampDockWidth\(/)
  assert.match(source, /--dock-w/)
  assert.match(css, /\.md-resizer\s*\{[^}]*width:\s*12px/)
  assert.match(css, /\.md-resizer-grip/)
  assert.match(css, /\.md-root\.is-resizing\s*\{[^}]*user-select:\s*none/)
  assert.match(css, /\.md-root\.is-narrow \.md-native-dock\s*\{[^}]*position:\s*absolute[^}]*right:/)
  assert.match(css, /\.md-native-conversation/)
})

test('原生 dock 关闭时隔离焦点，窄屏抽屉有遮罩、Escape 与焦点圈定/恢复', () => {
  const source = workbench()
  assert.match(source, /inert=\{!dockOpen \? '' : undefined\}/)
  assert.match(source, /hidden=\{!owned \|\| !dockOpen\}/)
  assert.match(source, /narrow && dockOpen/)
  assert.match(source, /md-native-scrim/)
  assert.match(source, /event\.key === 'Escape'/)
  assert.match(source, /stopImmediatePropagation\(\)/)
  assert.match(source, /setDockOpen\(false\)/)
  assert.match(source, /closeButtonRef\.current\?\.focus\(\)/)
  assert.match(source, /restoreFocusRef\.current/)
  assert.match(source, /event\.key !== 'Tab'/)
  assert.match(source, /querySelectorAll\(/)
  assert.match(source, /window\.addEventListener\('keydown', onKey, true\)/)
  assert.match(source, /window\.removeEventListener\('keydown', onKey, true\)/)
  assert.match(source, /owned && !conversation/)
  assert.match(source, /原生对话节点尚未就绪/)
  assert.match(styles(), /\.md-native-scrim/)
})

test('视图同步使用既有相对 BASE，按会话轮询 revision 并防止回写覆盖', () => {
  const source = desk()
  assert.match(source, /export async function syncWorkbench/)
  assert.match(source, /export function watchWorkbench/)
  assert.match(source, /request\('workbench'/)
  assert.match(source, /session_id/)
  assert.match(source, /1500/)
  assert.match(source, /revision/)
  assert.match(source, /applyingRemote/)
  assert.match(source, /dirty/)
  assert.match(source, /clearTimeout\(postTimer\)/)
  assert.match(source, /clearTimeout\(pollTimer\)/)
  assert.match(source, /setDesk\(\{ view: data\.view, focusId: data\.focusId \}\)/)
})

test('保存目录可从设置选择，HeroTile 通过统一守卫后再保存成稿', () => {
  const settings = read('settings.jsx')
  const source = studio()
  assert.match(settings, /选择文件夹/)
  assert.match(settings, /pickDirectory\(\)/)
  assert.match(source, /saveProducedWithDirectory/)
  assert.match(source, /pickDirectory/)
  assert.match(source, /saveSettings/)
  assert.match(source, /saveProduced/)
})

test('成稿模型文案不再冒充原生 Chat 模型', () => {
  const source = read('modelpick.jsx')
  assert.match(source, /成稿模型/)
  assert.match(source, /原生 Chat/)
  assert.doesNotMatch(source, /助手模型/)
})

test('新增 BISHENG 文案均有英文翻译，原生助手/分栏/抽屉/保存/会话提示不夹中文', async () => {
  const { EN } = await import('../client/en/index.js')
  const missing = []
  for (const file of ['workbench.jsx', 'modelpick.jsx', 'settings.jsx', 'studio.jsx', 'desk.js']) {
    const source = read(file)
    for (const match of source.matchAll(/\bt\(\s*'((?:\\.|[^'\\])*)'/g)) {
      const key = match[1].replaceAll('\\n', '\n')
      if (!EN[key]) missing.push(`${file}: ${key}`)
    }
  }
  assert.deepEqual(missing, [])

  const required = [
    '成稿模型',
    '只用于一键成稿与内容规划；不指定时跟随 DeepSeek Harness 默认模型。右侧原生 Chat 的模型仍由宿主会话决定。',
    '成稿模型已切换',
    '原生对话助手',
    '宿主原生 Chat',
    '选择资料位置并开始对话',
    '选择一份资料位置，即可让原生助手读取工作区并联动管理内容。',
    '当前宿主尚未注入对话节点，选择目录后会话就绪时显示。',
    '原生对话节点尚未就绪，请稍后重试或切换会话。',
    '调整业务区与原生对话宽度',
    '原生对话宽 {width} 像素',
    '拖动调整宽度；左右方向键微调，Home 或双击恢复默认',
    '关闭原生对话抽屉',
    '选择文件夹',
    '当前宿主未提供目录选择器',
    '创建的会话不属于当前工作台',
    '请先打开当前工作台会话',
    '会话尚在切换，请稍后重试',
    '原生会话输入尚未就绪',
    '已追加到右侧原生对话草稿，请检查后发送。',
    '让原生助手改',
    '选段：「{text}」',
    '请根据定位修改当前成稿，并在修改后同步工作台。\nfocusId: {focusId}\n对象：{label}{selection}',
    '请调整当前成稿，并在修改后同步工作台。\nfocusId: {focusId}\n建议：{suggestion}',
    '正在打开…',
    '快捷问题',
    '设置已保存',
    '已保存到 {path}',
  ]
  for (const key of required) {
    assert.ok(EN[key], `缺少英文翻译：${key}`)
    assert.doesNotMatch(EN[key], /[一-鿿]/, `英文翻译仍含中文：${key}`)
  }
})

test('clampDockWidth 纯函数覆盖最小、最大、容器收缩和非法输入边界', async () => {
  const { clampDockWidth } = await import('../client/dock-layout.js')
  assert.equal(clampDockWidth(319, 1280), 320)
  assert.equal(clampDockWidth(320, 1280), 320)
  assert.equal(clampDockWidth(721, 1280), 720)
  assert.equal(clampDockWidth(500.4, 1280), 500)
  assert.equal(clampDockWidth(undefined, 1280), 380)
  assert.equal(clampDockWidth(Number.NaN, 1280), 380)
  assert.equal(clampDockWidth(Number.POSITIVE_INFINITY, 1280), 380)
  assert.equal(clampDockWidth(720, 1000), 520)
  assert.equal(clampDockWidth(380, 900), 380)
  assert.equal(clampDockWidth(720, 800), 320)
  assert.equal(clampDockWidth(720, 640), 320)
})

test('保存目录守卫：沿用已有目录，取消或设置失败都不写成稿', async () => {
  const { saveProducedWithDirectory } = await import('../client/save.js')
  const run = async ({ folder, saved = true, exportDir = '' }) => {
    const calls = []
    const result = await saveProducedWithDirectory('item-1', {
      settings: { exportDir },
      pickDirectory: async () => { calls.push('pick'); return folder },
      saveSettings: async payload => { calls.push(['settings', payload]); return saved },
      saveProduced: async id => { calls.push(['produce', id]) },
    })
    return { calls, result }
  }

  const cancelled = await run({ folder: null })
  assert.equal(cancelled.result, false)
  assert.deepEqual(cancelled.calls, ['pick'])

  const failed = await run({ folder: '/chosen', saved: false })
  assert.equal(failed.result, false)
  assert.deepEqual(failed.calls, ['pick', ['settings', { exportDir: '/chosen' }]])

  const chosen = await run({ folder: '/chosen' })
  assert.equal(chosen.result, true)
  assert.deepEqual(chosen.calls, ['pick', ['settings', { exportDir: '/chosen' }], ['produce', 'item-1']])

  const existing = await run({ folder: null, exportDir: '/existing' })
  assert.equal(existing.result, true)
  assert.deepEqual(existing.calls, [['produce', 'item-1']])
})
