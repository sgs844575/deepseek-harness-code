# DeepSeek Harness Code

[![version](https://img.shields.io/badge/version-v0.1.1-blue)]()
[![platform](https://img.shields.io/badge/platform-Windows-informational)]()
[![license](https://img.shields.io/badge/license-MIT-green)]()
[![author](https://img.shields.io/badge/author-逆流无邪-orange)]()

类 zcode / Codex 的 **桌面 GUI AI 开发客户端**（Electron + React），LLM 核心进程内嵌
[deepseek-harness](./deepseek-harness)（`dsh`，Cordis 插件化 agent harness）——
**只增量封装，不修改 harness 任何源码**。

## 界面预览

| 深色主题 · 对话 / 工具卡片 | 浅色主题 |
|---|---|
| ![深色主题](docs/screenshots/main-dark.png) | ![浅色主题](docs/screenshots/main-dark-2.png) |

设置页（模型服务 / API Key / 多供应商）：

![设置页](docs/screenshots/settings-2.png)

## 能力（一期）

- 会话管理：列表 / 新建 / 历史加载 / 跨启动恢复（事件溯源日志回放）
- 流式对话：正文 markdown + 可折叠思考过程 + token 用量
- 工具可视化：pwsh / read / write / edit / glob / grep / str_replace_editor 工具卡片
- 人机协作：变更类工具审批（允许一次 / 拒绝）、`ask_user_question` 交互卡片
- 控制：停止运行中的回合、运行中插话（steer）
- 设置：API Key（凭据文档）、默认模型、baseURL、思考模式

## 能力（二期）

- **任务面板**：折叠 `todo/write` 快照（整表替换语义），进度条 + 待办/进行中/已完成三态
- **edit diff 视图**：`str_replace_editor` 的 str_replace / create / insert 渲染为
  增删行双色块（浅深色主题各自配色），摘要行直接显示目标文件路径
- **会话重命名**：本地别名（localStorage，叠加在 `session/title` 之上；双击侧栏条目或 ✎）
- **会话导出**：折叠态转 Markdown（思考/工具/用量齐全），系统保存对话框落盘
  （`app:export-text` IPC，文件名自动清洗）
- **浅色 / 深色主题**：完整 CSS token 双主题（`<html data-theme>`），跟随系统 / 手动切换
  （标题栏快捷切换 ☀/☾），`color-scheme` 联动原生控件与滚动条
- **字体自定义**：内置 **JetBrains Mono 2.304**（OFL）为等宽默认（代码块 / 工具卡 /
  diff / 输入区）；界面字体、等宽字体、字号可在设置中替换为任意本机字体或自定义字体名
- **无边框窗口**：去除系统默认标题栏，自绘标题栏（拖拽移动、双击最大化、
  Segoe Fluent 窗口控件、最大化状态实时同步）

## 能力（三期）

- **多供应商多 Key**（Cherry Studio 建模）：`providers.json` 管理多个
  OpenAI 兼容供应商（baseURL / 模型目录 / 思考档位），每供应商多 Key
  轮询；明文 Key 永不进入渲染层（快照仅 masked）
- **Agent 权限模式**：`ask`（默认审批）/ `full`（完全访问）/ `plan`
  （计划模式，变更类工具直接拒绝）——完全映射 harness 原生审批与
  plan-mode 插件，输入区工具栏一键切换
- **聊天 UI 改版**：Cherry 风格消息布局（助手左头像无底色 / 用户右侧
  气泡）、Composer 工具栏胶囊菜单（模型 / 思考强度 / 权限模式）、
  中性灰阶全局 token
- **数据目录迁移**：全部数据集中 `~/.deep-seek-harness-code/`
  （`DSHC_HOME` 可覆盖；旧 userData 自动一次性迁移），内含
  app-settings / providers / dsh-home（会话与凭据）/ cache

## 能力（五期 · Roadmap 首批）

- **子代理（subagent）**：模型可经 `subagent` / `subagent_fork` 工具委托子代理
  （进程内 spawn / fork provider，continuable 后台 + `send_message` /
  `interrupt_agent` / `list_agents` 控制面）；子会话与主会话同树持久化
  （header `origin=subagent` + `parentSession`），客户端跨会话聚合——
  父会话对话流尾部渲染子代理卡片（标签 / 运行状态 / 工具次数 /
  折叠展开子会话 transcript），历史会话回放同样恢复
- **会话派生（fork）**：侧栏会话操作一键派生——以「最近一个已完成回合」
  为种子创建新顶层会话（对齐 harness fork provider 的种子语义），
  继承全部上下文继续对话
- **Skills**：`SKILL.md` 技能目录自动发现 + 会话内技能目录注入——
  项目 `<workspace>/.dsh/skills`、`.agents/skills`，用户 `$DSH_HOME/skills`，
  Chokidar 热刷新
- **MCP**：设置页管理 MCP 服务器（stdio 命令 / Streamable HTTP，参数、
  环境变量、请求头），保存在 `~/.deep-seek-harness-code/mcp-servers.json`，
  boot 时以插件补丁注入（每 server 一行 mcp-client），工具以
  `mcp__<名称>__<工具>` 出现在会话中；「应用变更」自动重启引擎
- **命令沙箱（实验，默认关闭）**：设置开启后 pwsh 与文件写入默认限制在
  工作区和临时目录内（Windows ACL 受限令牌 + fs 栅栏），越界操作经
  `sandbox_permissions` 升级审批（走现有审批卡）
- **消息设置与上下文统计**（Cherry Studio 同款）：输入区「消息设置」
  胶囊可选最大输出（maxTokens）与上下文窗口（defaultContextWindow，
  热生效）；发送键旁的上下文圆环按最近一次请求的 prompt 规模着色
  （conic 渐变，绿→琥珀→红），hover 展示 `已用 / 上限（百分比）` 与模型名
- **消息时间线（zcode / Claude Code 式）**：全宽左对齐、无头像无气泡——
  用户消息是流里的一行亮色文本（❯ 前缀），助手正文直接排版；工具调用
  渲染为单行日志（图标 + 动作摘要，如「已执行 …」「读取 …」「搜索内容 …」，
  单行截断），点击展开浅底详情（diff / 参数 / 结果）；层级靠明暗与留白区分
- **思考过程条（Cherry 同款）**：无框内联行 = 脑图标 +「思考过程」+
  持续秒数（首个思考增量到消息落定的真实耗时，回放同构）+ hover 显现的
  旋转箭头；流式期间自动展开并显示跳动指示，落定后收起为浅底圆角块
- **修复**：`user/message` 事件载荷形态修正（消息字段在 `data` 根上），
  用户气泡在实时流与历史回放中均正确渲染

## 能力（六期 · Agent 预设）

- **Agent 预设（输入框左下角）**：接入 harness 原生 `dsh-agent-presets`
  roster——模型面（工具 / persona / 提示段 / 压缩 / 计划 / 子代理工具）全部
  下沉到 `config/harness/agent-presets/` 下的预设文件，每个会话按所选预设
  组装（scope 链 `agent → preset → global`），与原生插件模式并存：
  - **插件模式**（默认）：DSHC 原有插件组合的完整工具面，行为与迁移前一致
  - **标准模式**：官方 `standard` 预设移植（pwsh / 文件三件套 / Skills /
    计划 / 压缩 / 子代理，裁掉无宿主后端的 jobs / goal / web / workflow）
  - **PTC 模式**：标准 + Code Mode SDK——模型对一个生成的 SDK 写一个
    TypeScript 程序、`run_code` 一次执行多步操作（时空可组合编程范式，
    [cordiverse/paper](https://github.com/cordiverse/paper)；宿主挂
    code-runtime worker 线程）
  - **极简模式**：固定提示词双工具（pwsh + str_replace_editor，Windows
    适配——官方持久 bash 终端需 PTY）
  - **创造模式**：标准 + `tool-cordis` 运行时读写与组合创作技能，用于让
    Agent 创作自定义预设（用户预设落 `$DSH_HOME/.agent-presets/`）
- **会话级预设语义**：新会话挂 roster 默认（settings 命名空间
  `agent-presets`，持久化）；**空白会话**可在左下角切换（recompose 重链
  scope 父 + `agent-preset/selected` 事件持久化）；已开始的会话锁定
  （历史已在该预设的工具面下产出，切换会抽出模型已调用的工具），
  选择降级为设默认；恢复 / 派生按会话记录的预设重建
  （`resolveSessionPreset`：事件 last-wins > 创建头）
- **plan-mode 预设化适配**：计划模式服务随预设走 isolate realm，
  宿主侧经 `agentPresets.serviceFor(agent, 'planMode')` 按 agent 寻址；
  未挂 plan-mode 的预设（极简）不支持计划模式
- **校验工具**：`node scripts/verify-presets.mjs` 一键体检全部预设
  （standingKeyFor 逐个挂载，审计缺服务 / 泄漏 / 导入失败）

## 架构

```
Electron 主进程（ESM .mjs，vite 打包）
 ├─ harness/paths.ts           DSH_HOME / 工作区 / harness 根路径
 ├─ harness/harness-service.ts boot() 胶水 + 会话代理 + 设置/凭据 + 状态机
 ├─ harness/interactions.ts    审批瀑布应答器 + 工具审批门 + 提问 provider
 ├─ ipc/*                       白名单 IPC 通道（invoke + 事件推送）
 preload（CJS，sandbox）        contextBridge 白名单桥
 渲染层（React SPA，无直接网络）
 ├─ components/                 侧栏 / 对话流 / 任务面板 / diff / 输入区 / 审批卡 / 设置
 ├─ state/sessionStore.ts       SessionEvent → UI 状态纯函数折叠（实时=回放）
 ├─ state/appearance.ts         主题/字体偏好（localStorage → <html> token）
 └─ state/sessionNames.ts       会话本地别名（重命名覆盖层）
```

**与 harness 的集成方式**：主进程以绝对 file URL 动态加载
`deepseek-harness/packages/boot/app-boot/lib/index.js` 的 `boot()`，以
`config/harness/cordis.yml` 为配置入口（插件用**相对路径直连** harness 构建产物，
绕过包管理器解析）。宿主组合只保留 HOST 平面（注册表 / 提供方 / 守卫 /
持久化 / 人机协作面 / code-runtime / cordis-host-runner / agent-presets
roster），模型面在 `config/harness/agent-presets/` 的预设文件里按会话组装
（对齐 harness web-app bundle 的 preset 化部署形态）。MCP 服务器与沙箱开关等
**应用设置驱动的动态组合**经 `boot()` 的 patches 参数注入
（`src/main/harness/composition.ts`，cordis-plugin-include
的 id 定向覆盖 + insert 追加语义），cordis.yml 保持静态基线。subprocess 服务由自写插件
`subprocess-child`（`src/harness-plugins/` → 编译到 `config/harness/plugins/`）以纯
child_process 实现，避免 node-pty 在 Electron 内的原生 ABI 不匹配；沙箱 ACL runner
（`electron.exe runner.js` 形态）spawn 时自动注入 `ELECTRON_RUN_AS_NODE=1`。

数据落位：`DSHC_HOME`（默认 `~/.deep-seek-harness-code`，可用环境变量覆盖）
内含 app-settings.json / providers.json / dsh-home/
（settings.yaml / .credentials.yaml / sessions/）；`DSH_HOME` 指向其中
dsh-home，旧 userData 数据启动期自动迁移。

## 快速开始

前置：Node ≥ 22.19（或 ≥24）、pnpm ≥ 11、Windows（shell 工具走 pwsh）。

```powershell
# 1) harness 子树依赖（首次或迁移目录后必须；链接是绝对路径）
cd deepseek-harness
pnpm install --ignore-scripts

# 2) 客户端依赖与启动
cd ..
npm install
npm start          # electron-forge start（渲染层 HMR；主进程改动需重启）
```

启动后右上角 ⚙ 设置里填入 DeepSeek API Key 即可对话。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm start` | 开发运行（forge + vite dev server） |
| `npm run typecheck` | 全量 TS 项目引用检查（含 harness 插件编译） |
| `npm test` | vitest 单测（事件折叠 / markdown 渲染） |
| `npm run build:harness` | 仅编译自写 harness 插件 |
| `npm run dist` | 打包发布 zip 到 `release/`（见下节） |
| `node scripts/smoke-harness.mjs` | headless 冒烟：boot → 对话 → 持久化 → 恢复（按默认预设组装） |
| `SMOKE_TOOL=1 node scripts/smoke-harness.mjs` | 工具+审批冒烟（pwsh 真实执行） |
| `SMOKE_SUBAGENT=1 node scripts/smoke-harness.mjs` | 子代理冒烟（subagent 工具 → 子会话 → 事件 → 持久化） |
| `SMOKE_FORK=1 node scripts/smoke-harness.mjs` | 会话派生冒烟（completed-turn 种子继承历史） |
| `node scripts/verify-presets.mjs` | Agent 预设体检（逐个常驻挂载，审计缺服务/泄漏/导入失败） |

冒烟测试用 harness 自带的 mock LLM（无需 API Key）。mock 的行为序列是
**有状态的**——每轮冒烟前重启对应 mock；地址经 `DSH_BASE_URL` 传入
（脚本会把它写进 llm-deepseek 设置段，`DEEPSEEK_BASE_URL` 仅作回退）：

```powershell
cd deepseek-harness
# 基础对话 mock（端口 18971）
node --import tsx packages/test-support/llm-mock-server/src/bin.ts --port 18971 `
  --sequence success --success-text "冒烟回复 OK" --repeat-last
# 另开终端，指向 mock
$env:DSH_BASE_URL = "http://127.0.0.1:18971/v1"; node scripts/smoke-harness.mjs

# 工具+审批 mock（端口 18972）
node --import tsx packages/test-support/llm-mock-server/src/bin.ts --port 18972 `
  --sequence tool_call_success,success --repeat-last --tool-name pwsh `
  --tool-arguments '{"command":"Write-Output smoke-ok","description":"run smoke command"}'
$env:DSH_BASE_URL = "http://127.0.0.1:18972/v1"; $env:SMOKE_TOOL = "1"
node scripts/smoke-harness.mjs

# 子代理 mock（端口 18973；continuable 后台委托——工具返回 started，
# 子代理输出经 subagent/end 事件回传父会话）
node --import tsx packages/test-support/llm-mock-server/src/bin.ts --port 18973 `
  --sequence tool_call_success,success --success-text "子代理回复：任务完成" --repeat-last `
  --tool-name subagent `
  --tool-arguments '{"description":"冒烟子代理","prompt":"请回复子代理确认"}'
$env:DSH_BASE_URL = "http://127.0.0.1:18973/v1"; $env:SMOKE_SUBAGENT = "1"
node scripts/smoke-harness.mjs
# 会话派生冒烟复用基础 mock（端口 18971）：$env:SMOKE_FORK = "1"
```

（开发客户端本体也可在设置页把 baseURL 指到 mock 验证 UI 流。）

## 打包发布（v0.1.1，Windows）

```powershell
npm run dist
# 产物：release/deepseek-harness-code-v0.1.1-win-x64.zip
```

发布 zip 的组成与运行方式（**解压即用，双击 exe 即可，机器无需 Node.js**）：

- `electron-forge package` 产物（经典 `app.asar` 形态）只含 UI 壳；
- `config/harness/`（cordis.yml + 自写插件）与 `deepseek-harness/`（源码 +
  lib 产物）以真实目录住在 `resources/` 下——运行时动态加载的模块不进 asar；
- harness 生产依赖在打包时已预装进包（hoisted 平铺 + workspace 补链，
  发布脚本内置依赖闭环与解压复检两道守卫），终端用户零安装；
- 打包期间 forge 钩子会把 vendored harness 树暂出仓库避免 packager 遍历
  （历史 OOM 根因），打包完成自动移回；
- `setup.cmd` 为修复工具：仅当包内 node_modules 损坏导致启动报
  `Cannot find package` 时使用（需 Node.js ≥ 22 与 pnpm）。

## 开源信息

- 作者：[逆流无邪](https://github.com/sgs844575)
- 仓库：<https://github.com/sgs844575/deepseek-harness-code>
- 协议：[MIT](./LICENSE)；内嵌的 [deepseek-harness](./deepseek-harness)
  （MIT）与 JetBrains Mono 字体（SIL OFL 1.1）分属各自协议
- 当前版本：v0.1.1

## 目录速览

```
config/harness/cordis.yml        # agent 组合（挂哪些官方插件 + 自写插件）
src/harness-plugins/             # 自写 cordis 插件源码（subprocess-child）
src/main/harness/                # boot 胶水 / 服务 / 交互桥 / 组合补丁 / 会话派生
src/main/mcp/                    # MCP 服务器存储与服务（mcp-servers.json）
src/{preload,shared,renderer}/   # 桥 / 契约 / React UI
scripts/smoke-harness.mjs        # headless 集成冒烟（基础 / 工具审批 / 子代理 / 派生）
```

## 如何扩展

- **新增 IPC 能力**：`src/shared/channels.ts` 加通道 → `bridge.d.ts` 加方法 →
  preload 实现 → 对应 `src/main/ipc/*-handlers.ts` 注册。
- **调整 agent 工具集**：改 `config/harness/cordis.yml`（增删官方插件行；
  参照 `deepseek-harness/packages/bundle/base/cordis.patch.yml`）。
- **新增自写 harness 插件**：源码放 `src/harness-plugins/<name>/`，
  在 cordis.yml 以 `./plugins/<name>/index.js` 相对路径挂载。

## Roadmap（未实现，仅记录）

内嵌终端（需 node-pty Electron 重建或自写 PTY）· 多工作区多窗口 ·
安装器形态分发（当前为解压即用 zip，免安装免依赖）· macOS / Linux 适配 ·
i18n · permission-presets 与 ask/full/plan 的统一（当前沙箱档为组合级默认，
会话级 preset 切换待收敛）。

已落地（五期）：子代理视图 · 会话 fork · skills · MCP · 沙箱栈（实验开关）。

## 已知约束

- `deepseek-harness` 为 0.1.0-rc.5（pre-1.0），本项目通过 `src/main/harness/harness-context.ts`
  的窄接口消费，harness 升级时只需对齐该文件。
- vendored harness 树携带**已构建的 lib 产物**（其源码仓库的 `.gitignore`
  排除 `lib/`，本项目以 `git add -f` 强制纳入），克隆后无需再构建 harness。
- 打包为免安装 zip（`app.asar` + harness 树/依赖以真实目录随包，开箱即用），
  未提供安装器与代码签名。
