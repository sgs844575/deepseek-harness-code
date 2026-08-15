/**
 * 主进程侧对 harness Cordis 根上下文的结构化视图。
 *
 * 只声明我们实际消费的服务与方法（结构化类型，鸭子匹配），
 * 不从 deepseek-harness 导入任何类型——保持与 harness 版本解耦，
 * 接触面收窄在 boot / llm / agents / sessions / settings / credentials 六个模块。
 */

export interface LlmModelInfo {
  provider: string;
  id: string;
  name?: string;
  description?: string;
}

/** 会话事件（持久化日志中的纯数据事件，JSON 可序列化）。 */
export interface SessionEvent {
  type: string;
  seq: number;
  time: number;
  data?: unknown;
}

/** 模型内容块（我们只产出 text 块，其余类型仅透传渲染）。 */
export interface TextContentBlock {
  type: 'text';
  text: string;
}

/** followup/steer 所需的完整用户消息。 */
export interface UserMessage {
  id: string;
  role: 'user';
  content: TextContentBlock[];
  source: { kind: 'user' };
}

export interface Agent {
  id: string;
  status: 'idle' | 'running';
  /** agent 的 scope 上下文（opaque）：Agent 预设认父 / recompose 的句柄。 */
  ctx: unknown;
  /** agent 的活会话：空白检查（无 turn/start）与预设切换事件的落点。 */
  session: {
    events: { type: string }[];
    append(type: 'agent-preset/selected', data: { agentPreset: string }): Promise<void> | void;
  };
  followup(message: UserMessage): void;
  steer(message: UserMessage): void;
  cancel(cause: { kind: string }, options?: { keepInbox?: boolean }): void;
  whenIdle(): Promise<void>;
}

export interface AgentHandle {
  agent: Agent;
  dispose(): Promise<void>;
}

/** 持久化会话头（sessionPersistence.list 返回项的裁剪视图）。 */
export interface PersistedSessionHeader {
  id: string;
  createdAt: number;
  cwd?: string;
  origin?: string;
  /** 子代理会话的委托方父会话（origin === 'subagent' 时存在）。 */
  parentSession?: string;
  /** 会话创建时加入的 Agent 预设（空白期切换以 agent-preset/selected 事件为准）。 */
  agentPreset?: string;
}

/** dsh-agent-presets 的 AgentPreset（发现结果的裁剪视图）。 */
export interface AgentPresetInfo {
  /** 预设 id = 目录名（[a-z0-9][a-z0-9-]*）。 */
  id: string;
  /** 展示名（preset.yml；缺失回退 id）。 */
  name?: string;
  /** 展示描述。 */
  description?: string;
  /** 所在根目录的信任级别（system = 随部署，user = 本地创作）。 */
  trust: 'system' | 'user';
  /** 组装文件绝对路径。 */
  path: string;
  /** 无法组装的原因（发现期形状检查；原样展示）。 */
  broken?: string;
}

/** 不可变会话检查结果（不恢复、不发布 agent）。 */
export interface SessionInspection {
  meta: PersistedSessionHeader;
  events: SessionEvent[];
}

