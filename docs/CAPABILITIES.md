# 能力清单（按期归档）

> 本文档由 README 外移维护：各期交付能力的完整清单。
> 主 README 只保留概览，详见本文。

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

## 能力（七期 · Codex 对齐）

- **侧栏主导航 Codex 风格**：新对话改为整行单按钮（行尾内嵌「+」，
  Codex `New chat +` 同构），与「已归档」「自动化」三行完全同构同高
  （32px / 13px / 同圆角同悬停），全部为内联 SVG 线性图标
- **斜杠命令面板**：输入框键入 `/` 弹出本地命令菜单（↑↓ 选择、
  Enter/Tab 执行、Esc 收起；IME 组词期不误触；中文子串 + 拉丁别名
  双匹配）——新会话 / 派生 / 导出 / 归档当前会话 / 模型 / 思考强度 /
  权限模式 / Agent 预设 / 项目规则 / 自动化 / MCP / 设置，
  全部接线现有能力（无假命令）
- **项目规则（AGENTS.md）**：设置页「行为 → 项目规则」编辑全局
  （`$DSH_HOME/AGENTS.md`）与当前项目两层规则文件；与 harness 原生
  `agent-instructions` 真联动——会话启动时按「全局 → 项目根 → 当前目录」
  逐层合并注入（兼容 `CLAUDE.md` 与 `*.local.md`，64 KiB 渲染预算），
  保存即对后续会话生效；`Ctrl/Cmd+S` 快捷保存 + 未保存徽章
- **自动化定时任务**：设置页「扩展 → 自动化」管理定时任务（每天 /
  每周 / 间隔分钟），主进程 `AutomationService` 30s 粒度调度，到点在
  当前工作区创建会话并注入提示词（结果进入会话流，侧栏即时可见）；
  harness 未就绪跳过不占触发位，停机期间错过的触发不补跑；
  侧栏「自动化」导航行（时钟图标 + 启用数徽标）直达
- **实机验证工具链**：`scripts/cdp-*.mjs`（CDP 连接运行中的应用做
  UI 截图 / 斜杠命令 / 规则读写 / 自动化触发探针），配合
  `npm start -- -- --remote-debugging-port=9222` 使用
- **回合时间线对话流**：一条用户消息 = 一轮锚点（右侧气泡），其后
  全部产出归属该轮——轮首元信息（回复数 · 工具数 · 运行态）+ 左侧
  线程脊，**每个操作（思考条 / 工具行 / 正文 / 错误）一个时间线节点**
  （运行中的工具节点脉冲）；修复消息时间线错序 bug（harness 事件序为
  assistant/message 先落定、tool/call 随后：工具现挂回所属步骤的消息，
  tool/result 按 callId 精确回写，步骤间保持真实时间顺序）
- **用量与操作键**：会话内不再显示逐条 `↑↓ tokens`（导出文档仍保留），
  分类型用量（本轮输入 / 本轮输出 / 累计输出 / 上下文容量）集中在
  输入区「上下文用量」详情；发送 / 停止合一为单键（运行中即停止，
  输入仍可 Enter 发送，行为随「交互行为」设置）
