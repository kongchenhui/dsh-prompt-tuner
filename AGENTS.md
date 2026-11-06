# AGENTS.md — dsh-prompt-tuner

给在本仓库工作的 AI 编码代理的项目约定，只写本项目特有的规则。

包名 `@kongchenhui/dsh-prompt-tuner`：一个 DeepSeek Harness 插件，在输入框工具栏加一个按钮，把当前草稿改写成更清晰、可执行的提示词。

## 项目概览

- 双端结构：宿主端跑在 Node（设置文件、模型调用、原生打开器、HTTP 路由），浏览器端是注入 harness 的 React 控件与设置页。
- 纯 TypeScript（ESM、strict），React 18 函数组件 + CSS Modules；构建用 tsdown + lightningcss，类型用 tsc，测试用 vitest。
- Node ≥ 22.19.0，harness ≥ 0.2.1-rc.5（见 `package.json` 的 `engines`）。
- 不引入运行时依赖：宿主端只允许 Node 内置模块，浏览器端只允许平台模块 `react`。

## 常用命令

```bash
npm install        # 装依赖，并因 prepare 脚本触发一次 build
npm run build      # lib/index.js（宿主）+ lib/client.js（浏览器）+ lib/types
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint（flat config，type-aware）
npm run format     # Prettier 写入
npm test           # vitest run
npm run verify     # typecheck → lint → format:check → test → build（提交前跑这个）
npm run gen:locale # 由 src/client/locales.ts 重新生成 locale/*.json
npm run verify:locale  # 校验 locale 文件是否过期
```

## 目录

```text
src/host/          宿主端：index（apply/路由挂载）、http（唯一路由）、settings（文件与投影）
                   rewrite（模型调用与草稿封装）、opener（系统编辑器原生打开）
src/client/        index（注册两个 slot）、api（路由客户端）、types（结构化的 slot props）
                   settings-store / tuner-store（两个 store）、errors、class-names、locales
src/client/components/   TunerButton、SettingsPage、ModelPicker + 各自的 .module.css
src/client/icons/  内联 SVG（不从 ui-primitives 取）
tests/             vitest；*.client.spec.tsx 是浏览器端用例
scripts/           gen-locale、package-manifest（供 tsdown 读 manifest）
locale/            由 locales.ts 生成的 marketplace 元数据，不要手改
cordis.patch.yml   把插件插入 profile 加载树的 patch
docs/demo.gif      README 里的演示图
```

## 架构约束

这几条是设计边界，改代码时不要绕过：

1. **两端都不 import 任何 harness 包**。harness 的模块表回答不了第三方包的 specifier，值导入会在运行期抛错。宿主侧通过 `ctx.get('llm')`、`ctx.get('agentDefaultModel')`、`ctx.inject(['webServer'], …)` 以结构化方式访问服务；浏览器侧只从 slot props 拿 `useInput` / `inputActions` / `sessionId` / `t`。需要类型就用 `import type` 自己写最小接口（见 `src/host/rewrite.ts`、`src/client/types.ts`）。
2. **纯净性有两道闸**：`tsdown.config.ts` 的 `dpt-bundle-purity` 插件在构建期拒绝 `node:*` 与 `@deepseek-ai/*`，ESLint 的 `no-restricted-imports` 在 `src/client` 下同样拒绝。不要为了"先跑通"关掉其中任何一道。平台模块清单是 `PLATFORM_MODULES`（react / react-dom），其余一律内联。
3. **浏览器端产物是 closure factory**：`window.__ModuleLoader__.load({ id, factory })`，`id` 取自包名。banner/footer/intro 由 tsdown 配置生成，不要手改产物或另起打包方式。
4. **状态不要放在组件里**。`conversation.input.right` 是按 Session 的槽，harness 每次切换会话都会重挂载，组件局部状态必然丢失。需要跨切换存活的东西放进 `tuner-store.ts`，按 `sessionId` 分区（相位、原文、改写文本、失败原因、在途 `AbortController` 都在里面）；只有纯 UI 的 `hover` 留在组件内。设置是全局一份，放 `settings-store.ts`。
5. **不要新增模块级可变单例**。两个 store 都由 `apply()` 创建并随插件卸载销毁，避免同页多个 profile 互相串状态。
6. **每个会话的在途请求只属于它自己**：切走不中止，结果写回发起它的会话；只有显式取消或插件 teardown 才 abort（`dispose()`）。写回目标是**该会话当前挂载的控件**：控件挂载时经 `attach` 登记自己的输入框，请求完成时写进当时登记的那个——harness 的 `inputActions` 属于随会话切换而销毁重建的输入壳，捕获发起那一刻的闭包会把结果写进已销毁的编辑器（这正是"切走再切回后结果显示不出来"的根因）。什么都没登记时不写，由控件重挂载后的 `enhancedSeen` 协调补写，且只在草稿仍等于改写前原文时才写。
7. **宿主路由契约**：前缀 `/dsh-prompt-tuner`，端点 `GET|POST /config`、`GET /models`、`POST /rewrite`、`POST /open`。业务失败一律 HTTP 200 + `{ ok: false, code, message }`（页面要显示 message，5xx 只会被浏览器吞成通用错误）；只有被取消的请求允许不写响应。前缀在两处出现（`src/host/http.ts` 的 `ROUTE_PATH`、`src/client/api.ts` 的 `ROUTE_SEGMENT`），改一处必须同时改另一处。
8. **取消与超时**：请求靠连接关闭触发 `AbortController`，另加 90s 超时（`REQUEST_TIMEOUT_MS`）；草稿上限 12000 字符（`MAX_INPUT_CHARS`），请求体上限 1MB。别把"取消"实现成等模型跑完再丢弃。
9. **设置文件**放在 harness home（`$DSH_HOME`，未设置时取 harness 默认 home）下的 `prompt-tuner/settings.json`，路径只从 `settingsPath()` 取，不要硬编码。写入走临时文件 + rename 原子替换；读取一律经过 `normalize()` 投影，任何旧版或被手改坏的文档都必须退化成一个可用值而不是在渲染处抛错。
10. **slot 注册**：`conversation.input.right`（order 1）与 `settings.section`（order 32），locale 命名空间 `prompt-tuner`。

