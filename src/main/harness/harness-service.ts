import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolveHarnessPaths } from './paths.js';
import type { LoaderPatch } from './composition.js';
import { completedTurnPrefix, resolveSessionPreset } from './session-fork.js';
import {
  InteractionBridge,
  type ApprovalOutcome,
  type InteractionDto,
  type QuestionAnswer,
} from './interactions.js';
import type {
  AgentHandle,
  Agent,
  AgentPresetInfo,
  BootFn,
  HarnessContext,
  LlmHelpers,
  LlmModelInfo,
  PersistedSessionHeader,
  SessionEvent,
  SessionInspection,
  UserMessage,
} from './harness-context.js';
import type { AgentModeDto, SubagentRunDto } from '../../shared/protocol.js';

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
  | { kind: 'subagent-start'; run: SubagentRunDto }
  | { kind: 'subagent-end'; run: SubagentRunDto }
  | InteractionDto;

type StatusListener = (state: HostState) => void;
type EventListener = (envelope: HarnessEventEnvelope) => void;

export interface PromptOptions {
  mode?: 'queue' | 'steer';
}

/** llm-deepseek 设置段的完整形状（供应商服务整段写入）。 */
export interface LlmSectionInput {
  baseURL: string;
  models: { id: string; name?: string; contextWindow?: number }[];
  thinking: 'enabled' | 'disabled';
  reasoningEffort: 'off' | 'high' | 'max';
  /** 单次请求输出上限（缺省 = harness 默认 256K）。 */
  maxTokens?: number;
  /** 模型未声明 contextWindow 时的兜底（缺省 = harness 默认 1M）。 */
  defaultContextWindow?: number;
}

export interface HarnessServiceOptions {
  /** boot 补丁构建器（MCP 服务器 / 沙箱等应用设置驱动的动态组合）。 */
  buildPatches?: () => LoaderPatch[];
}

/** 凭据引用（harness 侧固定路由 DEEPSEEK_API_KEY）。 */
const API_KEY_REF = 'DEEPSEEK_API_KEY';

