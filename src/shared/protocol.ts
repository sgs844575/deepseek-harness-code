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
  | InteractionDto;

/** 发送用户输入的模式。 */
export type PromptModeDto = 'queue' | 'steer';

/** 持久化会话摘要（侧栏列表项）。 */
export interface SessionSummaryDto {
  id: string;
  createdAt: number;
  cwd?: string;
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
