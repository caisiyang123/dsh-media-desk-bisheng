// 成稿落盘前必须已有明确目录。取消目录选择或设置写入失败时，不继续保存成稿。
export async function saveProducedWithDirectory(id, { settings, pickDirectory, saveSettings, saveProduced }) {
  if (!settings?.exportDir?.trim()) {
    const exportDir = await pickDirectory()
    if (!exportDir) return false
    if (!await saveSettings({ exportDir })) return false
  }
  await saveProduced(id)
  return true
}