/** 子会话头 inspect 的兜底重试等待（header 与 start 事件的微小竞态）。 */
const SUBAGENT_INSPECT_RETRY_MS = 120;

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
  /** boot 补丁构建器（每次 start 时读取最新应用设置）。 */
  private readonly buildPatches?: () => LoaderPatch[];
  /** 运行中 / 已结束的子代理运行（runId → 视图，live 事件与冷列表共用）。 */
  private readonly subagentRuns = new Map<string, SubagentRunDto>();

  constructor(options?: HarnessServiceOptions) {
    const paths = resolveHarnessPaths();
    this.state = { status: 'booting', workspace: paths.workspace };
    this.buildPatches = options?.buildPatches;
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
    // DSH_HARNESS_ROOT 供 subprocess-child 插件定位 seam 模块；DSH_CONFIG_DIR
    // 供 agent-presets 行解析随附预设根目录（= cordis.yml 所在目录）。
    process.env.DSH_HOME = paths.dshHome;
    process.env.DSH_CWD = paths.workspace;
    process.env.DSH_HARNESS_ROOT = paths.harnessRoot;
    process.env.DSH_CONFIG_DIR = path.dirname(paths.configPath);
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

      const ctx = await bootModule.boot(
        'dsh-code',
        paths.configPath,
        // 应用设置驱动的动态组合（MCP 服务器 / 沙箱栈）以 boot 补丁注入，
        // cordis.yml 保持静态基线。
        this.buildPatches?.() ?? [],
        (bootCtx) => {
          // prepare 阶段只允许事件监听（服务此时未装载）。
          this.interactions.attach(bootCtx, (dto) => this.emit(dto), () => this.agentMode);
          return prepare?.(bootCtx);
        },
      );
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
    // 子代理生命周期：start 时从持久化头补父子关系与 descriptor 标签
    // （事件 payload 只有 runId + 子会话 id），end 时合并终止原因与末条助手消息。
    ctx.on('subagent/start', (info) => {
      void this.describeSubagentRun(info.id, {
        childSessionId: info.id,
        parentSessionId: '',
        label: '',
        status: 'running',
      }).then((described) => {
        // continuable 子代理每个驻留期都发一对 start/end，事件本身才是
        // 运行态的权威来源（inspect 到已完成回合不代表运行结束）。
        const run: SubagentRunDto = { ...described, status: 'running' };
        this.subagentRuns.set(info.runId, run);
        this.emit({ kind: 'subagent-start', run });
      });
    });
    ctx.on('subagent/end', (info) => {
      const previous = this.subagentRuns.get(info.runId);
      const run: SubagentRunDto = {
        childSessionId: info.id,
        parentSessionId: previous?.parentSessionId ?? '',
        label: previous?.label ?? '',
        status: 'ended',
        endReason: info.stopReason,
        ...(info.lastAssistantMessage !== undefined
          ? { summary: textOfContentBlocks(info.lastAssistantMessage) }
          : {}),
      };
      this.subagentRuns.set(info.runId, run);
      this.emit({ kind: 'subagent-end', run });
    });
  }

  /** start 事件的补全：inspect 子会话头（parentSession）与 descriptor 标签。 */
  private async describeSubagentRun(
    childSessionId: string,
    fallback: SubagentRunDto,
  ): Promise<SubagentRunDto> {
    const ctx = this.ctx;
    if (ctx === undefined) return fallback;
    const read = async (): Promise<SubagentRunDto | undefined> => {
      try {
        const inspection = await ctx.sessionPersistence.inspect(childSessionId);
        return subagentRunFromInspection(inspection, fallback);
      } catch {
        return undefined;
      }
    };
    let described = await read();
    if (described === undefined || described.parentSessionId.length === 0) {
      // header 与 start 事件的落盘有微小竞态：等一拍重读一次。
      await new Promise((resolve) => setTimeout(resolve, SUBAGENT_INSPECT_RETRY_MS));
      described = await read();
      if (described === undefined) return fallback;
    }
    return described;
  }

  /** 应用停机路径：销毁根 fiber（官方 CLI 同款语义）。 */
  async stop(): Promise<void> {
    const ctx = this.ctx;
    this.ctx = undefined;
    this.subagentRuns.clear();
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

  /** 父会话的子代理目录（冷数据：持久化头 parentSession 过滤 + descriptor 标签）。 */
  async listSubagents(parentSessionId: string): Promise<SubagentRunDto[]> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const all = await ctx.sessionPersistence.list();
    const children = all
      .filter(
        (header) =>
          header.origin === 'subagent' &&
          header.parentSession === parentSessionId,
      )
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-20);
    const runs: SubagentRunDto[] = [];
    for (const header of children) {
      // 运行映射已有该子会话的实时视图（含终止原因），优先于冷读。
      const live = [...this.subagentRuns.values()].find(
        (run) => run.childSessionId === header.id,
      );
      if (live !== undefined) {
        runs.push(live);
        continue;
      }
      try {
        const inspection = await ctx.sessionPersistence.inspect(header.id);
        runs.push(subagentRunFromInspection(inspection, {
          childSessionId: header.id,
          parentSessionId,
          label: '',
          status: 'ended',
        }));
      } catch {
        // 读不动的子会话跳过（半写状态或并发删除）。
      }
    }
    return runs;
  }

  /**
   * 派生会话（fork）：以父会话「最后一个已完成回合」为种子创建新会话
   * （对齐 harness subagent-fork-in-process 的种子语义），新会话是普通
   * 顶层会话（无 subagent 标记），立即出现在侧栏。预设随父会话解析
   * （resolveSessionPreset：空白期切换以事件为准），fork 非空白，
   * 创建时挂载即定档。
   */
  async forkSession(sessionId: string): Promise<string> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const inspection = await ctx.sessionPersistence.inspect(sessionId);
    const seed = completedTurnPrefix([...inspection.events]);
    const paths = resolveHarnessPaths();
    const cwd = inspection.meta.cwd ?? paths.workspace;
    const newId = `session-${randomUUID()}`;
    const defaultSelection = ctx.agentDefaultModel.currentSelection();
    const composition = await this.composeAgent(resolveSessionPreset(inspection));
    const handle = await ctx.agents.create({
      sessionId: newId,
      meta: {
        cwd,
        ...(composition.agentPreset !== undefined ? { agentPreset: composition.agentPreset } : {}),
      },
      ...(seed.length > 0 ? { seed } : {}),
      agentOptions: defaultSelection,
      ...(composition.setup !== undefined ? { setup: composition.setup } : {}),
    });
    this.applyAgentMode(ctx, handle.agent);
    this.agentHandles.set(newId, handle);
    return newId;
  }

  /** 重启组合（不换工作区）：MCP 服务器等 boot 补丁变更后应用。 */
  async restart(): Promise<HostState> {
    await this.stop();
    await this.start();
    return this.getState();
  }

  /** 打开（必要时恢复）一个会话，返回其 id。 */
  async openSession(sessionId: string): Promise<void> {
    if (this.agentHandles.has(sessionId)) return;
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    // 恢复按会话记录的预设重建（resolveSessionPreset：空白期切换以事件为准；
    // 迁移前的旧会话无记录 → roster 默认 plugin，与其历史产出组合一致）。
    const inspection: SessionInspection = await ctx.sessionPersistence.inspect(sessionId);
    const composition = await this.composeAgent(resolveSessionPreset(inspection));
    const handle = await ctx.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: ctx.agentDefaultModel.currentSelection(),
      ...(composition.setup !== undefined ? { setup: composition.setup } : {}),
    });
    this.applyAgentMode(ctx, handle.agent);
    this.agentHandles.set(sessionId, handle);
  }

  /** 新建会话（懒启动：agent 在首个 prompt 前不产生请求）。 */
  async createSession(options?: {
    model?: string;
    /** 显式预设 id；缺省 = roster 默认（settings 命名空间 agent-presets）。 */
    preset?: string;
  }): Promise<{ sessionId: string; agentPreset?: string }> {
    const sessionId = `session-${randomUUID()}`;
    const handle = await this.ensureAgent(sessionId, options);
    return {
      sessionId,
      ...(handle.preset !== undefined ? { agentPreset: handle.preset } : {}),
    };
  }

  private async ensureAgent(
    sessionId: string,
    options?: { model?: string; preset?: string },
  ): Promise<AgentHandle & { preset?: string }> {
    const existing = this.agentHandles.get(sessionId);
    if (existing !== undefined) return existing;
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const paths = resolveHarnessPaths();
    // 官方创建路径：创建时读取 agentDefaultModel.currentSelection()（显式 model 覆盖）。
    const defaultSelection = ctx.agentDefaultModel.currentSelection();
    const composition = await this.composeAgent(options?.preset);
    const handle = await ctx.agents.create({
      sessionId,
      meta: {
        cwd: paths.workspace,
        ...(composition.agentPreset !== undefined ? { agentPreset: composition.agentPreset } : {}),
      },
      agentOptions:
        options?.model !== undefined
          ? { provider: defaultSelection.provider, model: options.model }
          : defaultSelection,
      ...(composition.setup !== undefined ? { setup: composition.setup } : {}),
    });
    this.applyAgentMode(ctx, handle.agent);
    const entry = Object.assign(handle, { preset: composition.agentPreset });
    this.agentHandles.set(sessionId, entry);
    return entry;
  }

  /**
   * Agent 预设组装（对齐 harness api-proxy 的 composeAgent 模式）：
   * 预设 id → 记录到会话头（agentPreset）+ 工厂 setup 钩子（发布前
   * mount，拒绝即回滚整个创建）。无 roster 组合返回空（遗留插件模式）。
   */
  private async composeAgent(presetId?: string): Promise<{
    agentPreset?: string;
    setup?: (agentCtx: unknown) => Promise<void>;
  }> {
    const presets = this.ctx?.agentPresets;
    if (presets === undefined) return {};
    // resolve 在此（而非 setup 内）失败：未知/损坏预设的错误直接抛给创建调用方。
    const resolved = await presets.resolve(presetId);
    return {
      agentPreset: resolved.id,
      setup: async (agentCtx: unknown): Promise<void> => {
        await presets.mount(agentCtx, resolved.id);
      },
    };
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
      // plan-mode 已下沉到预设（isolate realm），宿主侧经 serviceFor 按 agent
      // 寻址；无 roster 组合退回根服务。预设未挂 plan-mode（如极简模式）=
      // 该会话不支持计划模式，静默跳过（工具面本就不含 exit_plan_mode）。
      const scoped = ctx.agentPresets?.serviceFor(agent, 'planMode') as
        | { set(agent: Agent, active: boolean): string }
        | undefined;
      const planMode = scoped ?? ctx.planMode;
      planMode?.set(agent, this.agentMode === 'plan');
    } catch (error) {
      console.error('[harness] 切换计划模式失败：', error);
    }
  }

  /* ──────────────────────────── Agent 预设 ──────────────────────────── */

  /** 预设名单（无 roster 组合返回空数组——渲染层据此隐藏选择器）。 */
  async listPresets(): Promise<AgentPresetInfo[]> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    return ctx.agentPresets?.list() ?? [];
  }

  /** roster 默认预设 id（未指定时新会话挂载它）。 */
  getDefaultPreset(): string | undefined {
    return this.ctx?.agentPresets?.defaultId;
  }

  /** 设置默认预设（settings 命名空间 agent-presets，影响之后创建的会话）。 */
  async setDefaultPreset(id: string): Promise<void> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const presets = ctx.agentPresets;
    if (presets === undefined) throw new Error('此组合未启用 Agent 预设');
    // 写前校验：settings 允许存尚不存在的名字，但 UI 侧应即时反馈拼写错误。
    await presets.resolve(id);
    await ctx.settings.replace('agent-presets', { default: id });
  }

  /**
   * 切换空白会话的预设（recompose 重链 scope 父；替换提交后追加
   * agent-preset/selected 事件持久化——模型可见 ⟺ 已记录规则）。
   * 已开始的会话拒绝（切换会抽出模型已调用的工具）；agent 不在场时
   * 先走恢复路径（按记录预设重建后再切换）。
   */
  async switchSessionPreset(sessionId: string, presetId: string): Promise<void> {
    const ctx = this.ctx;
    if (ctx === undefined) throw new Error('harness 尚未就绪');
    const presets = ctx.agentPresets;
    if (presets === undefined) throw new Error('此组合未启用 Agent 预设');
    await this.openSession(sessionId);
    const handle = this.agentHandles.get(sessionId);
    if (handle === undefined) throw new Error(`会话 ${sessionId} 无法恢复`);
    // 空白检查读活会话事件（与 api-proxy sessionBlank 同语义）：回合一旦
    // 开启（turn/start），历史已在该预设的工具面下产出。
    if (handle.agent.session.events.some((event) => event.type === 'turn/start')) {
      throw new Error('会话已开始对话，预设已锁定；新预设将只影响之后创建的会话');
    }
    const preset = await presets.recompose(handle.agent.ctx, presetId);
    await handle.agent.session.append('agent-preset/selected', { agentPreset: preset.id });
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

/* ──────────────────────────── 子代理视图辅助 ──────────────────────────── */

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** ContentBlock[] → 纯文本（text 块拼接，其余块跳过）。 */
function textOfContentBlocks(message: unknown): string {
  if (!Array.isArray(message)) return '';
  const parts: string[] = [];
  for (const block of message) {
    const record = asRecord(block);
    if (record?.type === 'text' && typeof record.text === 'string') parts.push(record.text);
  }
  return parts.join('\n');
}

/** 子会话检查结果 → 视图 DTO：header 的 parentSession + descriptor 标签 +
 * 末条助手文本（运行态由调用方决定：live 走事件、冷读恒为 ended）。 */
function subagentRunFromInspection(inspection: SessionInspection, fallback: SubagentRunDto): SubagentRunDto {
  const parentSessionId = inspection.meta.parentSession ?? fallback.parentSessionId;
  let label = fallback.label;
  let summary = fallback.summary;
  for (const event of inspection.events) {
    if (event.type === 'subagent/descriptor') {
      const labelValue = asRecord(event.data)?.label;
      if (typeof labelValue === 'string' && labelValue.length > 0) label = labelValue;
    } else if (event.type === 'assistant/message') {
      const text = textOfContentBlocks(asRecord(event.data)?.message);
      if (text.length > 0) summary = text;
    }
  }
  return {
    childSessionId: inspection.meta.id,
    parentSessionId,
    label,
    status: fallback.status,
    ...(fallback.endReason !== undefined ? { endReason: fallback.endReason } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}