/** boot() 返回的根上下文中，本客户端用到的能力子集。 */
export interface HarnessContext {
  llm: {
    listModels(provider: string): Promise<LlmModelInfo[]>;
  };
  agents: {
    create(options: {
      sessionId: string;
      meta?: { cwd?: string; agentPreset?: string };
      agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
      /** 会话种子（fork / 子代理）：从 seq 0 连续的事件前缀，成为子会话历史。 */
      seed?: SessionEvent[];
      /**
       * 创建期组装钩子（agent 工厂在发布前 await）：Agent 预设的
       * agentPresets.mount(agentCtx, id) 在这里调用，拒绝即回滚整个创建。
       */
      setup?: (agentCtx: unknown) => void | Promise<void>;
    }): Promise<AgentHandle>;
    resume(options: {
      resumeSessionId: string;
      agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
      /** 恢复期组装钩子：按会话记录的预设重建（resolveSessionPreset 语义）。 */
      setup?: (agentCtx: unknown) => void | Promise<void>;
    }): Promise<AgentHandle>;
  };
  /** 不可变会话检查结果（不恢复、不发布 agent）。 */
  sessionPersistence: {
    list(): Promise<PersistedSessionHeader[]>;
    inspect(id: string): Promise<SessionInspection>;
  };
  /**
   * Agent 预设 roster（host 组合携带 agent-presets 行时存在）。
   * 方法面按 dsh-agent-presets 服务裁剪；AgentPresetInfo 为其 AgentPreset 视图。
   */
  agentPresets?: {
    /** 调用方未指定时挂载的预设 id（settings 命名空间 agent-presets 热读）。 */
    readonly defaultId: string;
    list(): Promise<AgentPresetInfo[]>;
    resolve(id?: string): Promise<AgentPresetInfo>;
    /** 组装一个 agent（仅工厂 setup 钩子内调用）；损坏预设以发现原因拒绝。 */
    mount(agentCtx: unknown, id?: string): Promise<AgentPresetInfo>;
    /** 空白会话切换预设（重链 scope 父；调用方负责空白检查与事件记录）。 */
    recompose(agentCtx: unknown, id: string): Promise<AgentPresetInfo>;
    /** 宿主侧读取某 agent 预设内 isolate realm 服务的唯一通道（如 planMode）。 */
    serviceFor(agent: { ctx: unknown }, name: string): unknown;
  };
  /** ask_user_question 的提供者注册面。 */
  userQuestions: {
    registerProvider(provider: { ask(request: unknown): Promise<unknown> }): void;
  };
  /** 新会话的默认模型选择（官方创建路径在创建时读取）。 */
  agentDefaultModel: {
    currentSelection(): { provider: string; model: string; reasoningEffort?: string };
    saveSelection(next: { provider: string; model: string }): Promise<void>;
  };
  /** 用户设置文档（llm-deepseek 等命名空间的读写）。 */
  settings: {
    get(namespace: string): Promise<unknown>;
    replace(namespace: string, section: unknown): Promise<void>;
  };
  /** 凭据存储（DEEPSEEK_API_KEY 写入 .credentials.yaml）。 */
  credentials: {
    describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>;
    set(ref: string, value: string): Promise<void>;
  };
  /** 工具审批服务：per-agent 策略（'ask' 询问 / 'never' 不询问，持久化事件）。 */
  approval: {
    setPolicy(agent: Agent, policy: 'ask' | 'never'): void;
  };
  /** harness 原生计划模式：激活时每个请求附带 plan:policy 提示段。
   * （预设化后 planMode 服务在预设的 isolate realm 内，宿主侧经
   * agentPresets.serviceFor(agent, 'planMode') 访问；此处仅为无 roster
   * 组合的兜底，通常为 undefined。） */
  planMode?: {
    /** 返回 committed / queued / cancelled / noop（回合开启中排队到下一步生效）。 */
    set(agent: Agent, active: boolean): string;
  };
  /** 根 fiber 销毁：官方 CLI 的停机路径（profile-boot.ts）即 ctx.fiber.dispose()。 */
  fiber: {
    dispose(): Promise<void>;
  };
  on(event: 'session/event', listener: (session: { id: string }, event: SessionEvent) => void): void;
  on(event: 'agent/status', listener: (payload: { agent: { id: string }; status: string }) => void): void;
  /** 子代理运行生命周期（payload 为 dsh-subagent 的 SubagentRunInfo 裁剪视图）。 */
  on(
    event: 'subagent/start',
    listener: (info: { runId: string; provider: string; id: string; local: boolean }) => void,
  ): void;
  on(
    event: 'subagent/end',
    listener: (info: {
      runId: string;
      provider: string;
      id: string;
      local: boolean;
      stopReason: string;
      lastAssistantMessage?: unknown;
    }) => void,
  ): void;
  on(
    event: 'tools/pre-execute',
    listener: (
      exec: { name: string; agent?: { id: string }; signal?: AbortSignal },
      next: () => Promise<unknown>,
    ) => unknown,
  ): void;
  on(
    event: 'approval/request',
    listener: (
      req: { agent: { id: string }; toolName: string; reason?: string; signal?: AbortSignal },
      next: () => Promise<string>,
    ) => unknown,
  ): void;
}

/** @deepseek-ai/dsh-app-boot 导出的 boot（仅声明用到的形状）。 */
export type BootFn = (
  binName: string,
  absoluteConfigPath: string,
  patches?: unknown,
  prepare?: (ctx: HarnessContext) => void | Promise<void>,
  bareModuleBaseUrl?: string,
) => Promise<HarnessContext>;

/** @deepseek-ai/dsh-llm 导出的消息构造器（仅声明用到的形状）。 */
export interface LlmHelpers {
  createUserMessage(input: {
    content: TextContentBlock[];
    source: { kind: 'user' };
  }): UserMessage;
}
