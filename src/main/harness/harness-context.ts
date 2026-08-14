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
      meta?: { cwd?: string };
      agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
    }): Promise<AgentHandle>;
    resume(options: {
      resumeSessionId: string;
      agentOptions?: { provider?: string; model?: string; reasoningEffort?: string };
    }): Promise<AgentHandle>;
  };
  /** 持久化会话读取（列表与免恢复检查）。 */
  sessionPersistence: {
    list(): Promise<PersistedSessionHeader[]>;
    inspect(id: string): Promise<SessionInspection>;
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
  /** harness 原生计划模式：激活时每个请求附带 plan:policy 提示段。 */
  planMode: {
    /** 返回 committed / queued / cancelled / noop（回合开启中排队到下一步生效）。 */
    set(agent: Agent, active: boolean): string;
  };
  /** 根 fiber 销毁：官方 CLI 的停机路径（profile-boot.ts）即 ctx.fiber.dispose()。 */
  fiber: {
    dispose(): Promise<void>;
  };
  on(event: 'session/event', listener: (session: { id: string }, event: SessionEvent) => void): void;
  on(event: 'agent/status', listener: (payload: { agent: { id: string }; status: string }) => void): void;
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
