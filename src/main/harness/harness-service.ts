import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveHarnessPaths } from './paths.js';
import {
  InteractionBridge,
  type ApprovalOutcome,
  type InteractionDto,
  type QuestionAnswer,
} from './interactions.js';
import type {
  AgentHandle,
  Agent,
  BootFn,
  HarnessContext,
  LlmHelpers,
  LlmModelInfo,
  PersistedSessionHeader,
  SessionEvent,
  SessionInspection,
  UserMessage,
} from './harness-context.js';
import type { AgentModeDto } from '../../shared/protocol.js';

/**
 * harness 宿主服务：主进程内的单例，负责 boot() 的环境准备、启动、
 * 状态机、会话代理（agent 生命周期 / prompt / 取消）与事件桥，
 * 以及优雅停机。渲染层通过 IPC 消费。
 */

export type HostStatus = 'booting' | 'ready' | 'error';

export interface HostState {
  status: HostStatus;
  /** status === 'error' 时的失败原因（面向用户展示）。 */
  error?: string;
  /** 当前工作区目录。 */
  workspace: string;
}

/** 推送给渲染层的事件信封。 */
export type HarnessEventEnvelope =
  | { kind: 'session-event'; sessionId: string; event: unknown }
  | { kind: 'agent-status'; sessionId: string; status: string }
  | InteractionDto;

type StatusListener = (state: HostState) => void;
type EventListener = (envelope: HarnessEventEnvelope) => void;

export interface PromptOptions {
  mode?: 'queue' | 'steer';
}

/** llm-deepseek 设置段的完整形状（供应商服务整段写入）。 */
export interface LlmSectionInput {
  baseURL: string;
  models: { id: string; name?: string }[];
  thinking: 'enabled' | 'disabled';
  reasoningEffort: 'off' | 'high' | 'max';
}

/** 凭据引用（harness 侧固定路由 DEEPSEEK_API_KEY）。 */
const API_KEY_REF = 'DEEPSEEK_API_KEY';

export class HarnessService {
  private ctx: HarnessContext | undefined;
  private llmHelpers: LlmHelpers | undefined;
  private readonly interactions = new InteractionBridge();
  private readonly agentHandles = new Map<string, AgentHandle>();
  private state: HostState;
  private readonly statusListeners = new Set<StatusListener>();
  private readonly eventListeners = new Set<EventListener>();
  private starting = false;
  /** 供应商服务注入：每轮对话前取轮询密钥（多 key round-robin）。 */
  private keyResolver: (() => string | undefined) | undefined;
  /** Agent 权限模式（应用设置，settings-service 变更时写入）。 */
  private agentMode: AgentModeDto = 'ask';

  constructor() {
    const paths = resolveHarnessPaths();
    this.state = { status: 'booting', workspace: paths.workspace };
  }

  getState(): HostState {
    return { ...this.state };
  }

  isReady(): boolean {
    return this.ctx !== undefined;
  }

