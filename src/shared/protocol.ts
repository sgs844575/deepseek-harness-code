/**
 * 主进程与渲染层共享的 DTO 类型（跨桥传输的纯数据形状）。
 * 与 harness 的类型解耦：这里是我们自己的稳定契约。
 */

/** harness 宿主状态（boot 状态机）。 */
export interface HostStateDto {
  status: 'booting' | 'ready' | 'error';
  error?: string;
  workspace: string;
}

/** 模型目录条目（llm.listModels 的裁剪视图）。 */
export interface ModelInfoDto {
  id: string;
  name?: string;
  description?: string;
}

/** 会话事件（harness 持久化事件流中的单条；data 按类型收窄）。 */
export interface SessionEventDto {
  type: string;
  seq: number;
  time: number;
  data?: unknown;
}

/** 主进程 → 渲染层的统一事件信封。 */
export type HarnessEventDto =
  | { kind: 'session-event'; sessionId: string; event: SessionEventDto }
  | { kind: 'agent-status'; sessionId: string; status: string }
  | { kind: 'subagent-start'; run: SubagentRunDto }
  | { kind: 'subagent-end'; run: SubagentRunDto }
  | InteractionDto;

/** 发送用户输入的模式。 */
export type PromptModeDto = 'queue' | 'steer';

/** 持久化会话摘要（侧栏列表项）。 */
export interface SessionSummaryDto {
  id: string;
  createdAt: number;
  cwd?: string;
  /** 会话创建时加入的 Agent 预设（空白期切换以事件流为准）。 */
  agentPreset?: string;
}

/* ---- Agent 预设（roster 名单，config/harness/agent-presets + 用户根） ---- */

/** Agent 预设条目（dsh-agent-presets 发现结果的裁剪视图）。 */
export interface AgentPresetDto {
  /** 预设 id = 目录名。 */
  id: string;
  /** 展示名（preset.yml；缺失回退 id）。 */
  name?: string;
  description?: string;
  /** system = 随部署；user = $DSH_HOME/.agent-presets 本地创作。 */
  trust: 'system' | 'user';
  /** 无法组装的原因（发现期形状检查，原样展示）。 */
  broken?: string;
}

/* ---- 子代理（subagent 委托的子会话） ---- */

/** 子代理运行状态（running = 未收到 end；ended 后附结束原因与摘要）。 */
export interface SubagentRunDto {
  /** 子会话 id（transcript 按会话事件流折叠，keyed by 该 id）。 */
  childSessionId: string;
  /** 委托方父会话 id（卡片挂在父会话对话流下）。 */
  parentSessionId: string;
  /** subagent/descriptor 的 label（模型给的委托描述）。 */
  label: string;
  status: 'running' | 'ended';
  /** harness subagent/end 的 stopReason（completed / aborted / error / …）。 */
  endReason?: string;
  /** 结束时的最后一条助手消息（有则展示）。 */
  summary?: string;
}

/* ---- MCP 服务器（mcp-servers.json，boot 补丁注入 mcp-client 插件行） ---- */

export interface McpServerDto {
  id: string;
  /** harness serverName = 工具命名空间 mcp__<name>__*，全局唯一。 */
  name: string;
  transport: 'stdio' | 'streamable-http';
  enabled: boolean;
  /* stdio */
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /* streamable-http */
  url: string;
  headers: Record<string, string>;
}

