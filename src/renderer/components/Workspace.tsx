import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentPresetDto,
  HarnessEventDto,
  HostStateDto,
  PromptAttachmentDto,
  SessionSummaryDto,
  SubagentRunDto,
} from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';
import { ChatView } from './ChatView';
import { Composer } from './Composer';
import { SessionSidebar } from './SessionSidebar';
import { Splash } from './Splash';
import { TodoPanel } from './TodoPanel';
import type { SettingsSectionId } from './SettingsView';
import {
  ApprovalCard,
  QuestionCard,
  type PendingApproval,
  type PendingQuestion,
} from './InteractionCards';
import {
  foldEvent,
  foldEvents,
  initialSessionState,
  type SessionUiState,
} from '../state/sessionStore';
import { setSessionName, useSessionNames } from '../state/sessionNames';
import { buildSessionMarkdown, exportFileName } from '../state/sessionExport';
import { useAppSettings } from '../state/appSettings';
import { archiveSessions, getArchivedSessions } from '../state/archivedSessions';
import { getSessionLastActive, touchSessionActivity } from '../state/sessionActivity';

/**
 * 对话工作台：会话侧栏 + 任务面板 + 对话流 + 输入区。
 * 多会话状态按 id 分桶折叠；打开历史会话走同一条事件折叠路径（回放=实时）。
 * 子代理子会话事件同样按 id 入桶（跨会话聚合），卡片挂到父会话对话流。
 */

interface Notice {
  kind: 'ok' | 'error';
  text: string;
}

/** 自动归档扫描间隔（毫秒）。 */
const ARCHIVE_SCAN_INTERVAL_MS = 10 * 60 * 1000;

export interface WorkspaceProps {
  /** 打开设置页；可指定定位分区（账户菜单「API Key」→ 模型与凭据）。 */
  onOpenSettings(section?: SettingsSectionId): void;
}