  /** 供应商服务注入 key 轮换器；返回 undefined 表示无需更新凭据。 */
  setKeyResolver(resolver: () => string | undefined): void {
    this.keyResolver = resolver;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private setState(next: Partial<HostState>): void {
    this.state = { ...this.state, ...next };
    // 主进程日志：forge start 控制台可见，是 harness 集成问题的第一诊断入口。
    if (this.state.status === 'error') {
      console.error('[harness] 启动失败：', this.state.error);
    } else {
      console.info(`[harness] 状态：${this.state.status}`);
    }
    for (const listener of this.statusListeners) listener(this.getState());
  }

  private emit(envelope: HarnessEventEnvelope): void {
    for (const listener of this.eventListeners) listener(envelope);
  }

  /**
   * 启动 harness：设置 DSH_* 环境后动态加载 boot() 并按我们的 cordis.yml 组合。
   * 幂等保护：并发调用只执行一次；失败进入 error 态（可重试——再次调用 start）。
   */
  async start(prepare?: (ctx: HarnessContext) => void | Promise<void>): Promise<void> {
    if (this.ctx !== undefined || this.starting) return;
    this.starting = true;
    const paths = resolveHarnessPaths();

    // 环境必须在 boot 前就位：DSH_HOME 收敛数据目录；DSH_CWD 供 fs-local 等消费；
    // DSH_HARNESS_ROOT 供 subprocess-child 插件定位 seam 模块。
    process.env.DSH_HOME = paths.dshHome;
    process.env.DSH_CWD = paths.workspace;
    process.env.DSH_HARNESS_ROOT = paths.harnessRoot;
    this.setState({ status: 'booting', workspace: paths.workspace });

    try {
      const bootModuleUrl = pathToFileURL(
        path.join(paths.harnessRoot, 'packages', 'boot', 'app-boot', 'lib', 'index.js'),
      ).href;
      // 以绝对 file URL 动态加载，避免打包器解析 harness 内部依赖。
      const bootModule = (await import(/* @vite-ignore */ bootModuleUrl)) as { boot: BootFn };
      const llmModuleUrl = pathToFileURL(
        path.join(paths.harnessRoot, 'packages', 'llm', 'llm', 'lib', 'index.js'),
      ).href;
      this.llmHelpers = (await import(/* @vite-ignore */ llmModuleUrl)) as LlmHelpers;

      const ctx = await bootModule.boot('dsh-code', paths.configPath, undefined, (bootCtx) => {
        // prepare 阶段只允许事件监听（服务此时未装载）。
        this.interactions.attach(bootCtx, (dto) => this.emit(dto), () => this.agentMode);
        return prepare?.(bootCtx);
      });
      // 服务面（userQuestions 等）在 boot 完成后才可访问。
      this.interactions.attachLate(ctx, (dto) => this.emit(dto));
      this.ctx = ctx;
      this.attachEventBridge(ctx);
      this.setState({ status: 'ready', error: undefined });
    } catch (error) {
      this.setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.starting = false;
    }
  }

  /** 会话事件与 agent 状态 → 统一信封推给渲染层。 */
  private attachEventBridge(ctx: HarnessContext): void {
    ctx.on('session/event', (session, event) => {
      this.emit({ kind: 'session-event', sessionId: session.id, event });
    });
    ctx.on('agent/status', ({ agent, status }) => {
      this.emit({ kind: 'agent-status', sessionId: agent.id, status });
    });
  }

  /** 应用停机路径：销毁根 fiber（官方 CLI 同款语义）。 */
  async stop(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = undefined;
    const handles = [...this.agentHandles.values()];
    this.agentHandles.clear();
    for (const handle of handles) {
      try {
        await handle.dispose();
      } catch {
        // 尽力而为。
      }
    }
    if (ctx === undefined) return;
    try {
      await ctx.fiber.dispose();
    } catch {
      // 停机尽力而为；进程即将退出。
    }
  }

  /**
   * 切换工作区（项目）：停机 → 改 DSH_CWD → 重新 boot。
   * fs-local 等插件在 boot 时读环境变量决定工作目录，因此切换 = 重启组合；
   * 会话持久化根目录不变，全部项目的会话仍在同一棵树，渲染层按 cwd 分组。
   * 运行中的会话会随停机销毁（调用方负责 UI 状态重置）。
   */
  async switchWorkspace(cwd: string): Promise<HostState> {
    if (cwd.trim().length === 0) throw new Error('工作区路径不能为空');
    const next = path.resolve(cwd);
    if (next === resolveHarnessPaths().workspace) return this.getState();
    // 目录不存在时直接拒绝：boot 到无效目录会得到一个“假就绪”的工作区。
    try {
      if (!statSync(next).isDirectory()) throw new Error('not-a-directory');
    } catch {
      throw new Error(`项目文件夹不存在：${next}`);
    }
    await this.stop();
    process.env.DSH_CWD = next;
    await this.start();
    return this.getState();
  }

  /** 模型目录（供设置页选择器）。 */
  async listModels(provider: string): Promise<LlmModelInfo[]> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    return ctx.llm.listModels(provider);
  }

