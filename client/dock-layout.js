// 原生对话分栏的纯布局规则；窄屏由组件切换为抽屉，不压缩业务区。
export const DOCK_WIDTH_DEFAULT = 380
export const DOCK_WIDTH_MIN = 320
export const DOCK_WIDTH_MAX = 720
export const BUSINESS_WIDTH_MIN = 480
export const DOCK_LAYOUT_KEY = 'bisheng-media-desk-layout-v1'

export function clampDockWidth(value, containerWidth = 1280) {
  const max = Math.max(DOCK_WIDTH_MIN, Math.min(DOCK_WIDTH_MAX, containerWidth - BUSINESS_WIDTH_MIN))
  const numeric = Number(value)
  const preferred = Number.isFinite(numeric) ? numeric : DOCK_WIDTH_DEFAULT
  return Math.round(Math.min(max, Math.max(DOCK_WIDTH_MIN, preferred)))
}
