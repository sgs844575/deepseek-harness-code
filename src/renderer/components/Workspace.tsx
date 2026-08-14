import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessEventDto, HostStateDto, SessionSummaryDto } from '../../shared/protocol.js';
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
import { archiveSessions } from '../state/archivedSessions';
import { getSessionLastActive, touchSessionActivity } from '../state/sessionActivity';

/**
 * 对话工作台：会话侧栏 + 任务面板 + 对话流 + 输入区。
 * 多会话状态按 id 分桶折叠；打开历史会话走同一条事件折叠路径（回放=实时）。
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
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const noticeTimer = useRef<number | null>(null);
  /** 已处理过的工作区（宿主就绪流按 workspace 变化识别项目切换）。 */
  const workspaceSeenRef = useRef('');
  /** 切换项目后待打开的会话 id（点了其他项目的会话时）。 */
  const pendingOpenRef = useRef<string | null>(null);
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
      const list = await requireBridge().session.list();
      setSessions(list);
    } catch (error) {
      console.error('读取会话列表失败', error);
    }
  }, []);

  const createSession = useCallback(async () => {
    const bridge = requireBridge();
    const { sessionId } = await bridge.session.create();
    setStates((previous) =>
      previous[sessionId] === undefined ? previous : previous,
    );
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
          setStates((previous) => ({ ...previous, [sessionId]: foldEvents(initialSessionState(), events) }));
        } catch (error) {
          console.error('读取会话历史失败', error);
          setStates((previous) => ({ ...previous, [sessionId]: initialSessionState() }));
        }
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
      console.error('切换项目失败', error);
      showNotice({
        kind: 'error',
        text: `切换项目失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }, [showNotice]);

  // 宿主就绪流：首次启动或项目切换后，刷新列表并打开目标会话
  // （切换前点击的其他项目会话 > 当前工作区最近会话 > 新建）。
  useEffect(() => {
    const bridge = requireBridge();
    let disposed = false;
    const begin = async (state: HostStateDto): Promise<void> => {
      setHost(state);
      if (state.status !== 'ready') return;
      const workspaceChanged = workspaceSeenRef.current !== state.workspace;
      workspaceSeenRef.current = state.workspace;
      if (workspaceChanged) {
        // 旧工作区的 agent 已随切换停机销毁，状态与交互请求一并清空。
        setStates({});
        setActiveId(null);
        setPendingApproval(null);
        setPendingQuestion(null);
      }
      if (!workspaceChanged && activeIdRef.current !== null) return;
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
        // 当前工作区最近活跃的会话；无则新建（cwd 缺失视为当前工作区）。
        const ws = state.workspace.toLowerCase();
        const own = list.filter(
          (item) => (item.cwd ?? '').length === 0 || (item.cwd ?? '').toLowerCase() === ws,
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
        setStates((previous) => {
          const current = previous[envelope.sessionId] ?? initialSessionState();
          const next = foldEvent(current, envelope.event);
          if (next === current) return previous;
          return { ...previous, [envelope.sessionId]: next };
        });
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

  const handleSend = useCallback(async (text: string, mode: 'queue' | 'steer') => {
    const id = activeIdRef.current;
    if (id === null) return;
    await requireBridge().session.prompt(id, text, { mode });
  }, []);

  const handleStop = useCallback(async () => {
    const id = activeIdRef.current;
    if (id === null) return;
    await requireBridge().session.cancel(id);
  }, []);

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
  const hostReady = host?.status === 'ready';
  /** 任一会话收到过 Agent 回复（侧栏引导第 3 步）。 */
  const hasReply = useMemo(
    () => Object.values(states).some((state) => state.messages.some((m) => m.role === 'assistant')),
    [states],
  );

  return (
    <div className="workspace">
      <SessionSidebar
        sessions={sessions}
        titles={Object.fromEntries(
          Object.entries(states)
            .filter(([, state]) => state.title.length > 0)
            .map(([id, state]) => [id, state.title]),
        )}
        localNames={localNames}
        activeId={activeId}
        workspace={host?.workspace ?? ''}
        hasReply={hasReply}
        onSelect={(id) => void openSession(id)}
        onCreate={() => void createSession()}
        onRename={(id, name) => setSessionName(id, name)}
        onExport={(id) => void handleExport(id)}
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
              onOpenSettings={onOpenSettings}
              onSend={handleSend}
              onStop={handleStop}
              onNewSession={() => void createSession()}
              onExportSession={() => {
                if (activeId !== null) void handleExport(activeId);
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
