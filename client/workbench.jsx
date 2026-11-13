// BISHENG 原生 Chat 与工作台之间的桥：会话归属、草稿、分栏和视图同步。
import React from 'react'
import { report, setDesk, toast, useDesk, watchWorkbench } from './desk.js'
import { clampDockWidth, DOCK_LAYOUT_KEY, DOCK_WIDTH_DEFAULT, DOCK_WIDTH_MAX, DOCK_WIDTH_MIN } from './dock-layout.js'
import { t } from './i18n.js'
import { Icon } from './ui.jsx'

const WorkbenchContext = React.createContext(null)

const GLOBAL_SUGGESTIONS = [
  '记一下：地铁广告牌那句「慢一点也算到达」可以当开头',
  '接下来有什么排期？',
  '以后标题都不要超过 20 个字',
  '把今天最好的灵感一键成稿',
]

function loadDockWidth() {
  try {
    const saved = JSON.parse(localStorage.getItem(DOCK_LAYOUT_KEY) || '{}')
    return clampDockWidth(saved.width)
  } catch {
    return DOCK_WIDTH_DEFAULT
  }
}

function saveDockWidth(width) {
  try {
    // 只持久化一个布局偏好；业务视图、会话和正文不进入 localStorage。
    localStorage.setItem(DOCK_LAYOUT_KEY, JSON.stringify({ width }))
  } catch {
    // 隐私模式或存储已满时保留本次布局即可。
  }
}

export function useWorkbench() {
  const value = React.useContext(WorkbenchContext)
  if (!value) throw new Error('useWorkbench 必须在 WorkbenchProvider 内使用')
  return value
}

