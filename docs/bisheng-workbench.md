# 自媒体工作台 · BISHENG 版

基于 [woniuniuniu/dsh-media-desk](https://github.com/woniuniuniu/dsh-media-desk) `main@b72f964e995dad2f7886994accf7bc49edd160cd` 适配。上游许可证为 MIT，原作者为「蜗牛的科技笔记」。本适配版的公开仓库为 [caisiyang123/dsh-media-desk-bisheng](https://github.com/caisiyang123/dsh-media-desk-bisheng)。

- 适配版本：`1.0.0`
- npm 包名与工作台身份：`dsh-media-desk-bisheng` / `caisiyang123/dsh-media-desk-bisheng`
- 工作台规范：[2026-10-27 版](https://dshdesktop.com/workbench/docs/development.md)
- 目标环境：BISHENG Desktop 1.2.0 / 内置 Harness `0.2.1-rc.2`（包范围 `>=0.2.1-rc.2 <0.3.0`）
- 工作台名称：自媒体工作台 · BISHENG 版

工作台顶部常驻「原作者：蜗牛的科技笔记」署名并链接原作者主页。上游 npm 包 `dsh-media-desk` 与本适配包相互独立；本包通过 GitHub Release 发布。订阅生图工具按宿主能力软探测，不可用时继续使用原有 HTTP 图片 API 或纯文字封面，不把该能力当成加载前提。

## 使用体验

保留上游的五个业务页面：

1. **灵感**：记录文字、金句、链接、图片和视频，散落画布与信息流切换。
2. **内容**：按灵感、成稿、待发布、已发布管理，支持看板和表格。
3. **排期**：月历、连续记录、下一条内容与拖拽排期。
4. **复盘**：手动或 CSV 数据、趋势、平台分布、最佳内容和写作规则建议。
5. **风格**：预设风格、自定义风格提炼、写作规则和 Skill 导出。

点开灵感后可生成口播脚本或文章、标题、封面字、视频封面、配图和分镜。任务在 Host 后台执行，页面显示实际阶段和素材完成数；可以取消、失败后重试或单张重画。没有文字模型时只提供明确标注的结构草稿，没有生图配置时保留文字与纯文字封面能力。

## BISHENG 原生工作台适配

- 通过 `desktopWorkbenches.register()` 注册，不再占用旧 `main` / `sidebar.panellist` 插槽。
- 采用 **业务整页 + 按需原生 Chat**。业务功能无需先创建会话；只有使用 AI 助手时，才通过宿主目录选择器选择资料位置并创建工作台会话。
- 右侧对话是宿主传入的原生 `conversation` 节点，不复制聊天界面，不自动发送草稿。
- 对话栏默认 380px，可在 320–720px 内调整，并为业务区保留至少 480px。支持鼠标/触控拖拽、方向键、Home、双击恢复和刷新后宽度恢复。窄容器降级为抽屉。
- 成稿页不再内嵌第二套聊天栏；创作设置、真实进度和稿面留在业务区，改稿请求进入右侧原生 Chat。

## 原生 Chat 能做什么

`media_workbench` 工具只允许归属「自媒体工作台」的 Agent 会话调用。回答“当前灵感”“这篇稿子”前应先读取 `context`，不能根据旧对话猜测。

| 动作 | 用途 |
| --- | --- |
| `context` | 读取当前页面、选中灵感、成稿、风格和生成状态 |
| `search` | 搜索灵感与内容 |
| `navigate` / `open_item` | 切换五个页面或打开指定灵感 |
| `capture` | 记录笔记、金句或安全抓取的公开链接 |
| `update_item` / `schedule` | 修改内容、状态、平台与排期 |
| `set_style` / `set_format` | 切换写作风格、脚本/文章体裁 |
| `produce` | 启动一键成稿；覆盖已完成稿必须显式 `regenerate` |
| `production_status` / `cancel_produce` | 查询真实任务状态或取消 |
| `revise` | 修改标题、正文、封面字、画面描述和分镜；需要时重画 |
| `insights` | 读取复盘汇总 |

工具不开放图片 API Key、账号导入密钥、任意文件写、导出目录修改或 Shell。生成文字和图片会消耗用户自己的模型额度，Agent 不应擅自反复重试。

## 本地数据与保存位置

- 内容、聊天历史、素材和设置保存在宿主解析的 `dshHomePath('media-desk')`，与上游 `$DSH_HOME/media-desk` 位置一致，卸载插件不删除。
- 每个工作台会话仅额外保存当前页面和选中灵感，不同会话不会互相覆盖这个选择。
- 图片 Key 与内容分开保存在权限 `0600` 的 `settings.json`；浏览器只获得是否已配置及末四位。
- 首次保存成稿或修改保存位置时，使用宿主目录选择器。取消选择不会创建目录或保存成稿。
- 布局偏好的 `localStorage` 只保存对话栏宽度，不保存密钥、正文、报告或业务记录。
- 插件不自动发布到任何内容平台。“已发布”只是本地状态。

## 构建与检查

本机没有独立 npm 命令时使用 pnpm：

```bash
pnpm install
pnpm test
pnpm build
pnpm check
pnpm pack
```

发布包必须包含 `src/host.js`、构建后的 `dist/client.js`、`cordis.patch.yml`、素材和本说明。静态检查不能替代从 `.tgz` 安装后的真实界面验收。

修改 `src/` 后需要重启 Harness；只刷新页面不会重载 Host。客户端是否热更新取决于当前开发 watcher 和宿主加载状态，交付时以实际加载验证为准。

## 保留的安全边界

- 所有 `/media-desk` 请求继续经过宿主鉴权，写请求拒绝跨站调用。
- 公开 URL 抓取和图片下载继续执行协议、DNS、内网与重定向检查。
- 模型输出只通过白名单操作和长度限制进入业务状态。
- 上传限制文件类型和大小，素材路由防止路径穿越。
- Monid 仅用于导入用户自己的公开账号内容，调用不经过 Shell。
- 本适配版不读取或打印真实 API Key，不用真实付费模型请求做布局、工具和限流测试。