export function Workspace({ onOpenSettings }: WorkspaceProps) {
  const [sessions, setSessions] = useState<SessionSummaryDto[]>([]);
  const [states, setStates] = useState<Record<string, SessionUiState>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [host, setHost] = useState<HostStateDto | null>(null);
  /** 批量拉取的冷会话标题（未加载历史的会话侧栏展示用；live 事件覆盖）。 */
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  /** 外部注入输入框的草稿（欢迎页建议卡）：token 推进时覆写并聚焦。 */
  const [injectedDraft, setInjectedDraft] = useState<{ text: string; token: number }>({ text: '', token: 0 });
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** 子代理运行（childSessionId → 视图；卡片挂父会话，transcript 读 states[childId]）。 */
  const [subagents, setSubagents] = useState<Record<string, SubagentRunDto>>({});
  /** Agent 预设名单与 roster 默认（宿主就绪后读取；空名单 = 未启用，隐藏选择器）。 */
  const [presets, setPresets] = useState<AgentPresetDto[]>([]);
  const [defaultPreset, setDefaultPreset] = useState('');
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  /** 会话列表最新值（事件流回调里做「未知会话」判定，规避旧闭包）。 */
  const sessionsRef = useRef<SessionSummaryDto[]>([]);
  sessionsRef.current = sessions;
  const noticeTimer = useRef<number | null>(null);
  /** 已处理过的工作区（宿主就绪流按 workspace 变化识别项目切换）。 */
  const workspaceSeenRef = useRef('');
  /** 上一次宿主状态：ready 之外的任何状态都意味着引擎重启（MCP 应用等），
   * 回到 ready 时需要像切换工作区一样复位本地会话状态。 */
  const hostStatusSeenRef = useRef<string>('booting');
  /** 切换项目后待打开的会话 id（点了其他项目的会话时）。 */
  const pendingOpenRef = useRef<string | null>(null);
  /** 切换项目后待新建会话（＋菜单「在项目中新建会话」）。 */
  const pendingCreateRef = useRef(false);
  const localNames = useSessionNames();
  const { settings, update: updateAppSettings } = useAppSettings();

  const showNotice = useCallback((next: Notice) => {
    setNotice(next);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const bridge = requireBridge();
      const list = await bridge.session.list();
      setSessions(list);
      // 冷启动标题：未加载过历史的会话在侧栏只显示 id 前缀，这里批量补齐。
      void bridge.session
        .titles()
        .then((titles) => setSessionTitles(titles))
        .catch((error) => console.error('读取会话标题失败', error));
    } catch (error) {
      console.error('读取会话列表失败', error);
    }
  }, []);

  /** 预设名单 + roster 默认（宿主就绪 / 引擎重启后读取）。 */
  const refreshPresets = useCallback(async () => {
    try {
      const bridge = requireBridge();
      const [list, def] = await Promise.all([bridge.presets.list(), bridge.presets.getDefault()]);
      setPresets(list);
      setDefaultPreset(def ?? '');
    } catch (error) {
      console.error('读取 Agent 预设失败', error);
    }
  }, []);

  const createSession = useCallback(async () => {
    const bridge = requireBridge();
    const { sessionId, agentPreset } = await bridge.session.create();
    // 创建即 priming 预设（会话头的 agentPreset 回传；空白期切换经事件流覆盖）。
    setStates((previous) => ({
      ...previous,
      [sessionId]: {
        ...initialSessionState(),
        ...(agentPreset !== undefined ? { agentPreset } : {}),
      },
    }));
    setActiveId(sessionId);
    void refreshSessions();
  }, [refreshSessions]);

  /** 打开会话：懒加载历史（仅首次），恢复 agent；跨项目会话先切换工作区。 */
  const openSession = useCallback(
    async (sessionId: string) => {
      const bridge = requireBridge();
      const session = sessions.find((item) => item.id === sessionId);
      const cwd = session?.cwd ?? '';
      if (host !== null && cwd.length > 0 && cwd.toLowerCase() !== host.workspace.toLowerCase()) {
        // 会话属于其他项目：先切换工作区，就绪后由启动流打开该会话。
        pendingOpenRef.current = sessionId;
        try {
          await bridge.host.switchWorkspace(cwd);
        } catch (error) {
          pendingOpenRef.current = null;
          console.error('切换工作区失败', error);
        }
        return;
      }
      setActiveId(sessionId);
      touchSessionActivity(sessionId);
      if (states[sessionId] === undefined) {
        try {
          const events = await bridge.session.history(sessionId);
          // 会话头预设作种子（空白期切换以 agent-preset/selected 事件 last-wins 覆盖）。
          const seed = {
            ...initialSessionState(),
            ...(session?.agentPreset !== undefined ? { agentPreset: session.agentPreset } : {}),
          };
          setStates((previous) => ({ ...previous, [sessionId]: foldEvents(seed, events) }));
        } catch (error) {
          console.error('读取会话历史失败', error);
          setStates((previous) => ({ ...previous, [sessionId]: initialSessionState() }));
        }
      }
      // 子代理历史（冷数据）：子会话 transcript 一并回放（最近 20 个）。
      try {
        const runs = await bridge.session.subagents(sessionId);
        if (runs.length === 0) return;
        setSubagents((previous) => {
          const next = { ...previous };
          for (const run of runs) next[run.childSessionId] = run;
          return next;
        });
        const missing = runs
          .map((run) => run.childSessionId)
          .filter((childId) => states[childId] === undefined);
        if (missing.length === 0) return;
        const transcripts = await Promise.allSettled(
          missing.map((childId) => bridge.session.history(childId)),
        );
        setStates((previous) => {
          const next = { ...previous };
          transcripts.forEach((result, index) => {
            const childId = missing[index];
            if (childId === undefined) return;
            next[childId] =
              result.status === 'fulfilled'
                ? foldEvents(initialSessionState(), result.value)
                : (next[childId] ?? initialSessionState());
          });
          return next;
        });
      } catch (error) {
        console.error('读取子代理目录失败', error);
      }
      try {
        await bridge.session.open(sessionId);
      } catch (error) {
        console.error('恢复会话失败', error);
      }
    },
    [sessions, states, host],
  );

  /** 切换项目（侧栏项目行 / 创建项目后）：重启 harness 到新工作区。 */
  const switchProject = useCallback(async (cwd: string) => {
    if (cwd.length === 0) return;
    try {
      await requireBridge().host.switchWorkspace(cwd);
    } catch (error) {
      pendingCreateRef.current = false;
      pendingOpenRef.current = null;
      console.error('切换项目失败', error);
      showNotice({
        kind: 'error',
        text: `切换项目失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [showNotice]);

  /** 在指定项目新建会话：当前项目直接建；其他项目先切换工作区，就绪后自动建。 */
  const createSessionIn = useCallback(
    (cwd: string) => {
      if (cwd.length === 0) return;
      if (host !== null && cwd.toLowerCase() === host.workspace.toLowerCase()) {
        void createSession();
        return;
      }
      pendingCreateRef.current = true;
      void switchProject(cwd);
    },
    [host, createSession, switchProject],
  );

  // 宿主就绪流：首次启动 / 项目切换 / 引擎重启后，刷新列表并打开目标会话
  // （切换前点击的其他项目会话 > 当前工作区最近会话 > 新建）。
  useEffect(() => {
    const bridge = requireBridge();
    let disposed = false;
    const begin = async (state: HostStateDto): Promise<void> => {
      setHost(state);
      if (state.status !== 'ready') {
        hostStatusSeenRef.current = state.status;
        return;
      }
      // 引擎（重）启动后预设名单重读（用户根目录的新预设即时可见）。
      void refreshPresets();
      const workspaceChanged = workspaceSeenRef.current !== state.workspace;
      // 引擎重启（如 MCP 应用变更）：workspace 未变但 agent 已随停机销毁，
      // 与项目切换同一条复位路径。
      const engineRestarted = hostStatusSeenRef.current !== 'ready';
      hostStatusSeenRef.current = 'ready';
      workspaceSeenRef.current = state.workspace;
      if (workspaceChanged || engineRestarted) {
        // 旧组合的 agent 已随停机销毁，状态与交互请求一并清空。
        setStates({});
        setActiveId(null);
        setPendingApproval(null);
        setPendingQuestion(null);
        setSubagents({});
      }
      if (!workspaceChanged && !engineRestarted && activeIdRef.current !== null) return;
      try {
        const list = await bridge.session.list();
        if (disposed) return;
        setSessions(list);
        const pending = pendingOpenRef.current;
        pendingOpenRef.current = null;
        const target =
          pending !== null ? list.find((item) => item.id === pending) : undefined;
        if (target !== undefined) {
          await openSession(target.id);
          return;
        }
        // ＋菜单「在项目中新建会话」：切换完成后在该项目里直接建新会话。
        if (pendingCreateRef.current) {
          pendingCreateRef.current = false;
          await createSession();
          return;
        }
        // 当前工作区最近活跃的会话（已归档的不再自动打开——归档语义即从
        // 日常视图隐去）；无则新建（cwd 缺失视为当前工作区）。
        const ws = state.workspace.toLowerCase();
        const archived = getArchivedSessions();
        const own = list.filter(
          (item) =>
            !archived.has(item.id) &&
            ((item.cwd ?? '').length === 0 || (item.cwd ?? '').toLowerCase() === ws),
        );
        if (own.length > 0) {
          const latest = [...own].sort(
            (a, b) => getSessionLastActive(b.id, b.createdAt) - getSessionLastActive(a.id, a.createdAt),
          )[0];
          if (latest !== undefined) await openSession(latest.id);
        } else {
          await createSession();
        }
      } catch (error) {
        console.error('初始化会话失败', error);
      }
    };
    void bridge.host.getStatus().then((state) => void begin(state));
    const unsubscribeStatus = bridge.host.onStatus((state) => void begin(state));
    return () => {
      disposed = true;
      unsubscribeStatus();
    };
    // 仅依赖挂载一次；begin 内经由 bridge 返回值/闭包取数据，规避旧闭包。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 订阅统一事件信封：会话事件更新对应状态桶；交互请求按活动会话弹出。
  useEffect(() => {
    const bridge = requireBridge();
    return bridge.session.onEvent((envelope: HarnessEventDto) => {
      if (envelope.kind === 'session-event') {
        touchSessionActivity(envelope.sessionId);
        // 列表外的未知会话开始产生事件（自动化任务后台建会话等）→ 刷新侧栏。
        if (!sessionsRef.current.some((session) => session.id === envelope.sessionId)) {
          void refreshSessions();
        }
        setStates((previous) => {
          const current = previous[envelope.sessionId] ?? initialSessionState();
          const next = foldEvent(current, envelope.event);
          if (next === current) return previous;
          return { ...previous, [envelope.sessionId]: next };
        });
        return;
      }
      if (envelope.kind === 'subagent-start' || envelope.kind === 'subagent-end') {
        const run = envelope.run;
        touchSessionActivity(run.childSessionId);
        setSubagents((previous) => ({ ...previous, [run.childSessionId]: run }));
        return;
      }
      if (envelope.kind === 'approval-requested') {
        if (envelope.sessionId === activeIdRef.current) {
          setPendingApproval({ id: envelope.id, toolName: envelope.toolName, reason: envelope.reason });
        }
        return;
      }
      if (envelope.kind === 'approval-resolved') {
        setPendingApproval((current) => (current?.id === envelope.id ? null : current));
        return;
      }
      if (envelope.kind === 'question-requested') {
        if (envelope.sessionId === activeIdRef.current) {
          setPendingQuestion({ id: envelope.id, questions: envelope.questions });
        }
        return;
      }
      if (envelope.kind === 'question-resolved') {
        setPendingQuestion((current) => (current?.id === envelope.id ? null : current));
      }
    });
  }, []);

  const handleApproval = useCallback(async (id: string, outcome: 'allowed-once' | 'rejected') => {
    await requireBridge().interaction.respondApproval(id, outcome);
  }, []);

  /* ── 自动归档：定时扫描超过保留期的非活动会话，从侧栏隐藏（数据不删除）。
   * 活跃时间 = 本地记录（打开/收到事件）与 createdAt 取大；运行中与当前会话豁免。
   * 归档过滤在 SessionSidebar 内部完成（含恢复入口），这里只负责扫描归档。 */
  useEffect(() => {
    if (!settings.autoArchive) return;
    const scan = (): void => {
      const cutoff = Date.now() - settings.archiveRetentionDays * 24 * 60 * 60 * 1000;
      const candidates = sessions
        .filter(
          (session) =>
            session.id !== activeIdRef.current &&
            !(states[session.id]?.running ?? false) &&
            getSessionLastActive(session.id, session.createdAt) < cutoff,
        )
        .map((session) => session.id);
      archiveSessions(candidates);
    };
    scan();
    const timer = window.setInterval(scan, ARCHIVE_SCAN_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [settings.autoArchive, settings.archiveRetentionDays, sessions, states]);

  const handleQuestion = useCallback(
    async (id: string, answers: { id: string; selected: string[]; custom?: string }[]) => {
      await requireBridge().interaction.respondQuestion(id, answers);
    },
    [],
  );

  const handleSend = useCallback(
    async (text: string, mode: 'queue' | 'steer', attachments: PromptAttachmentDto[]) => {
      const id = activeIdRef.current;
      if (id === null) return;
      await requireBridge().session.prompt(id, text, {
        mode,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    },
    [],
  );

  const handleStop = useCallback(async () => {
    const id = activeIdRef.current;
    if (id === null) return;
    await requireBridge().session.cancel(id);
  }, []);

  /**
   * 选择 Agent 预设：空白会话 → 切换当前会话（recompose + 事件记录）；
   * 已开始的会话 → 设为之后新会话的默认（历史已在该预设的工具面下产出，
   * 切换会抽出模型已调用的工具——harness 的仅空白可切锁）。
   */
  const handleSelectPreset = useCallback(
    async (presetId: string) => {
      const bridge = requireBridge();
      const id = activeIdRef.current;
      const state = id !== null ? states[id] : undefined;
      const blank =
        id !== null && (state?.messages.length ?? 0) === 0 && !(state?.running ?? false);
      try {
        if (id !== null && blank) {
          await bridge.presets.select(id, presetId);
          showNotice({ kind: 'ok', text: '已切换当前会话的 Agent 预设' });
          return;
        }
        await bridge.presets.setDefault(presetId);
        setDefaultPreset(presetId);
        showNotice({ kind: 'ok', text: '当前会话预设已锁定；已设为之后新会话的默认' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('锁定')) {
          // 空白判定与主进程竞态（回合恰在点击间隙开启）：降级为设默认。
          try {
            await bridge.presets.setDefault(presetId);
            setDefaultPreset(presetId);
            showNotice({ kind: 'ok', text: '已设为之后新会话的默认预设' });
          } catch (fallbackError) {
            showNotice({
              kind: 'error',
              text: `设置默认预设失败：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
            });
          }
          return;
        }
        showNotice({ kind: 'error', text: `切换预设失败：${message}` });
      }
    },
    [states, showNotice],
  );

  /** 派生会话（fork）：以父会话已完成回合为种子创建新会话并切换过去。 */
  const handleFork = useCallback(
    async (sessionId: string) => {
      const bridge = requireBridge();
      try {
        const { sessionId: forkedId } = await bridge.session.fork(sessionId);
        await refreshSessions();
        // 历史按磁盘上的种子回放（截到最近一个已完成回合），不复制前端状态。
        await openSession(forkedId);
        showNotice({ kind: 'ok', text: '已派生新会话（继承到最近一个已完成回合）' });
      } catch (error) {
        showNotice({
          kind: 'error',
          text: `派生会话失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [openSession, refreshSessions, showNotice],
  );

  /** 导出会话为 Markdown：状态缺失（未加载过）先拉历史回放。 */
  const handleExport = useCallback(
    async (sessionId: string) => {
      const bridge = requireBridge();
      try {
        let state = states[sessionId];
        if (state === undefined) {
          const events = await bridge.session.history(sessionId);
          state = foldEvents(initialSessionState(), events);
          setStates((previous) => ({ ...previous, [sessionId]: state }));
        }
        const result = await bridge.app.exportText(
          exportFileName(state, sessionId),
          buildSessionMarkdown(state, sessionId),
        );
        if (result.saved) showNotice({ kind: 'ok', text: `已导出：${result.path}` });
      } catch (error) {
        showNotice({
          kind: 'error',
          text: `导出失败：${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    [states, showNotice],
  );

  const activeState = activeId !== null ? states[activeId] : undefined;
  const activeSummary = activeId !== null ? sessions.find((item) => item.id === activeId) : undefined;
  const hostReady = host?.status === 'ready';
  /** 活动会话的预设：事件流（含 priming）> 会话头 > roster 默认。 */
  const activePresetId =
    activeState?.agentPreset ?? activeSummary?.agentPreset ?? (defaultPreset.length > 0 ? defaultPreset : undefined);
  /** 任一会话收到过 Agent 回复（侧栏引导第 3 步）。 */
  const hasReply = useMemo(
    () => Object.values(states).some((state) => state.messages.some((m) => m.role === 'assistant')),
    [states],
  );
  /** 活动会话的子代理运行（卡片挂在对话流尾部，transcript 读 states[childId]）。 */
  const activeSubagents = useMemo(
    () =>
      activeId === null
        ? []
        : Object.values(subagents).filter((run) => run.parentSessionId === activeId),
    [subagents, activeId],
  );

  return (
    <div className="workspace">
      <SessionSidebar
        sessions={sessions}
        titles={{
          // 冷启动批量标题打底，已加载会话的事件流折叠值覆盖（live 真值）。
          ...sessionTitles,
          ...Object.fromEntries(
            Object.entries(states)
              .filter(([, state]) => state.title.length > 0)
              .map(([id, state]) => [id, state.title]),
          ),
        }}
        localNames={localNames}
        activeId={activeId}
        workspace={host?.workspace ?? ''}
        hasReply={hasReply}
        onSelect={(id) => void openSession(id)}
        onCreate={() => void createSession()}
        onRename={(id, name) => setSessionName(id, name)}
        onExport={(id) => void handleExport(id)}
        onFork={(id) => void handleFork(id)}
        onSwitchProject={(cwd) => void switchProject(cwd)}
        onOpenSettings={onOpenSettings}
      />
      <div className="workspace__main">
        {hostReady ? (
          <>
            {settings.showTodos && <TodoPanel todos={activeState?.todos ?? []} />}
            {notice !== null && <div className={`notice notice--${notice.kind}`}>{notice.text}</div>}
            <ChatView
              state={activeState ?? initialSessionState()}
              hostReady={hostReady}
              showThinking={settings.showThinking}
              subagents={activeSubagents}
              childStates={states}
              workspaceName={baseName(host?.workspace ?? '')}
              onPickSuggestion={(prompt) =>
                setInjectedDraft((previous) => ({ text: prompt, token: previous.token + 1 }))
              }
            />
            {pendingApproval !== null && (
              <ApprovalCard approval={pendingApproval} onRespond={(id, outcome) => void handleApproval(id, outcome)} />
            )}
            {pendingQuestion !== null && (
              <QuestionCard question={pendingQuestion} onRespond={(id, answers) => void handleQuestion(id, answers)} />
            )}
            <Composer
              disabled={!hostReady || activeId === null}
              running={activeState?.running ?? false}
              runningBehavior={settings.interactionBehavior}
              agentMode={settings.agentMode}
              onAgentModeChange={(mode) => updateAppSettings({ agentMode: mode })}
              contextTokens={activeState?.contextTokens ?? null}
              lastOutputTokens={activeState?.lastOutputTokens ?? null}
              totalOutputTokens={activeState?.totalOutputTokens ?? 0}
              presets={presets}
              activePresetId={activePresetId}
              defaultPresetId={defaultPreset.length > 0 ? defaultPreset : undefined}
              presetLocked={
                (activeState?.messages.length ?? 0) > 0 || (activeState?.running ?? false)
              }
              onSelectPreset={(presetId) => void handleSelectPreset(presetId)}
              onOpenSettings={onOpenSettings}
              onSend={handleSend}
              onStop={handleStop}
              injectedDraft={injectedDraft}
              onNewSession={() => void createSession()}
              onNewSessionIn={createSessionIn}
              projects={settings.projects}
              workspace={host?.workspace ?? ''}
              onExportSession={() => {
                if (activeId !== null) void handleExport(activeId);
              }}
              onForkSession={() => {
                if (activeId !== null) void handleFork(activeId);
              }}
              onArchiveSession={() => {
                if (activeId === null) return;
                const archivedId = activeId;
                archiveSessions([archivedId]);
                showNotice({ kind: 'ok', text: '已归档当前会话（侧栏「已归档」中可恢复）' });
                // 归档的是当前会话：立即切到新的空白会话，避免主区继续
                // 显示已归档对话（Codex 同款语义）。
                if (activeIdRef.current === archivedId) void createSession();
              }}
            />
          </>
        ) : (
          <Splash host={host} />
        )}
      </div>
    </div>
  );
}

/** 取路径最后一段做展示名；空串原样返回。 */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] ?? '') : '';
}
