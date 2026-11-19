# BISHENG 适配问题与验收记录

## 2026-11-12 上游插件不是 Desktop 原生工作台

- 用户可见症状：上游版本只能注册侧栏页面，并自带一套助手；无法出现在 BISHENG 的工作台切换器中，也不能由原生 Chat 按会话操作。
- 直接证据：上游 `client/index.jsx` 使用 `slots.inject('main')` 与 `sidebar.panellist`；`package.json` 仅声明 `@deepseek-ai/dsh-client-runtime`；没有 `desktopWorkbenches`、`desktopWorkbenchOwnership` 或 Agent 工具。
- 根因：上游采用通用 DSH 页面插件契约，而 BISHENG 工作台要求独立包、工作台注册、原生会话归属和业务工具契约。
- 无效/错误尝试：无；没有通过复制另一个工作台 ID、停用现有条目或新增同名客户端模块绕过。
- 最终修改：改为 `customFrame` 业务整页和按需原生 `conversation`；增加 `media_workbench` 工具、会话视图同步和原生目录选择器。详细契约见 `docs/bisheng-workbench.md`。
- 配置与部署位置：包 `dsh-media-desk@2.7.0-bisheng.0`，Cordis id `media-desk`，工作台身份 `woniuniuniu/dsh-media-desk`，数据根 `dshHomePath('media-desk')`。
- 刷新/重载要求：首次安装及 Host 变更后重启 Harness；普通页面刷新不重载 Host。
- 自动化验证：`pnpm test` 141/141 通过（含真实 dist loader）；`pnpm check` 51/51 通过；Host/client 语法检查与 `git diff --check` 通过。tarball 已核对，包含 Host、client、patch、素材、LICENSE 与说明，约 3.1MB。
- 实际 GUI 验证：安装并重启后，已添加/固定列表出现 `woniuniuniu/dsh-media-desk`；真实窗口中打开过成稿页，右侧显示“助手 · 宿主原生 Chat”，宿主目录选择器可打开。取消目录选择未创建新目录。
- 尚未验证：真实模型/生图额度、Monid 真实账号、真实发布平台（本插件本就不自动发布）；分隔条拖拽和键盘的可靠 GUI 证据仍待补。
- 下次避免方式：先核对 Desktop 工作台规范与实际组合配置，不以“通用 DSH 插件可加载”代替“原生工作台可用”。

## 2026-11-12 固定对话栏不满足双栏工作台交互基线

- 用户可见症状：主助手固定 336px，成稿助手固定 320px；窗口变窄时只能覆盖内容，无法按任务调整宽度。
- 直接证据：上游 `client/styles.css` 的 `--dock-w:336px`、`--chat-w:320px`；没有分隔条、键盘调整或布局持久化。
- 根因：上游布局只处理开关和视觉抽屉，没有独立分栏控制器与可访问语义。
- 无效/错误尝试：不复用灵感画布拖拽；它缺少 Pointer Capture、取消与卸载清理，不能当分栏实现。
- 最终修改：业务整页 + 右侧原生 Chat；新增 12px 命中分隔条，默认 380px、320–720px、业务至少 480px，支持触控、方向键、Home、双击和独立 localStorage；小屏改抽屉。成稿页不再保留第二套聊天栏。
- 配置与部署位置：布局键 `bisheng-media-desk-layout-v1`，只存宽度数值。
- 刷新/重载要求：客户端构建并加载后生效；宽度刷新后恢复。
- 自动化验证：客户端契约、英文词典、宽度边界与真实构建 loader 均通过；完整套件 141/141，包静态检查 51/51。
- 实际 GUI 验证：原生 Chat 与业务区已同屏出现；目录选择器取消路径已实测。前台会话频繁变化导致合成点击落到其他会话，分隔条拖动、键盘、双击、刷新、小屏和模式切换没有形成可靠证据，不能标为通过。
- 尚未验证：拖动后的实际宽度、键盘/Home/双击、刷新后宽度恢复、取消/移出窗口、小屏抽屉与模式切换，仍需在稳定的前台页面人工复核。
- 下次避免方式：凡业务区与对话区并列，默认实现可调分隔条并做真实界面验收，不把固定 flex 宽度当成完成。

