// BISHENG 工作台包静态校验；不替代从 tarball 安装和真实 UI 验收。
// 规范：https://dshdesktop.com/workbench/docs/development.md（2026-10-27）
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(process.argv[2] || '.')
const failures = []
let passed = 0
const check = (condition, name, detail = '') => {
  if (condition) { passed += 1; console.log(`✅ ${name}${detail ? `：${detail}` : ''}`) }
  else { failures.push(name); console.error(`❌ ${name}${detail ? `：${detail}` : ''}`) }
}
const read = path => { try { return readFileSync(join(root, path), 'utf8') } catch { return '' } }
const exists = path => existsSync(join(root, path)) && statSync(join(root, path)).isFile()
const pkg = JSON.parse(read('package.json') || '{}')

console.log(`检查目录：${root}\n`)
check(/^[a-z0-9-]+$/.test(pkg.name || ''), 'npm 包名合法', pkg.name)
check(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version || ''), '版本为完整 SemVer', pkg.version)
check(pkg.type === 'module', '使用 ES Module')
check(typeof pkg.main === 'string' && exists(pkg.main), 'main 指向服务端入口', pkg.main)
check(exists(pkg.exports?.['.']), 'exports["."] 指向服务端入口', pkg.exports?.['.'])
check(exists(pkg.dsh?.bundle?.patch), 'dsh.bundle.patch 存在')
check(pkg.dsh?.client?.platform === 'web', '客户端平台为 web')
check(pkg.dsh?.client?.inject?.includes('dsh-desktop-workbenches'), '客户端加载顺序包含工作台服务')
check(exists(pkg.exports?.['./client']), 'exports["./client"] 指向构建产物', pkg.exports?.['./client'])
check(pkg.exports?.['./package.json'] === './package.json', '导出 package.json')
check(pkg.exports?.['./cordis.patch.yml'] === './cordis.patch.yml', '导出 cordis.patch.yml')
for (const path of ['src', 'dist', 'assets', 'cordis.patch.yml', 'README.md', 'LICENSE', 'NOTICE', 'docs/bisheng-workbench.md']) {
  check((pkg.files || []).includes(path), `发布文件包含 ${path}`)
}
check(!Object.keys(pkg.dependencies || {}).some(key => key.startsWith('@deepseek-ai/')), '宿主包未写入 dependencies')
for (const [name, range] of Object.entries(pkg.peerDependencies || {})) {
  if (name.startsWith('@deepseek-ai/')) check(/[<>^~]/.test(range), `peer 使用兼容范围 ${name}`, range)
}

const patch = read('cordis.patch.yml')
check(patch.includes('insert:'), 'cordis patch 使用 insert')
check(new RegExp(`name:\\s*['\"]?${pkg.name}['\"]?\\s*$`, 'm').test(patch), 'patch name 与 npm 包名一致')
check(/^\s*-?\s*id:\s*media-desk-bisheng\s*$/m.test(patch), '使用 media-desk-bisheng 插件条目 id')
check(patch.includes("dshHomePath('media-desk')"), '数据目录由宿主 dshHomePath 解析')

const server = read(pkg.exports?.['.'])
check(new RegExp(`export\\s+const\\s+name\\s*=\\s*['\"]${pkg.name}['\"]`).test(server), '服务端导出 name 与包名一致')
check(/export\s+const\s+inject\s*=/.test(server), '服务端导出 inject')
check(/export\s+const\s+Config\s*=\s*Schema\./.test(server), 'Config 使用 Schemastery schema')
check(server.includes('desktopWorkbenchOwnership'), '服务端校验工作台会话归属')
check(server.includes("path: '/media-desk'"), '业务路由使用独立 /media-desk 前缀')
check(`${server}\n${read('src/workbench-tool.js')}`.includes("name: 'media_workbench'"), '注册 media_workbench Agent 工具')
check(server.includes('systemPrompt'), '注册工作台系统提示')

const client = read(pkg.exports?.['./client'])
const escapedName = String(pkg.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
check(new RegExp(`__ModuleLoader__\\.load\\(\\{id:['\"]${escapedName}['\"]`).test(client), '客户端 loader id 与包名一致')
check(client.startsWith('window.__ModuleLoader__.load('), '客户端为单文件模块')
check(client.includes('desktopWorkbenches.register'), '注册 Desktop 工作台')
check(!client.includes('workbenchId'), '未使用旧 workbenchId')

const source = read('client/index.jsx')
const workbenchSource = `${read('client/workbench.jsx')}\n${read('client/dock-layout.js')}`
check(source.includes('customFrame: true'), '使用业务整页 + 按需原生对话')
check(source.includes("repository: 'https://github.com/caisiyang123/dsh-media-desk-bisheng'"), '使用真实投稿仓库身份')
check(source.includes('原作者：{name}。点击查看原作者主页。'), '工作台顶部注明原作者')
check(source.includes('md-author'), '原作者署名可见')
check(source.includes('conversation'), '业务组件接收宿主 conversation')
check(!source.includes("slots.inject('main'"), '未注册旧 main 全局面板')
check(!source.includes('sidebar.panellist'), '未复制宿主侧栏入口')
check(source.includes("inject = ['desktopWorkbenches', 'uiSession', 'uiWorkspace']"), '客户端声明原生会话依赖')
check(workbenchSource.includes('role="separator"'), '提供可访问分隔条')
check(workbenchSource.includes('setPointerCapture'), '分隔条使用 Pointer Capture')
check(workbenchSource.includes("'pointercancel'"), '分隔条处理 pointercancel')
check(workbenchSource.includes("event.key === 'Home'"), '分隔条支持 Home 恢复')
check(workbenchSource.includes('onDoubleClick'), '分隔条支持双击恢复')
check(workbenchSource.includes('bisheng-media-desk-layout-v1'), '布局使用独立持久化键')
check(workbenchSource.includes('pickDirectory'), '会话和保存位置使用宿主目录选择器')

console.log(`\n${failures.length ? `FAIL：${failures.length} 项` : 'PASS：全部静态检查通过'}（${passed} 项通过）`)
process.exit(failures.length ? 1 : 0)
