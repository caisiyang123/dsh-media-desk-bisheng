// dsh-media-desk 浏览器半片：customFrame 业务工作台 + 宿主原生 Chat。
import React from 'react'
import { HomeView } from './canvas.jsx'
import { ContentView } from './content.jsx'
import { captureFiles, captureUrl, dispatchOps, loadDesk, setDesk, undo, useDesk } from './desk.js'
import { InsightsView } from './insights.jsx'
import { StyleView } from './style.jsx'
import { ScheduleView } from './schedule.jsx'
import { ModelButton, ModelPicker } from './modelpick.jsx'
import { SettingsDialog } from './settings.jsx'
import { Studio } from './studio.jsx'
import css from './styles.css'
import { lang, t, useLang } from './i18n.js'
import { Dialog, FormDialog, Icon, IconButton, Toast } from './ui.jsx'
import { DockResizer, NativeChatDock, useWorkbench, WorkbenchProvider } from './workbench.jsx'

// navKey：同一个中文在别处意思不同（单数的“灵感”“风格”），英文导航另查一条
const NAV = [
  { id: 'home', label: '灵感', navKey: '灵感（导航）' },
  { id: 'content', label: '内容' },
  { id: 'schedule', label: '排期' },
  { id: 'insights', label: '复盘' },
  { id: 'style', label: '风格', navKey: '风格（导航）' },
]

const VIEWS = { home: HomeView, content: ContentView, schedule: ScheduleView, insights: InsightsView, style: StyleView }
const ORIGINAL_AUTHOR = {
  name: '蜗牛的科技笔记',
  url: 'https://www.xiaohongshu.com/user/profile/5faedce8000000000101c8a3',
}