  /** 持久化会话列表（剔除子代理会话，按创建时间倒序）。 */
  async listSessions(): Promise<PersistedSessionHeader[]> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const all = await ctx.sessionPersistence.list();
    return all
      .filter((header) => header.origin !== 'subagent')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** 读取会话完整事件（不恢复 agent；渲染层用同一条折叠路径回放）。 */
  async sessionHistory(sessionId: string): Promise<SessionEvent[]> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const inspection: SessionInspection = await ctx.sessionPersistence.inspect(sessionId);
    return [...inspection.events];
  }

  /** 打开（必要时恢复）一个会话，返回其 id。 */
  async openSession(sessionId: string): Promise<void> {
    if (this.agentHandles.has(sessionId)) return;
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: ctx.agentDefaultModel.currentSelection(),
    });
    this.applyAgentMode(ctx, handle.agent);
    this.agentHandles.set(sessionId, handle);
  }

  /** 新建会话（懒启动：agent 在首个 prompt 前不产生请求）。 */
  async createSession(options?: { model?: string }): Promise<string> {
    const sessionId = `session-${randomUUID()}`;
    await this.ensureAgent(sessionId, options);
    return sessionId;
  }

  private async ensureAgent(
    sessionId: string,
    options?: { model?: string },
  ): Promise<AgentHandle> {
    const existing = this.agentHandles.get(sessionId);
    if (existing !== undefined) return existing;
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const paths = resolveHarnessPaths();
    // 官方创建路径：创建时读取 agentDefaultModel.currentSelection()（显式 model 覆盖）。
    const defaultSelection = ctx.agentDefaultModel.currentSelection();
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: paths.workspace },
      agentOptions:
        options?.model !== undefined
          ? { provider: defaultSelection.provider, model: options.model }
          : defaultSelection,
    });
    this.applyAgentMode(ctx, handle.agent);
    this.agentHandles.set(sessionId, handle);
    return handle;
  }

  /** 发送一轮用户输入：queue 排队跟随，steer 插话当前回合。 */
  async prompt(sessionId: string, text: string, options?: PromptOptions): Promise<void> {
    const handle = await this.ensureAgent(sessionId);
    const helpers = this.llmHelpers;
    if (helpers === undefined) throw new Error('harness 尚未就绪');
    // 多 key 轮询：每轮换下一把启用的 key（未变化时 resolver 返回 undefined）。
    const nextKey = this.keyResolver?.();
    if (nextKey !== undefined) {
      await this.ctx?.credentials.set(API_KEY_REF, nextKey);
    }
    const message: UserMessage = helpers.createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    });
    if (options?.mode === 'steer') handle.agent.steer(message);
    else handle.agent.followup(message);
  }

  /** 取消运行中的回合（保留收件箱中的排队输入）。 */
  async cancel(sessionId: string): Promise<void> {
    const handle = this.agentHandles.get(sessionId);
    if (handle === undefined) return;
    handle.agent.cancel({ kind: 'user' }, { keepInbox: true });
  }

  /** UI 应答审批；返回是否命中挂起项。 */
  respondApproval(id: string, outcome: Exclude<ApprovalOutcome, 'cancelled' | 'unavailable'>): boolean {
    return this.interactions.respondApproval(id, outcome);
  }

  /** UI 应答提问；返回是否命中挂起项。 */
  respondQuestion(id: string, answers: QuestionAnswer[]): boolean {
    return this.interactions.respondQuestion(id, answers);
  }

  /* ──────────────────────────── Agent 权限模式 ──────────────────────────── */

  /**
   * 切换 Agent 权限模式（应用设置驱动）：记录后应用到全部活跃 agent——
   * full → approval 'never'（不询问）；其余 → approval 'ask'；plan → 额外
   * 激活 harness 原生计划模式（plan:policy 提示段 + exit_plan_mode 工具，
   * 回合运行中排队到下一步生效）。审批门的放行/拒绝逻辑见 InteractionBridge。
   */
  setAgentMode(mode: AgentModeDto): void {
    this.agentMode = mode;
    const ctx = this.ctx;
    if (ctx === undefined) return;
    for (const handle of this.agentHandles.values()) {
      this.applyAgentMode(ctx, handle.agent);
    }
  }

  getAgentMode(): AgentModeDto {
    return this.agentMode;
  }

  /** 把当前模式写入单个 agent（创建 / 恢复 / 模式切换时）。 */
  private applyAgentMode(ctx: HarnessContext, agent: Agent): void {
    try {
      ctx.approval.setPolicy(agent, this.agentMode === 'full' ? 'never' : 'ask');
    } catch (error) {
      console.error('[harness] 设置审批策略失败：', error);
    }
    try {
      ctx.planMode.set(agent, this.agentMode === 'plan');
    } catch (error) {
      console.error('[harness] 切换计划模式失败：', error);
    }
  }

  /* ──────────────────────────── 设置与凭据 ──────────────────────────── */

  /** llm-deepseek 命名空间整段替换（baseURL / 模型目录 / 思考偏好，热生效）。 */
  async updateLlmSection(section: LlmSectionInput): Promise<void> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    await ctx.settings.replace('llm-deepseek', section);
  }

  /** 写入 API Key 到受管凭据文档（$DSH_HOME/.credentials.yaml，热生效）。 */
  async setCredential(value: string): Promise<void> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    await ctx.credentials.set(API_KEY_REF, value);
  }

  /** 当前默认模型选择。 */
  async getDefaultModel(): Promise<{ provider: string; model: string }> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    return ctx.agentDefaultModel.currentSelection();
  }

  /** 保存默认模型选择（影响之后创建的会话）。 */
  async setDefaultModel(model: string): Promise<void> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    await ctx.agentDefaultModel.saveSelection({ provider: 'deepseek-official', model });
  }
}
