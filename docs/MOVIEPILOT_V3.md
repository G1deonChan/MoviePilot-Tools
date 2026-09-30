# MoviePilot v3 适配说明

扩展版本：2.0.3。主要源码基准：MoviePilot v3.0.10-1。

2.0.3 修复 NexusPHP 标题清理：从 `站点 :: 种子详情 "资源名" - Powered by NexusPHP` 提取资源名，保留 WEB-DL 和发布组。已对真实实例的指定种子进行只读核验：Cookie 可正常读取详情，资源首页未命中，但完整资源名搜索匹配指定编号。此次没有提交下载任务。

2.0.2 修复详情页推送的种子定位：资源首页未匹配后搜索页面标题并有限翻页（浏览和搜索各最多 3 页），支持复数路径、相对地址和动态下载标记。只接受详情地址或编号匹配；未匹配不再直接断言 Cookie 失效。

## 改动

- `core/mp-response.ts` 识别 `{ success, message, data }` 响应并提取业务数据；直接响应继续可读。空数据操作结果和失败明细保留，插件自定义协议不拆包。
- HTTP 层将 `success: false` 视为失败并提取统一错误。403 权限不足不触发重新登录或清理账号；401 仍只重试一次。
- 登录前查询初始化状态；尚未初始化时引导使用 MoviePilot 网页。MFA challenge 保留验证方式并提示填写验证码。会话检查使用普通用户也可访问的当前用户接口。
- 下载请求使用 `media_source + media_id`，来源专用调用参数在服务边界转换。磁力和种子 URL 走原生 `/download/add`；`requires_confirmation` 明确为 true 时才询问用户，再提交 `allow_unrecognized: true`。
- 插件页面拉取当前用户的备用流程读取响应内层；MoviePilotTools 插件 404 显示安装提示。插件备份和插件直接下载协议保持独立。

本地账号、凭据、TOTP、加密仓与备份格式不变。此次只兼容读取直接响应，不承诺完整 MoviePilot v2 回归，也没有新增完整音乐管理页面。

## 安装

1. 解压 `MoviePilot-tools-2.0.3-chrome.zip`。
2. 打开 Chrome 或 Edge 扩展管理页，启用开发者模式，加载解压后的目录。
3. 已有安装优先在原扩展上使用“重新加载”，保留扩展 ID 和原有数据。更换安装身份前应通过扩展导出加密备份。
4. 刷新已打开的 PT 站点页面，使详情页浮动入口使用新版标题提取逻辑。
5. 用现有 MoviePilot 账号登录。插件备份需要另行安装支持 v3 的 MoviePilotTools 配套插件。

没有预编译 ZIP 时，可按下方命令从源码构建，加载 `.output/chrome-mv3/`，或解压 `.output/MoviePilot-tools-2.0.3-chrome.zip`。

## 验证

本次版本验证：231 项单元测试通过；TypeScript 检查、ESLint、注释和依赖方向检查、Chrome MV3 构建及 ZIP 打包通过。普通测试默认跳过 6 项需要实例连接的只读联调。

真实实例只读联调使用修改后的登录、HTTP 和业务服务：当前用户、站点列表及站点字典、下载器、目录、任务、助手能力/命令/会话，以及媒体识别和指定详情页种子定位，共 6 项通过。联调凭据仅由当前进程环境传入，私有数据只存内存，不写源码、报告或持久化仓。

测试实例的 MoviePilotTools 插件 health 返回 404，配套插件备份及直接下载未实测。iframe 嵌入和扩展按钮点击未完成浏览器端到端验证。未在实例上添加、暂停或删除真实下载任务，未修改站点 Cookie，未发送助手对话或上传附件。

构建包含原项目的 OCR 经典脚本和打包体积提示，构建能够正常完成；OCR 模型仍使用用户导入的离线包。

## 复现检查

```powershell
npm ci --no-audit --no-fund
npx wxt prepare
npm test -- --maxWorkers=2 --minWorkers=1
npx tsc --noEmit
npm run lint
npm run lint:comments
npm run lint:deps
npm run zip
```

可选只读联调：在当前进程配置 `MPT_TEST_BASE_URL`、`MPT_TEST_USERNAME`、`MPT_TEST_PASSWORD` 后运行 `npx vitest run tests/mp-v3-live.test.ts --maxWorkers=1 --minWorkers=1`。如需核验特定种子的定位，还需设置 `MPT_TEST_TARGET_PAGE`（详情页地址）和 `MPT_TEST_TARGET_TITLE`（资源名）；未配置时跳过此项。结束后清理环境变量。

请仅在本机通过进程环境提供连接信息，不要将实际账号、密码、Token、Cookie、内网地址、带 passkey 的链接或测试输出提交到仓库。