function CaptureDialog() {
  const capture = useDesk(s => s.capture)
  const [tab, setTab] = React.useState('text')
  const [text, setText] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const fileInput = React.useRef(null)
  React.useEffect(() => {
    if (!capture) return
    setTab(capture.tab ?? 'text')
    setText('')
    setUrl('')
  }, [capture])
  if (!capture) return null
  const close = () => setDesk({ capture: null })
  const save = async (event) => {
    event.preventDefault()
    setBusy(true)
    if (tab === 'link' && url.trim()) {
      const id = await captureUrl(url.trim())
      if (id) close()
    } else if (tab === 'quote' || tab === 'text') {
      const value = text.trim()
      if (value) {
        await dispatchOps([{ op: 'add_item', kind: tab === 'quote' ? 'quote' : 'note', title: tab === 'quote' ? value : value.split(/[。！？\n]|[.!?](?=\s|$)/)[0].slice(0, 40), body: tab === 'quote' ? '' : value }], { label: t('记下灵感') })
        close()
      }
    }
    setBusy(false)
  }
  const tabs = [['text', t('笔记')], ['quote', t('金句')], ['link', t('链接')], ['file', t('图片/视频')]]
  return (
    <Dialog title={t('记下一个灵感')} onClose={close} width={480}>
      <div className="md-capture-tabs" role="tablist">
        {tabs.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <form className="md-form" onSubmit={save}>
        {tab === 'link' ? (
          <label className="md-field">
            <span>{t('链接')}</span>
            <input type="url" required value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" />
            <small>{t('会自动读取页面的标题、简介和封面。')}</small>
          </label>
        ) : tab === 'file' ? (
          <button type="button" className="md-dropzone" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" size={22} />
            <span>{t('选择图片或视频')}</span>
            <small>{t('也可以直接把文件拖到灵感墙上')}</small>
            <input ref={fileInput} type="file" hidden multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime" onChange={async (e) => { const files = [...e.target.files]; close(); await captureFiles(files) }} />
          </button>
        ) : (
          <label className="md-field">
            <span>{tab === 'quote' ? t('这句话') : t('想法')}</span>
            <textarea rows={4} required value={text} onChange={e => setText(e.target.value)} placeholder={tab === 'quote' ? t('好的选题不是想出来的……') : t('想到什么就写什么，之后再让助手补全。')} />
          </label>
        )}
        {tab === 'file' ? null : (
          <div className="md-form-foot">
            <span style={{ flex: 1 }} />
            <button type="button" className="md-btn" onClick={close}>{t('取消')}</button>
            <button type="submit" className="md-btn is-primary" disabled={busy}>{busy ? t('保存中…') : t('放到灵感墙')}</button>
          </div>
        )}
      </form>
    </Dialog>
  )
}

function SampleBadge() {
  const hasSample = useDesk(s => s.state.items.some(i => i.sample))
  if (!hasSample) return null
  return (
    <button type="button" className="md-sample" title={t('现在看到的内容都是示例，可以一键清空')} onClick={() => setDesk({
      dialog: {
        title: t('清空示例数据'),
        submitLabel: t('清空'),
        fields: [],
        onSubmit: () => dispatchOps([{ op: 'clear_samples' }], { label: t('清空示例数据') }),
      },
    })}>{t('示例数据 · 清空')}</button>
  )
}

function DeskContent() {
  // 切换语言时整棵树重新渲染
  useLang()
  const ready = useDesk(s => Boolean(s.state))
  const error = useDesk(s => s.error)
  const view = useDesk(s => s.view)
  const canUndo = useDesk(s => s.canUndo)
  const { rootRef, containerWidth, narrow, dockWidth, resizing, dockOpen, setDockOpen } = useWorkbench()

  React.useEffect(() => { loadDesk() }, [])
  React.useEffect(() => {
    const onKey = (event) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable
      if ((event.metaKey || event.ctrlKey) && event.key === 'z' && !event.shiftKey && !typing && canUndo) {
        event.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canUndo])

  const Active = VIEWS[view] ?? HomeView
  return (
    <div
      className={`md-root ${narrow ? 'is-narrow' : ''} ${containerWidth - (dockOpen && !narrow ? dockWidth : 0) < 780 ? 'is-compact' : ''} ${dockOpen ? 'has-dock' : ''} ${resizing ? 'is-resizing' : ''}`}
      ref={rootRef}
      style={{ '--dock-w': `${dockWidth}px` }}
    >
      <style>{css}</style>
      <div className="md-ambient" aria-hidden="true"><i /><i /><i /></div>
      <div className="md-main">
        <header className="md-topbar" data-window-drag="">
          <nav className="md-nav" aria-label={t('工作台导航')}>
            {NAV.map(entry => (
              <button type="button" key={entry.id} className={view === entry.id ? 'is-on' : ''} aria-current={view === entry.id ? 'page' : undefined} onClick={() => setDesk({ view: entry.id, focusId: null })}>{entry.navKey && lang() === 'en' ? t(entry.navKey) : t(entry.label)}</button>
            ))}
          </nav>
          <a
            className="md-author"
            href={ORIGINAL_AUTHOR.url}
            target="_blank"
            rel="noopener noreferrer"
            title={t('原作者：{name}。点击查看原作者主页。', { name: ORIGINAL_AUTHOR.name })}
          >
            <span>{t('原作者')}</span>
            <b>{ORIGINAL_AUTHOR.name}</b>
          </a>
          <span style={{ flex: 1 }} />
          {ready ? <SampleBadge /> : null}
          {canUndo ? <IconButton icon="undo" label={t('撤销上一步')} onClick={undo} /> : null}
          {ready ? <ModelButton /> : null}
          <IconButton icon="gear" label={t('设置')} onClick={() => setDesk({ settingsOpen: true })} />
          <button type="button" className="md-open-dock" aria-expanded={dockOpen} onClick={() => setDockOpen(value => !value)}><Icon name="chat" size={15} />{t('助手')}</button>
        </header>
        <main className="md-content" key={view}>
          {error ? (
            <div className="md-page"><p className="md-muted">{t('工作台加载失败：{error}', { error })}</p><button type="button" className="md-btn" onClick={loadDesk}>{t('重试')}</button></div>
          ) : ready ? <Active /> : <div className="md-loading"><span className="md-shimmer">{t('正在铺开灵感…')}</span></div>}
        </main>
        {ready ? <Studio /> : null}
      </div>
      {dockOpen && !narrow ? <DockResizer /> : null}
      <NativeChatDock />
      {ready ? <CaptureDialog /> : null}
      <FormDialog />
      {ready ? <SettingsDialog /> : null}
      {ready ? <ModelPicker /> : null}
      <Toast />
    </div>
  )
}

export const inject = ['desktopWorkbenches', 'uiSession', 'uiWorkspace']

export function apply(ctx) {
  function Desk({ service, entry, conversation }) {
    return (
      <WorkbenchProvider ctx={ctx} service={service} entry={entry} conversation={conversation}>
        <DeskContent />
      </WorkbenchProvider>
    )
  }

  ctx.effect(() => ctx.desktopWorkbenches.register({
    title: '自媒体工作台 · BISHENG 版',
    panelTitle: '灵感与内容创作',
    repository: 'https://github.com/caisiyang123/dsh-media-desk-bisheng',
    description: '基于「蜗牛的科技笔记」原作的 BISHENG 适配版：记一句灵感，生成脚本、封面、配图和分镜；原生 Chat 联动管理内容与排期',
    category: '内容创作',
    customFrame: true,
  }, Desk))
}