export function WorkbenchProvider({ ctx, service, entry, conversation, children }) {
  const dockOpen = useDesk(state => state.dockOpen)
  const [host, setHost] = React.useState(() => service?.getSnapshot?.() ?? null)
  const [, refreshSession] = React.useState(0)
  const [containerWidth, setContainerWidth] = React.useState(1280)
  const [dockWidth, setDockWidth] = React.useState(loadDockWidth)
  const [resizing, setResizing] = React.useState(false)
  const [chatStarting, setChatStarting] = React.useState(false)
  const rootRef = React.useRef(null)
  const dockWidthRef = React.useRef(dockWidth)
  const resizeCleanupRef = React.useRef(null)
  const startingRef = React.useRef(false)

  React.useEffect(() => {
    if (!service?.subscribe) return undefined
    return service.subscribe(() => setHost(service.getSnapshot()))
  }, [service])

  React.useEffect(() => {
    const current = ctx.uiSession?.current
    if (!current?.subscribe) return undefined
    return current.subscribe(() => refreshSession(value => value + 1))
  }, [ctx])

  const sid = service?.currentSession?.() ?? null
  const owned = sid && host?.state?.sessionBindings?.[sid] === entry?.id ? sid : null

  React.useEffect(() => {
    if (!owned) return undefined
    return watchWorkbench(owned)
  }, [owned])

  React.useEffect(() => {
    const el = rootRef.current
    if (!el) return undefined
    const measure = (width) => {
      if (!Number.isFinite(width) || width <= 0) return
      setContainerWidth(width)
      const next = clampDockWidth(dockWidthRef.current, width)
      dockWidthRef.current = next
      setDockWidth(next)
    }
    measure(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([observed]) => measure(observed.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => () => {
    resizeCleanupRef.current?.()
    resizeCleanupRef.current = null
  }, [])

  const setDockOpen = React.useCallback((value) => {
    setDesk(state => ({ dockOpen: typeof value === 'function' ? value(state.dockOpen) : Boolean(value) }))
  }, [])

  const updateDockWidth = React.useCallback((value, persist = false) => {
    const width = rootRef.current?.getBoundingClientRect().width || 1280
    const next = clampDockWidth(value, width)
    dockWidthRef.current = next
    setDockWidth(next)
    if (persist) saveDockWidth(next)
    return next
  }, [])

  const startDockResize = React.useCallback((event) => {
    if (event.button != null && event.button !== 0) return
    event.preventDefault()
    resizeCleanupRef.current?.()
    const handle = event.currentTarget
    const pointerId = event.pointerId
    const startX = event.clientX
    const startWidth = dockWidthRef.current
    setResizing(true)
    try { handle.setPointerCapture(event.pointerId) } catch { /* 老宿主仍可接收普通指针事件 */ }

    const move = (moveEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      updateDockWidth(startWidth + startX - moveEvent.clientX)
    }
    const removeListeners = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
    }
    const finish = (finishEvent) => {
      if (finishEvent?.pointerId != null && finishEvent.pointerId !== pointerId) return
      removeListeners()
      resizeCleanupRef.current = null
      setResizing(false)
      saveDockWidth(dockWidthRef.current)
      try {
        if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId)
      } catch { /* 指针已取消时无需再释放 */ }
    }
    resizeCleanupRef.current = () => {
      removeListeners()
      saveDockWidth(dockWidthRef.current)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
  }, [updateDockWidth])

  const resizeWithKeyboard = React.useCallback((event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return
    event.preventDefault()
    if (event.key === 'Home') return updateDockWidth(DOCK_WIDTH_DEFAULT, true)
    const delta = event.key === 'ArrowLeft' ? 16 : -16
    updateDockWidth(dockWidthRef.current + delta, true)
  }, [updateDockWidth])

  const pickDirectory = React.useCallback(async () => {
    if (!ctx.uiWorkspace?.pickDirectory) {
      toast(t('当前宿主未提供目录选择器'), { error: true })
      return null
    }
    try {
      return await ctx.uiWorkspace.pickDirectory()
    } catch (error) {
      report(error)
      return null
    }
  }, [ctx])

  const startConversation = React.useCallback(async () => {
    setDockOpen(true)
    if (owned) return owned
    if (startingRef.current) return null
    startingRef.current = true
    setChatStarting(true)
    try {
      const folder = await pickDirectory()
      if (!folder) return null
      const target = await ctx.desktopWorkbenches.ensureSession({ folder })
      if (target && !ctx.desktopWorkbenches.ownsSession(target)) throw new Error(t('创建的会话不属于当前工作台'))
      refreshSession(value => value + 1)
      return target || null
    } catch (error) {
      report(error)
      return null
    } finally {
      startingRef.current = false
      setChatStarting(false)
    }
  }, [ctx, owned, pickDirectory, setDockOpen])

  const askAgent = React.useCallback(async (text) => {
    const addition = String(text || '').trim()
    if (!addition) return false
    setDockOpen(true)
    try {
      const target = owned || await startConversation()
      if (!target) return false
      if (!ctx.desktopWorkbenches.ownsSession(target)) throw new Error(t('请先打开当前工作台会话'))
      const source = ctx.uiSession.current.getSnapshot()
      if (source.key !== target) throw new Error(t('会话尚在切换，请稍后重试'))
      const actions = source.props?.inputActions
      if (!actions?.setDraft) throw new Error(t('原生会话输入尚未就绪'))
      const currentDraft = source.hooks?.input?.getSnapshot?.()?.draft || ''
      actions.setDraft(currentDraft ? `${currentDraft}\n\n${addition}` : addition)
      toast(t('已追加到右侧原生对话草稿，请检查后发送。'))
      return true
    } catch (error) {
      report(error)
      return false
    }
  }, [ctx, owned, setDockOpen, startConversation])

  const value = {
    owned, conversation, rootRef, containerWidth, dockWidth, resizing, chatStarting,
    narrow: containerWidth < 1020,
    dockOpen, setDockOpen, updateDockWidth, startDockResize, resizeWithKeyboard,
    pickDirectory, startConversation, askAgent,
  }

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>
}

export function DockResizer() {
  const { containerWidth, dockWidth, startDockResize, resizeWithKeyboard, updateDockWidth } = useWorkbench()
  return (
    <div
      className="md-resizer"
      role="separator"
      tabIndex={0}
      aria-label={t('调整业务区与原生对话宽度')}
      aria-orientation="vertical"
      aria-valuemin={DOCK_WIDTH_MIN}
      aria-valuemax={clampDockWidth(DOCK_WIDTH_MAX, containerWidth)}
      aria-valuenow={dockWidth}
      aria-valuetext={t('原生对话宽 {width} 像素', { width: dockWidth })}
      title={t('拖动调整宽度；左右方向键微调，Home 或双击恢复默认')}
      onPointerDown={startDockResize}
      onKeyDown={resizeWithKeyboard}
      onDoubleClick={() => updateDockWidth(DOCK_WIDTH_DEFAULT, true)}
    >
      <span className="md-resizer-grip" aria-hidden="true" />
    </div>
  )
}

export function NativeChatDock() {
  const { owned, conversation, narrow, dockOpen, setDockOpen, chatStarting, startConversation, askAgent } = useWorkbench()
  const dockRef = React.useRef(null)
  const closeButtonRef = React.useRef(null)
  const restoreFocusRef = React.useRef(null)

  React.useEffect(() => {
    if (!narrow || !dockOpen) return undefined
    restoreFocusRef.current = document.activeElement
    closeButtonRef.current?.focus()
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        setDockOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dockRef.current) return
      const focusable = [...dockRef.current.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])')]
        .filter(el => !el.closest('[hidden]') && el.getAttribute('aria-hidden') !== 'true')
      if (!focusable.length) {
        event.preventDefault()
        closeButtonRef.current?.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dockRef.current.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dockRef.current.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      const previous = restoreFocusRef.current
      restoreFocusRef.current = null
      if (previous?.isConnected) previous.focus()
    }
  }, [narrow, dockOpen, setDockOpen])

  return (
    <>
      {narrow && dockOpen ? <button type="button" tabIndex={-1} className="md-native-scrim" aria-label={t('关闭原生对话抽屉')} onClick={() => setDockOpen(false)} /> : null}
      <aside
        ref={dockRef}
        className={`md-native-dock ${dockOpen ? 'is-open' : ''}`}
        aria-label={t('原生对话助手')}
        aria-hidden={!dockOpen ? 'true' : undefined}
        aria-modal={narrow && dockOpen ? 'true' : undefined}
        role={narrow && dockOpen ? 'dialog' : undefined}
        inert={!dockOpen ? '' : undefined}
      >
        <header className="md-native-head" data-window-drag="">
          <span className="md-native-title"><Icon name="chat" size={15} />{t('助手')}</span>
          <span className="md-native-note">{t('宿主原生 Chat')}</span>
          <span style={{ flex: 1 }} />
          <button ref={closeButtonRef} type="button" className="md-icon-btn" aria-label={t('收起对话')} title={t('收起对话')} onClick={() => setDockOpen(false)}><Icon name="close" size={16} /></button>
        </header>
        {dockOpen && !owned ? (
          <div className="md-native-empty">
            <p>{t('选择一份资料位置，即可让原生助手读取工作区并联动管理内容。')}</p>
            <button type="button" className="md-btn is-primary" onClick={startConversation} disabled={chatStarting}>
              {chatStarting ? t('正在打开…') : t('选择资料位置并开始对话')}
            </button>
            {!conversation ? <small>{t('当前宿主尚未注入对话节点，选择目录后会话就绪时显示。')}</small> : null}
          </div>
        ) : null}
        {dockOpen && owned ? (
          <div className="md-native-quick" aria-label={t('快捷问题')}>
            {GLOBAL_SUGGESTIONS.map(question => (
              <button type="button" key={question} title={question} onClick={() => askAgent(t(question))}>{t(question)}</button>
            ))}
          </div>
        ) : null}
        {dockOpen && owned && !conversation ? (
          <div className="md-native-empty" role="status"><p>{t('原生对话节点尚未就绪，请稍后重试或切换会话。')}</p></div>
        ) : null}
        {/* 不因折叠、未归属或会话切换而卸载宿主输入树。 */}
        <div className="md-native-conversation" hidden={!owned || !dockOpen}>{conversation}</div>
      </aside>
    </>
  )
}