## 2026-11-12 defineTool 拒绝排期参数的联合 type 数组

- 用户可见症状：若直接安装该中间版本，Host 会在注册 `media_workbench` 时失败，整个插件无法加载。
- 直接证据：`test/workbench-tool.test.js` 首轮 11 项均在 `defineTool` 编译阶段报 `UNSUPPORTED_SCHEMA`：`parameters.scheduledAt.type must be ... or use oneOf`。
- 根因：参数写成 `type: ['string', 'null']`，当前宿主工具 DSL 只接受单类型或 `oneOf`。
- 无效/错误尝试：没有通过关闭参数校验或删除排期能力规避。
- 最终修改：改为 `scheduledAt: { oneOf: [{ type: 'string' }, { type: 'null' }] }`；同时按宿主实际返回的 `parameters.properties.action` 调整契约测试，参数类型错误允许宿主英文 `must be a string`。
- 配置与部署位置：`src/workbench-tool.js` 与 `test/workbench-tool.test.js`。
- 刷新/重载要求：重启 Harness 后加载修正后的 Host。
- 自动化验证：修正后工具可创建，归属、脱敏、操作、长任务和路由测试通过；最终完整套件 141/141。
- 实际 GUI 验证：原生 Chat 已显示，目录选择器可打开；未发送真实 Agent 排期请求。
- 尚未验证：真实 Agent 的自然语言排期，只使用 mock 会话做工具验收，不消耗真实模型额度。
- 下次避免方式：新增工具先用当前 `defineTool` 做创建 smoke，不能只验证自定义 execute 函数。

## 2026-11-12 Monid 子进程继承宿主全部环境变量

- 用户可见症状：没有直接界面异常；但调用 Monid 时，宿主环境中与本功能无关的凭证也会对第三方 CLI 可见。
- 直接证据：上游 `src/monid.js` 使用 `{ ...process.env, PATH: found.path, NO_COLOR: '1' }`。
- 根因：为保留 CLI 运行环境而整体继承 `process.env`，没有区分运行必需变量和其他服务密钥。
- 无效/错误尝试：没有通过读取、打印或保存真实密钥来验证；使用 dummy 环境变量回归。
- 最终修改：仅传递系统运行、区域、临时目录、证书与 `MONID_*` 自有配置白名单，覆盖 PATH 和 NO_COLOR；Electron 仅在 Windows CLI 入口需要时设置 `ELECTRON_RUN_AS_NODE`。
- 配置与部署位置：`src/monid.js` 的 `createMonidRunner()`；回归在 `test/host.test.js`。
- 刷新/重载要求：重启 Harness 后生效。
- 自动化验证：定向安全回归通过；最终完整套件 141/141。dummy 宿主密钥未进入子进程 env，dummy `MONID_*` 配置保留；另补 Windows `USERPROFILE/HOMEDRIVE/HOMEPATH` 白名单兼容。
- 实际 GUI 验证：未调用真实 Monid，避免产生费用；本项由进程参数 mock 验证。
- 尚未验证：真实 Monid 版本是否依赖额外非敏感环境变量；如遇兼容问题应按明确变量补充，不恢复整体继承。
- 下次避免方式：第三方进程默认最小环境白名单，参数数组 `execFile`，不经过 Shell，不把“没有读取密钥”误写成“子进程接触不到任何密钥”。

## 2026-11-12 本机安装、部署与真实界面证据