/** 新增 / 编辑 MCP 服务器输入（编辑必须带 id；缺失字段归空）。 */
export interface McpUpsertDto {
  id?: string;
  name: string;
  transport: 'stdio' | 'streamable-http';
  enabled?: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

/* ---- 人机交互（审批 / 提问） ---- */

export interface QuestionItemDto {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export interface QuestionAnswerDto {
  id: string;
  selected: string[];
  custom?: string;
}

export type InteractionDto =
  | { kind: 'approval-requested'; id: string; sessionId: string; toolName: string; reason?: string }
  | { kind: 'approval-resolved'; id: string }
  | { kind: 'question-requested'; id: string; sessionId: string; questions: QuestionItemDto[] }
  | { kind: 'question-resolved'; id: string };

/* ---- 模型供应商（多供应商 / 多 Key，参考 Cherry Studio） ---- */

/** 单条 API Key 的渲染层安全视图（明文只留在主进程）。 */
export interface ApiKeyEntryDto {
  id: string;
  label: string;
  /** 脱敏展示，如 sk-***abcd。 */
  masked: string;
  isEnabled: boolean;
}

/** 供应商模型目录条目。 */
export interface ProviderModelDto {
  id: string;
  name?: string;
  /** 上下文窗口（token 数；llm-deepseek 目录字段，缺省回落 defaultContextWindow）。 */
  contextWindow?: number;
}

/** 供应商（渲染层视图）。 */
export interface ProviderDto {
  id: string;
  /** 关联的内置预设 id（用户自定义供应商为空）。 */
  presetId?: string;
  name: string;
  baseURL: string;
  enabled: boolean;
  /** 本地服务（Ollama 等）允许无密钥使用。 */
  authOptional: boolean;
  website?: string;
  models: ProviderModelDto[];
  apiKeys: ApiKeyEntryDto[];
  /** 是否有启用的密钥。 */
  keyConfigured: boolean;
}

/** 思考偏好（全局，随激活供应商写入 harness llm 设置）。 */
export type ThinkingModeDto = 'enabled' | 'disabled';
export type ReasoningEffortDto = 'off' | 'high' | 'max';

export interface ProviderPrefsDto {
  thinking: ThinkingModeDto;
  reasoningEffort: ReasoningEffortDto;
  /** 单次请求最大输出 tokens（llm-deepseek maxTokens；缺省 = 256K）。 */
  maxTokens?: number;
  /** 模型未声明时的上下文窗口兜底（llm-deepseek defaultContextWindow；缺省 = 1M）。 */
  contextWindow?: number;
}

/** providers.* 通道的完整快照。 */
export interface ProviderSnapshotDto {
  providers: ProviderDto[];
  activeProviderId: string;
  prefs: ProviderPrefsDto;
}

/** 新增 / 编辑供应商的输入。 */
export interface ProviderUpsertDto {
  /** 缺省 = 新增自定义供应商。 */
  id?: string;
  name: string;
  baseURL: string;
  enabled?: boolean;
  website?: string;
}

/* ---- 应用设置（主进程 app-settings.json，非 harness 设置文档） ---- */

/** 已注册项目（工作区）：path 绝对路径，name 展示名（默认取路径末段）。 */
export interface ProjectEntryDto {
  path: string;
  name: string;
}

/** 自动化调度：daily 每天 time（HH:mm）/ weekly 每周 weekday(0-6,0=周日) time / interval 每 minutes 分钟。 */
export type AutomationScheduleDto =
  | { type: 'daily'; time: string }
  | { type: 'weekly'; weekday: number; time: string }
  | { type: 'interval'; minutes: number };

/** 自动化任务：到点在当前工作区创建会话并注入 prompt（结果进入会话流）。 */
export interface AutomationDto {
  id: string;
  name: string;
  prompt: string;
  schedule: AutomationScheduleDto;
  enabled: boolean;
  createdAt: number;
  /** 上次实际触发时间（毫秒；跳过不占用触发位，未运行过为空）。 */
  lastRunAt?: number;
  /** 上次触发结果：ok / error：… / skipped：…。 */
  lastRunStatus?: string;
}

/** 集成终端 Shell（三期终端接入时消费，现阶段仅持久化偏好）。 */
export type TerminalShellDto = 'system' | 'powershell' | 'cmd' | 'gitbash';

/** Agent 运行中发送输入的默认行为：queue 排队跟随 / steer 插话引导。 */
export type InteractionBehaviorDto = 'queue' | 'steer';

/**
 * Agent 权限模式（映射 harness 原生能力）：
 * - ask  默认：变更类工具执行前需要用户审批（harness approval: ask）
 * - full 完全访问：跳过审批直接执行（harness approval: never）
 * - plan 计划模式：只调研与制定计划，变更类工具被拒绝（harness plan-mode）
 */
export type AgentModeDto = 'ask' | 'full' | 'plan';

export interface AppSettingsDto {
  /** 集成终端 Shell。 */
  terminalShell: TerminalShellDto;
  /** HTTP 代理（如 http://127.0.0.1:7890；空串 = 不代理，重启后生效）。 */
  httpProxy: string;
  /** Chrome 硬件加速（重启应用后生效）。 */
  hardwareAcceleration: boolean;
  /** 任务通知：完成 / 失败 / 需要确认时发送桌面通知。 */
  notifications: boolean;
  /** 通知提示音（notifications 开启后可单独关闭）。 */
  notificationSound: boolean;
  /** 关闭窗口时隐藏到托盘（仅 Windows）。 */
  closeToTray: boolean;
  /** 保持电脑运行：阻止系统因空闲进入休眠。 */
  keepAwake: boolean;
  /** 交互行为：运行中发送的后续输入加入队列或插话引导。 */
  interactionBehavior: InteractionBehaviorDto;
  /** Agent 权限模式（默认询问 / 完全访问 / 计划模式）。 */
  agentMode: AgentModeDto;
  /** 提问自动继续：Agent 提问 5 分钟未回答自动继续。 */
  autoContinueQuestions: boolean;
  /** 显示思考过程（关闭时每轮仍展示第一次思考）。 */
  showThinking: boolean;
  /** 显示待办（消息流上方的任务卡片）。 */
  showTodos: boolean;
  /** 自动归档旧任务。 */
  autoArchive: boolean;
  /** 归档保留时长（天）。 */
  archiveRetentionDays: number;
  /** DSH 数据根目录（空串 = 默认 userData/dsh-home；修改后复制数据，重启生效）。 */
  dataPath: string;
  /** 已注册项目列表（添加项目 / 切换工作区用）。 */
  projects: ProjectEntryDto[];
  /** 自动化任务（主进程定时调度，到点创建会话注入 prompt）。 */
  automations: AutomationDto[];
  /** 沙箱栈（Windows ACL 读写约束 pwsh / fs 工具；重启应用后生效，默认关闭）。 */
  sandboxEnabled: boolean;
}

/** 选择文件夹的结果（创建项目的源目录选择）。 */
export interface PickFolderResultDto {
  canceled: boolean;
  path?: string;
}

/** 修改数据存储路径的结果。 */
export interface PickDataPathResultDto {
  changed: boolean;
  /** 复制目标（changed 时存在）。 */
  path?: string;
  error?: string;
}

/**
 * Agent 规则文件（AGENTS.md）快照。
 * harness 在会话启动时自动发现并合并：全局（数据目录/AGENTS.md）+
 * 项目根到当前目录逐层 AGENTS.md（另兼容 CLAUDE.md 与 *.local.md 变体）。
 */
export interface AgentRulesDto {
  scope: 'global' | 'project';
  /** 文件绝对路径。 */
  path: string;
  /** 是否已存在（不存在时读取返回空内容，保存即创建）。 */
  exists: boolean;
  content: string;
}