## 代码风格

- 注释与提交信息用英文，写"为什么这样做"，不复述代码；导出的 API 带 JSDoc（`@param` / `@returns` / `@throws`）。
- tsconfig 开了 `exactOptionalPropertyTypes`、`noUncheckedIndexedAccess`、`noImplicitOverride`、`noUnusedLocals`：可选属性不要写成 `x?: T` 再传 `undefined`，用条件展开；数组与 Map 取值要处理 `undefined`。
- 禁止 `any`；不确定的外部值先收成 `unknown`，再用类型守卫或 `normalize` 收窄。
- Prettier 说了算：无分号、单引号、行宽 120、尾逗号 all、LF。跑 `npm run format`，不要手调。
- 面向用户的失败信息由宿主抛出中文 message，客户端用 `conciseError()` 压成一行（401/403/429/5xx 走本地化名称 + 原文，最长 160 字符）。宿主端不要调 `t()`。

## 国际化

- 文案单一来源是 `src/client/locales.ts` 的 `dictionaries`：`zh` 是 key 全集，`en` 用 `Record<LocaleKey, string>` 强制补齐，新增 key 必须两边同时加。
- `locale/*.json` 是**生成物**，只含 marketplace 元数据，由 `npm run gen:locale` 写出，不要手改；改了文案就重跑一次（CI 的 `verify` 不包含 `verify:locale`，忘了会漂移）。

## 样式

- 组件样式写在同名 `.module.css`，构建期由 lightningcss 编译成 `[hash]_[local]` 类名并注入带 `data-plugin-css` 的 `<style>`。
- 需要拿到编译后的 CSS 文本用 `x.css?inline`；直接 import 裸 `.css` 会在构建期报错。
- 类名拼接统一走 `classNames()`：`noUncheckedIndexedAccess` 下 `css.foo` 可能是 `undefined`，直接插值会把字符串 "undefined" 渲染进 class。
- 颜色等视觉 token 用 harness 的 CSS 变量（如 `var(--dsw-alias-label-secondary)`），不要写死色值。

## 测试

- vitest 默认 `node` 环境；浏览器端用例在文件顶部用 `/** @vitest-environment jsdom */` docblock 显式切 jsdom，文件名用 `*.client.spec.tsx`。
- 浏览器端不渲染真实输入框：给 `TunerButton` 注入假的 `useInput` / `inputActions` / `sessionId`；fixture 要模拟 harness 的真实生命周期——草稿按 Session 持久，但 `inputActions` 属于输入壳，**每次挂载都要新建一份**且卸载后写入即被丢弃。让 actions 跨挂载稳定会掩盖"结果写进已销毁输入壳"这一类回归（曾经正是 fixture 掩盖了切走再切回后结果丢失的 bug）。参考 `tests/tuner-button.client.spec.tsx`。
- host 侧单测不要读写真实的 harness home：用 `mkdtemp` 造临时目录（见 `tests/settings.spec.ts`），避免污染用户设置。
- 修 bug 先写能复现的用例；新增行为至少覆盖失败与取消路径。

## 构建与验证

- `npm run build` 只产出本仓库的 `lib/`；构建成功不等于插件已生效，已安装的 profile 要重新安装对应版本才会加载新产物。
- 安装/更新插件：`dsh plugin --profile <profile> add @kongchenhui/dsh-prompt-tuner`。
- `package.json` 的 `dsh` 字段决定 harness 怎么装配：`bundle.patch` 指向 `cordis.patch.yml`，`client` 声明 web 平台、立即加载并注入 `@deepseek-ai/dsh-client-ui-conversation`。改这里等于改插件与 harness 的契约，改完要在真实 profile 里验证，不要只靠类型检查。
- `lib/`、`lib/types`、`*.tgz` 是构建产物（已 gitignore），不要提交；`docs/demo.gif` 是 README 配图，演示数据须虚构并脱敏。

## 版本与发布

1. 改 `package.json` 的 `version`，在 `CHANGELOG.md` 的 `[Unreleased]` 下补条目（中文，按 Changed / Fixed 分组），然后新开 `## [x.y.z] - YYYY-MM-DD` 段并加版本链接。
2. `npm run verify` 必须通过。
3. 打 tag `vX.Y.Z` 并推送：CI（`.github/workflows/release.yml`）会校验 tag 与 `package.json` 版本一致，用 npm trusted publishing（OIDC，`NPM` environment）发布，无需任何 token secret。
4. 不要手动 `npm publish`，也不要在网页上手动建 Release —— 会和 CI 冲突。

## 不要做

- 不要在 `src/client` 引入 `node:*`、`@deepseek-ai/*` 或第二个平台模块。
- 不要在宿主端 import harness 包来"复用"类型或工具函数。
- 不要把跨会话状态放回组件局部 state，也不要为省事给 store 加模块级全局。
- 不要改 `locale/*.json`（跑 `gen:locale`），不要改 `lib/` 下的产物。
- 不要在没验证真实 profile 的情况下声称"插件已生效"。