- 安装来源：`dsh-media-desk-2.7.0-bisheng.0.tgz`，通过打包版 `dsh plugin --profile web add <绝对路径>` 安装，退出码 0。
- 配置备份：`profiles/web/backup-media-desk-20261112-1205/`，安装前 `package.json` 与 `cordis.yml` 已用 `cmp` 核验。
- 最终组合配置：`--dump-config` 输出中只有一条 `id: media-desk`、`name: dsh-media-desk`、`version: 2.7.0-bisheng.0`、`workbench: true`，`root` 为 `dshHomePath('media-desk')`；stderr 未检索到 name mismatch、duplicate 或媒体相关警告。
- 部署一致性：实际 `node_modules/dsh-media-desk` 的 Host、workbench 模块、client 和 patch 与源码 `cmp` 一致；client SHA-256 为 `39c53fb15e4d35defbf82b3a74353f6a2d67ce9186ff9aff78d4111bc7cc0005`，随后加入英文词典后最终构建为 261.3KB，打包与安装复核均通过。
- 重启后注册：`desktop-workbenches/state.json` 的 `added` 与 `pinned` 均包含 `woniuniuniu/dsh-media-desk`。
- 真实 GUI 已观察：成稿页显示灵感、体裁、风格、修改建议、稿面与分镜；右侧显示“助手 · 宿主原生 Chat”；目录选择器为宿主的 `Select Workspace Directory`。取消后未创建新目录或保存成稿。
- GUI 未形成可靠证据：分隔条实际拖动、键盘/Home/双击、刷新恢复、小屏抽屉、原生 Agent 自然语言工具调用。合成点击在前台多会话间发生误命中，因此这些项目不标为通过。
- 未调用：真实文字模型、真实生图、真实 Monid、真实发布平台；未读取或输出真实 API Key。
- 临时材料：目标窗口截图、OCR 文本、辅助鼠标/键盘脚本在验收结束后清理，不纳入交付包。
- 重载条件：代码 Host 与工具已在用户手动重启后加载；若后续再改 `src/`，仍需再次重启 Harness。

## 2026-11-19 原作者署名、公开仓库与市场发布结果

- 作品归属：工作台顶部常驻「原作者 蜗牛的科技笔记」，链接原作者公开主页；README、NOTICE 与 MIT LICENSE 均保留原作者署名。适配维护者为 `caisiyang123`。
- 公开仓库：`https://github.com/caisiyang123/dsh-media-desk-bisheng`。
- 最终包：`dsh-media-desk-bisheng@1.0.0`，Release 固定资产 `dsh-media-desk-bisheng.tgz`，SHA-256 `e2d154f6cbb111c104053978420c7a110b6ca0dbf165aa7bfa877064ad50b4e0`，大小 3,253,823 bytes。
- 安装迁移：旧包 `dsh-media-desk` 已移除，新包安装到当前 profile；`desktop-workbenches/state.json` 的记录保留旧历史身份，但当前安装与 bundle 均为新包。业务数据目录 `dshHomePath('media-desk')` 未删除。
- 重启后真实界面：成功打开「自媒体工作台 · BISHENG 版」，确认五个业务导航、示例数据、宿主原生 Chat 入口和顶部「原作者 蜗牛的科技笔记」。
- 市场截图：`docs/images/bisheng-overview.jpg`，2848×1602、688,615 bytes，来自最终安装版本；已裁掉左侧个人会话和右侧聊天，只保留业务区与署名。
- 市场投稿：PR [#87](https://github.com/dataelement/awesome-dsh-workbench/pull/87)，仅新增 `data/workbenches/caisiyang123__dsh-media-desk-bisheng.yml`。
- 自动检查：`validate`、`Trusted catalog probe`、`Workbench security review`、`Run trusted security reviewer`、`Feishu workbench brief` 全部 SUCCESS。
- 合并与发布：PR 于 2026-11-19T07:04:58Z 合并（merge commit `e39694d0`）；`Publish workbench index` 工作流 44476877809 成功。
- 上架证据：线上 `https://market.dshdesktop.com/index.json` 已包含 `caisiyang123/dsh-media-desk-bisheng`，共 29 个工作台；版本 1.0.0、GitHub Release 分发、1 张截图、probe 状态 ok。
- 仍需注意：未调用真实模型、生图、Monid 或发布平台；分隔条拖拽和真实 Agent 工具调用未形成完整 GUI 录屏，但代码级与真实加载测试已覆盖。市场页面已可见，不等于市场对后续版本的持续安全审计。
