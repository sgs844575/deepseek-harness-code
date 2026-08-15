import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SessionSummaryDto } from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';
import { useAppSettings } from '../state/appSettings';
import { useProviders } from '../state/providers';
import {
  archiveSessions,
  unarchiveSessions,
  useArchivedSessions,
} from '../state/archivedSessions';
import { getSessionLastActive } from '../state/sessionActivity';
import type { SettingsSectionId } from './SettingsView';

export interface SessionSidebarProps {
  /** 全量会话（含已归档；归档过滤在本组件内部完成）。 */
  sessions: SessionSummaryDto[];
  /** 事件流标题（session/title 折叠值）。 */
  titles: Record<string, string>;
  /** 本地别名（用户重命名），优先级高于 titles。 */
  localNames: Record<string, string>;
  activeId: string | null;
  /** 当前工作区（host.workspace）；空串 = 宿主尚未就绪。 */
  workspace: string;
  /** 任一会话收到过 Agent 回复（引导第 3 步）。 */
  hasReply: boolean;
  onSelect(sessionId: string): void;
  onCreate(): void;
  onRename(sessionId: string, name: string): void;
  onExport(sessionId: string): void;
  /** 派生会话（fork）：以该会话已完成回合为种子创建新会话。 */
  onFork(sessionId: string): void;
  /** 切换项目（工作区）：harness 停机重启到新 cwd。 */
  onSwitchProject(cwd: string): void;
  /** 打开设置页；可指定定位分区（账户菜单「API Key」→ 模型与凭据）。 */
  onOpenSettings(section?: SettingsSectionId): void;
}

/** 项目区行数据：注册项目与按 cwd 分组的会话合并而来。 */
interface ProjectRow {
  /** 分组键（会话 cwd 原样；注册项目为注册路径）。 */
  path: string;
  name: string;
  sessions: SessionSummaryDto[];
  current: boolean;
}

/**
 * 会话侧栏（Codex 式）：顶部工作区标题（▾ 展开路径/版本信息）+ 搜索/通知按钮；
 * 主导航「新对话 / 已归档」；会话按项目（cwd）分组——当前工作区默认展开、
 * 其他项目折叠；「最近」平铺其他项目会话；底部为「开始使用」引导卡片与
 * 用户栏（点击弹出账户菜单：API Key 状态 / 显示待办开关 / 设置 / 退出应用）。
 * 会话标题优先级：本地别名 > session/title > id 前缀。
 */
export function SessionSidebar({
  sessions,
  titles,
  localNames,
  activeId,
  workspace,
  hasReply,
  onSelect,
  onCreate,
  onRename,
  onExport,
  onFork,
  onSwitchProject,
  onOpenSettings,
}: SessionSidebarProps) {
  const [view, setView] = useState<'chats' | 'archive'>('chats');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  /** 信息浮层：非空 = 打开，携带触发按钮锚点坐标（Portal 到 body 做 fixed 定位）。 */
  const [about, setAbout] = useState<
    { top: number; bottom?: undefined; left: number; width: number } | { top?: undefined; bottom: number; left: number; width: number } | null
  >(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [openProjects, setOpenProjects] = useState<ReadonlySet<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [version, setVersion] = useState('');
  /** 引导已完成过（持久化）：之后启动不再显示卡片，本进程内只保留告别动画。 */
  const [onboardDismissed, setOnboardDismissed] = useState(loadOnboardDismissed);
  /** 告别动画窗口：首次达成 3/3 后短暂展示「已完成」再淡出。 */
  const [onboardFarewell, setOnboardFarewell] = useState(false);
  const [onboardPhase, setOnboardPhase] = useState<'active' | 'done' | 'fading'>('active');
  /** 账户菜单（用户栏点击展开，向上弹出）。 */
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  /** 创建项目弹窗（项目区 + 按钮）。 */
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const celebratedRef = useRef(false);
  const onboardRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const archived = useArchivedSessions();
  const { settings, update } = useAppSettings();
  const { snapshot: providerSnapshot } = useProviders();
  /** 启用中的自动化任务数（导航徽标；0 不显示）。 */
  const enabledAutomations = settings.automations.filter((item) => item.enabled).length;

  useEffect(() => {
    void requireBridge().app.getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  /* 密钥就绪 = 激活供应商已配置启用密钥（本地服务视为就绪）。
   * providers:changed 推送即时同步，引导清单与账户菜单无需轮询。 */
  const apiKeyOk = useMemo(() => {
    const active = providerSnapshot.providers.find(
      (provider) => provider.id === providerSnapshot.activeProviderId,
    );
    return active !== undefined && (active.authOptional || active.keyConfigured);
  }, [providerSnapshot]);

  // 当前工作区默认展开。
  useEffect(() => {
    if (workspace.length === 0) return;
    setOpenProjects((previous) =>
      previous.has(workspace) ? previous : new Set(previous).add(workspace),
    );
  }, [workspace]);

  const titleOf = useCallback(
    (session: SessionSummaryDto): string =>
      localNames[session.id] ?? titles[session.id] ?? session.id.slice(0, 18),
    [localNames, titles],
  );

  const sorted = useMemo(
    () =>
      [...sessions].sort(
        (a, b) => getSessionLastActive(b.id, b.createdAt) - getSessionLastActive(a.id, a.createdAt),
      ),
    [sessions],
  );
  const activeList = useMemo(
    () => sorted.filter((session) => !archived.has(session.id)),
    [sorted, archived],
  );
  const archivedList = useMemo(
    () => sorted.filter((session) => archived.has(session.id)),
    [sorted, archived],
  );

  /* 项目区：会话按 cwd 分组，再与注册项目（app-settings.projects）合并。
   * 当前工作区恒为首行；注册项目（无会话也显示）次之；仅剩会话的遗留分组最后。 */
  const currentKey = workspace.length > 0 ? workspace : '';
  const projectRows = useMemo(() => {
    const groups = new Map<string, { key: string; sessions: SessionSummaryDto[] }>();
    const addTo = (key: string, session: SessionSummaryDto): void => {
      const entry = groups.get(key.toLowerCase());
      if (entry === undefined) groups.set(key.toLowerCase(), { key, sessions: [session] });
      else entry.sessions.push(session);
    };
    for (const session of activeList) {
      const cwd = session.cwd ?? '';
      const belongsToCurrent =
        currentKey.length > 0 && (cwd.length === 0 || cwd.toLowerCase() === currentKey.toLowerCase());
      if (belongsToCurrent) addTo(currentKey, session);
      else addTo(cwd, session);
    }
    const rows: ProjectRow[] = [];
    if (currentKey.length > 0) {
      const own = groups.get(currentKey.toLowerCase());
      const registered = settings.projects.find(
        (project) => project.path.toLowerCase() === currentKey.toLowerCase(),
      );
      rows.push({
        path: own?.key ?? currentKey,
        name: registered?.name ?? baseName(currentKey),
        sessions: own?.sessions ?? [],
        current: true,
      });
    }
    const seen = new Set(rows.map((row) => row.path.toLowerCase()));
    for (const project of settings.projects) {
      if (seen.has(project.path.toLowerCase())) continue;
      const group = groups.get(project.path.toLowerCase());
      rows.push({
        path: group?.key ?? project.path,
        name: project.name,
        sessions: group?.sessions ?? [],
        current: false,
      });
      seen.add(project.path.toLowerCase());
    }
    for (const group of groups.values()) {
      if (seen.has(group.key.toLowerCase())) continue;
      rows.push({ path: group.key, name: baseName(group.key), sessions: group.sessions, current: false });
    }
    return rows;
  }, [activeList, currentKey, settings.projects]);

  /** 「最近」：其他项目（其他 cwd）的会话平铺，供折叠项目快捷访问。 */
  const recentSessions = useMemo(
    () =>
      activeList.filter((session) => {
        const cwd = session.cwd ?? '';
        return cwd.length > 0 && cwd.toLowerCase() !== currentKey.toLowerCase();
      }),
    [activeList, currentKey],
  );

  const searching = view === 'chats' && searchOpen && query.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!searching) return [];
    const keyword = query.trim().toLowerCase();
    return activeList.filter((session) => titleOf(session).toLowerCase().includes(keyword));
  }, [searching, query, activeList, titleOf]);

  const onboardSteps = useMemo(
    () => [
      {
        key: 'apikey',
        done: apiKeyOk,
        label: '配置 API Key',
        hint: '设置 → 模型与凭据',
        run: (): void => {
          setOnboardOpen(false);
          onOpenSettings();
        },
      },
      {
        key: 'chat',
        done: activeList.length > 0,
        label: '发起首段对话',
        hint: '点击「新对话」',
        run: (): void => {
          setOnboardOpen(false);
          onCreate();
        },
      },
      {
        key: 'reply',
        done: hasReply,
        label: '收到 Agent 回复',
        hint: '发送任务后等待完成',
        run: undefined,
      },
    ],
    [apiKeyOk, activeList.length, hasReply, onOpenSettings, onCreate],
  );
  const onboardDone = onboardSteps.filter((step) => step.done).length;

  /* 引导达成检测：首次 3/3 时持久化完成标记（此后启动不再显示），
   * 并开启告别动画窗口；完成度回落时立即收起。celebratedRef 防止重复庆祝。 */
  useEffect(() => {
    if (onboardDone < onboardSteps.length) {
      setOnboardFarewell(false);
      return;
    }
    if (celebratedRef.current || onboardDismissed) return;
    celebratedRef.current = true;
    persistOnboardDismissed();
    setOnboardDismissed(true);
    setOnboardFarewell(true);
    setOnboardPhase('done');
  }, [onboardDone, onboardSteps.length, onboardDismissed]);

  /* 告别动画时间线：1.5s 收起清单 → 3s 开始淡出 → 3.35s 卸载卡片。 */
  useEffect(() => {
    if (!onboardFarewell) return;
    const timers = [
      window.setTimeout(() => setOnboardOpen(false), 1500),
      window.setTimeout(() => setOnboardPhase('fading'), 3000),
      window.setTimeout(() => setOnboardFarewell(false), 3350),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [onboardFarewell]);

  /* 引导清单打开时点击外部自动收起。 */
  useEffect(() => {
    if (!onboardOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (onboardRef.current?.contains(event.target as Node) !== true) setOnboardOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onboardOpen]);

  /* 账户菜单：点击外部 / Esc 收起。 */
  useEffect(() => {
    if (!userMenuOpen) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (userMenuRef.current?.contains(event.target as Node) !== true) setUserMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setUserMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [userMenuOpen]);

  const closeSearch = (): void => {
    setSearchOpen(false);
    setQuery('');
  };

  /** 打开信息浮层：以触发按钮为锚点（Portal 到 body 后 fixed 定位）。 */
  const openAbout = (anchor: HTMLElement, placement: 'down' | 'up'): void => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(Math.round(rect.width), 230);
    setAbout(
      placement === 'down'
        ? { top: Math.round(rect.bottom) + 6, left: Math.round(rect.left), width }
        : {
            bottom: Math.round(window.innerHeight - rect.top) + 6,
            left: Math.round(rect.left),
            width,
          },
    );
  };

  const toggleProject = (key: string): void => {
    setOpenProjects((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** 创建项目：注册到 app-settings（同路径覆盖改名）并切换过去。 */
  const handleCreateProject = (path: string, name: string): void => {
    setProjectModalOpen(false);
    const key = path.toLowerCase();
    const next = settings.projects.filter((project) => project.path.toLowerCase() !== key);
    next.push({ path, name });
    update({ projects: next });
    onSwitchProject(path);
  };

  const renderSession = (session: SessionSummaryDto): ReactNode => (
    <SessionRow
      key={session.id}
      session={session}
      title={titleOf(session)}
      isActive={session.id === activeId}
      isEditing={session.id === editingId}
      onSelect={() => onSelect(session.id)}
      onStartEdit={() => setEditingId(session.id)}
      onCommitEdit={(name) => {
        setEditingId(null);
        onRename(session.id, name);
      }}
      onCancelEdit={() => setEditingId(null)}
      onExport={() => onExport(session.id)}
      onFork={() => onFork(session.id)}
      onArchive={() => archiveSessions([session.id])}
    />
  );

  const renderProject = (row: ProjectRow): ReactNode => {
    const open = openProjects.has(row.path);
    return (
      <div key={row.path} className="sb-project-wrap">
        <div className={`sb-project${row.current ? ' sb-project--current' : ''}`}>
          <button
            type="button"
            className="sb-project__chev"
            aria-expanded={open}
            title={open ? '折叠' : '展开'}
            onClick={() => toggleProject(row.path)}
          >
            <ChevronIcon />
          </button>
          <button
            type="button"
            className="sb-project__main"
            title={row.current ? row.path : `${row.path}\n点击切换到此项目`}
            onClick={() => (row.current ? toggleProject(row.path) : onSwitchProject(row.path))}
          >
            <FolderIcon />
            <span className="sb-project__name">{row.name}</span>
            {row.sessions.length > 0 && (
              <span className="sb-project__count">{row.sessions.length}</span>
            )}
          </button>
        </div>
        {open && <div className="sb-items">{row.sessions.map(renderSession)}</div>}
      </div>
    );
  };

  return (
    <aside className="sidebar">
      {/* 顶部：工作区标题（信息下拉）+ 搜索 / 通知 */}
      <div className="sb-head">
        <button
          type="button"
          className="sb-head__title"
          aria-expanded={about !== null}
          onClick={(event) => openAbout(event.currentTarget, 'down')}
          title={workspace.length > 0 ? workspace : '工作区'}
        >
          <span className="sb-head__name">{baseName(workspace) || '工作区'}</span>
          <ChevronIcon />
        </button>
        <button
          type="button"
          className={`sb-iconbtn${searchOpen ? ' sb-iconbtn--on' : ''}`}
          title={searchOpen ? '关闭搜索' : '搜索会话'}
          onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className={`sb-iconbtn${settings.notifications ? ' sb-iconbtn--on' : ''}`}
          title={settings.notifications ? '桌面通知已开启，点击关闭' : '桌面通知已关闭，点击开启'}
          onClick={() => update({ notifications: !settings.notifications })}
        >
          {settings.notifications ? <BellIcon /> : <BellOffIcon />}
        </button>
      </div>

      {searchOpen && view === 'chats' && (
        <div className="sb-search">
          <SearchIcon />
          <input
            ref={(node) => node?.focus()}
            value={query}
            placeholder="搜索会话…"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') closeSearch();
            }}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="sb-search__clear"
              title="清空"
              onClick={() => setQuery('')}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      )}

      {/* 主导航：新对话 / 已归档（Codex 式同行高单行按钮；新对话行尾内嵌 +） */}
      <nav className="sb-nav">
        <button type="button" className="sb-nav__item" title="新建会话" onClick={onCreate}>
          <NewChatIcon />
          <span className="sb-nav__label">新对话</span>
          <span className="sb-nav__trailing" aria-hidden>
            <PlusIcon />
          </span>
        </button>
        <button
          type="button"
          className={`sb-nav__item${view === 'archive' ? ' sb-nav__item--active' : ''}`}
          onClick={() => {
            setView((previous) => (previous === 'archive' ? 'chats' : 'archive'));
            closeSearch();
          }}
        >
          <ArchiveIcon />
          <span className="sb-nav__label">已归档</span>
          {archivedList.length > 0 && (
            <span className="sb-nav__count">{archivedList.length}</span>
          )}
        </button>
        <button
          type="button"
          className="sb-nav__item"
          title="定时任务：到点在当前工作区自动执行"
          onClick={() => onOpenSettings('automation')}
        >
          <ClockIcon />
          <span className="sb-nav__label">自动化</span>
          {enabledAutomations > 0 && (
            <span className="sb-nav__count">{enabledAutomations}</span>
          )}
        </button>
      </nav>

      {/* 列表主体：归档视图 / 搜索结果 / 项目分组 + 最近 */}
      <div className="sb-body">
        {view === 'archive' ? (
          <div className="sb-section">
            <div className="sb-section-title">已归档会话</div>
            {archivedList.length === 0 ? (
              <div className="sb-empty">暂无已归档会话（自动归档可在设置中开启）</div>
            ) : (
              archivedList.map((session) => (
                <ArchivedRow
                  key={session.id}
                  session={session}
                  title={titleOf(session)}
                  onSelect={() => onSelect(session.id)}
                  onRestore={() => unarchiveSessions([session.id])}
                />
              ))
            )}
          </div>
        ) : searching ? (
          <div className="sb-section">
            <div className="sb-section-title">搜索结果</div>
            {searchResults.length === 0 ? (
              <div className="sb-empty">无匹配会话</div>
            ) : (
              searchResults.map(renderSession)
            )}
          </div>
        ) : (
          <>
            <div className="sb-section">
              <div className="sb-section-head">
                <span className="sb-section-title sb-section-title--grow">项目</span>
                <button
                  type="button"
                  className="sb-section-add"
                  title="添加项目（选择文件夹）"
                  onClick={() => setProjectModalOpen(true)}
                >
                  <PlusIcon />
                </button>
              </div>
              {projectRows.length === 0
                ? <div className="sb-empty">无聊天</div>
                : projectRows.map(renderProject)}
            </div>
            <div className="sb-section">
              <div className="sb-section-title">最近</div>
              {recentSessions.length === 0 ? (
                <div className="sb-empty">无聊天</div>
              ) : (
                <div className="sb-items sb-items--flat">{recentSessions.map(renderSession)}</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 引导卡片：完成前展示；首次 3/3 播放「已完成 → 淡出」告别动画，此后启动不再显示 */}
      {(!onboardDismissed || onboardFarewell) && (
        <div className="sb-onboard" ref={onboardRef}>
          {onboardOpen && !onboardFarewell && (
            <div className="sb-onboard__pop">
              {onboardSteps.map((step) => (
                <button
                  type="button"
                  key={step.key}
                  className={`sb-onboard__step${step.done ? ' sb-onboard__step--done' : ''}`}
                  disabled={step.done || step.run === undefined}
                  title={step.run === undefined && !step.done ? '此步骤无需操作，等待 Agent 回复即可' : undefined}
                  onClick={step.run}
                >
                  {step.done ? <CheckIcon /> : <span className="sb-onboard__dot" />}
                  <span className="sb-onboard__step-label">{step.label}</span>
                  <span className="sb-onboard__step-hint">{step.hint}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className={`sb-onboard__card${onboardPhase === 'done' || onboardPhase === 'fading' ? ' sb-onboard__card--done' : ''}${onboardPhase === 'fading' ? ' sb-onboard__card--fading' : ''}`}
            aria-expanded={onboardOpen && !onboardFarewell}
            disabled={onboardFarewell}
            onClick={() => setOnboardOpen((previous) => !previous)}
          >
            <ProgressRing done={onboardDone} total={onboardSteps.length} />
            <span className="sb-onboard__label">
              {onboardPhase === 'done' || onboardPhase === 'fading' ? '已完成' : '开始使用'}
            </span>
            <span className="sb-onboard__count">
              {onboardDone}/{onboardSteps.length}
            </span>
          </button>
        </div>
      )}

      {/* 用户栏：点击弹出账户菜单；? 打开信息面板 */}
      <div className="sb-user" ref={userMenuRef}>
        {userMenuOpen && (
          <div className="sb-menu">
            <div className="sb-menu__account">
              <span className="sb-user__avatar">DS</span>
              <span className="sb-menu__account-text">
                <span className="sb-menu__name">DeepSeek 用户</span>
                <span className="sb-menu__sub">
                  {version.length > 0 ? `v${version} · 本地工作区` : '本地工作区'}
                </span>
              </span>
            </div>
            <div className="sb-menu__sep" />
            <button
              type="button"
              className="sb-menu__item"
              onClick={() => update({ showTodos: !settings.showTodos })}
            >
              <TodoIcon />
              <span className="sb-menu__label">显示待办</span>
              <input
                type="checkbox"
                role="switch"
                className="switch switch--sm"
                checked={settings.showTodos}
                readOnly
                tabIndex={-1}
                aria-label="显示待办"
              />
            </button>
            <button
              type="button"
              className="sb-menu__item"
              onClick={() => {
                setUserMenuOpen(false);
                onOpenSettings('model');
              }}
            >
              <KeyIcon />
              <span className="sb-menu__label">API Key</span>
              <span className={`sb-menu__value${apiKeyOk ? ' sb-menu__value--ok' : ''}`}>
                {apiKeyOk ? '已配置' : '未配置'}
              </span>
              <ChevronRightIcon />
            </button>
            <div className="sb-menu__sep" />
            <button
              type="button"
              className="sb-menu__item"
              onClick={() => {
                setUserMenuOpen(false);
                onOpenSettings();
              }}
            >
              <GearIcon />
              <span className="sb-menu__label">设置</span>
              <kbd className="sb-menu__kbd">Ctrl+,</kbd>
            </button>
            <button
              type="button"
              className="sb-menu__item sb-menu__item--danger"
              onClick={() => {
                setUserMenuOpen(false);
                void requireBridge().app.quit();
              }}
            >
              <LogoutIcon />
              <span className="sb-menu__label">退出应用</span>
            </button>
          </div>
        )}
        <button
          type="button"
          className="sb-user__main"
          title="账户菜单"
          aria-expanded={userMenuOpen}
          onClick={() => setUserMenuOpen((previous) => !previous)}
        >
          <span className="sb-user__avatar">DS</span>
          <span className="sb-user__name">DeepSeek 用户</span>
        </button>
        <button
          type="button"
          className="sb-iconbtn"
          title="关于与路径信息"
          onClick={(event) => openAbout(event.currentTarget, 'up')}
        >
          <HelpIcon />
        </button>
      </div>

      {/* 信息浮层（标题 ▾ / 用户栏 ? 共用）：工作区 / 版本 / 数据目录。
       * 整体 Portal 到 body：sidebar 的 backdrop-filter 既是 fixed 的包含块、
       * 又形成独立层叠上下文——遮罩（z:25）会盖住留在侧栏内的浮层，导致点击失效；
       * Portal 后遮罩与浮层（z:30）同处根上下文，浮层按锚点坐标 fixed 定位。 */}
      {about !== null &&
        createPortal(
          <>
            <div className="sb-pop__overlay" onClick={() => setAbout(null)} />
            <div
              className="sb-pop"
              style={{
                ...(about.top !== undefined ? { top: `${about.top}px` } : { bottom: `${about.bottom}px` }),
                left: `${Math.min(about.left, window.innerWidth - about.width - 8)}px`,
                width: `${about.width}px`,
              }}
            >
              <div className="sb-pop__row">
                <span className="sb-pop__key">版本</span>
                <span className="sb-pop__value">{version.length > 0 ? `v${version}` : '…'}</span>
              </div>
              <div className="sb-pop__row">
                <span className="sb-pop__key">工作区</span>
                <span className="sb-pop__value" title={workspace}>
                  {workspace.length > 0 ? workspace : '—'}
                </span>
              </div>
              <div className="sb-pop__row">
                <span className="sb-pop__key">数据目录</span>
                <span className="sb-pop__value" title={settings.dataPath}>
                  {settings.dataPath.length > 0 ? settings.dataPath : '默认（用户数据目录）'}
                </span>
              </div>
              <button
                type="button"
                className="sb-pop__action"
                onClick={() => {
                  setAbout(null);
                  onOpenSettings();
                }}
              >
                打开设置
              </button>
            </div>
          </>,
          document.body,
        )}
      {/* 创建项目弹窗（Portal 到 body：sidebar 的 backdrop-filter 会成为 fixed 的包含块） */}
      {projectModalOpen &&
        createPortal(
          <CreateProjectModal
            onClose={() => setProjectModalOpen(false)}
            onCreate={handleCreateProject}
          />,
          document.body,
        )}
    </aside>
  );
}

/* ──────────────────────────── 行组件 ──────────────────────────── */

/** 创建项目弹窗：项目名称 + 源文件夹（系统对话框选择），确认后注册并切换。 */
function CreateProjectModal({
  onClose,
  onCreate,
}: {
  onClose(): void;
  onCreate(path: string, name: string): void;
}) {
  const [name, setName] = useState('');
  const [folder, setFolder] = useState('');
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const pick = async (): Promise<void> => {
    setPicking(true);
    try {
      const result = await requireBridge().app.pickFolder();
      if (!result.canceled && result.path !== undefined) {
        setFolder(result.path);
        // 名称未填时用文件夹名预填（可改）。
        if (name.trim().length === 0) setName(baseName(result.path));
      }
    } catch (error) {
      console.error('选择文件夹失败', error);
    } finally {
      setPicking(false);
    }
  };

  const canCreate = folder.length > 0 && !picking;

  return (
    <div
      className="sb-modal__overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sb-modal" role="dialog" aria-label="创建项目">
        <div className="sb-modal__head">
          <span className="sb-modal__title">创建项目</span>
          <button type="button" className="sb-modal__close" title="关闭" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <div className="sb-modal__body">
          <div className="sb-modal__field">
            <label className="sb-modal__label">项目名称</label>
            <div className="sb-modal__input-wrap">
              <FolderIcon />
              <input
                value={name}
                placeholder="项目名称"
                spellCheck={false}
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>
          <div className="sb-modal__field">
            <label className="sb-modal__label">源文件夹</label>
            <button
              type="button"
              className="sb-modal__dropzone"
              disabled={picking}
              onClick={() => void pick()}
            >
              {folder.length > 0 ? (
                <>
                  <FolderIcon />
                  <span className="sb-modal__path" title={folder}>
                    {folder}
                  </span>
                </>
              ) : (
                <>
                  <FolderOpenIcon />
                  <span className="sb-modal__hint">
                    {picking ? '选择中…' : '选择 Agent 可读取和编辑的文件夹'}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
        <div className="sb-modal__foot">
          <button type="button" className="sb-modal__btn" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="sb-modal__btn sb-modal__btn--primary"
            disabled={!canCreate}
            onClick={() => onCreate(folder, name.trim().length > 0 ? name.trim() : baseName(folder))}
          >
            创建项目
          </button>
        </div>
      </div>
    </div>
  );
}

interface SessionRowProps {
  session: SessionSummaryDto;
  title: string;
  isActive: boolean;
  isEditing: boolean;
  onSelect(): void;
  onStartEdit(): void;
  onCommitEdit(name: string): void;
  onCancelEdit(): void;
  onExport(): void;
  onFork(): void;
  onArchive(): void;
}

/** 会话行：单行标题 + 右侧时间；悬停/选中时时间让位给 重命名/派生/导出/归档 操作。 */
function SessionRow({
  session,
  title,
  isActive,
  isEditing,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onExport,
  onFork,
  onArchive,
}: SessionRowProps) {
  if (isEditing) {
    return (
      <div className="sb-item sb-item--editing">
        <RenameInput initial={title} onCommit={onCommitEdit} onCancel={onCancelEdit} />
      </div>
    );
  }
  return (
    <div className={`sb-item${isActive ? ' sb-item--active' : ''}`}>
      <button
        type="button"
        className="sb-item__main"
        onClick={onSelect}
        onDoubleClick={onStartEdit}
        title={`${session.cwd ?? session.id}\n双击重命名`}
      >
        <span className="sb-item__title">{title}</span>
        <span className="sb-item__meta">{formatItemDate(getSessionLastActive(session.id, session.createdAt))}</span>
      </button>
      <div className="sb-item__actions">
        <button type="button" className="sb-item__action" title="重命名（本地别名）" onClick={onStartEdit}>
          <PencilIcon />
        </button>
        <button
          type="button"
          className="sb-item__action"
          title="派生会话（复制到最近一个已完成回合，从那里继续）"
          onClick={onFork}
        >
          <ForkIcon />
        </button>
        <button type="button" className="sb-item__action" title="导出为 Markdown" onClick={onExport}>
          <DownloadIcon />
        </button>
        <button type="button" className="sb-item__action" title="归档（从侧栏隐藏，可在已归档中恢复）" onClick={onArchive}>
          <ArchiveIcon />
        </button>
      </div>
    </div>
  );
}

/** 归档视图行：标题 + 时间 + 恢复操作。 */
function ArchivedRow({
  session,
  title,
  onSelect,
  onRestore,
}: {
  session: SessionSummaryDto;
  title: string;
  onSelect(): void;
  onRestore(): void;
}) {
  return (
    <div className="sb-item">
      <button
        type="button"
        className="sb-item__main"
        onClick={onSelect}
        title={`${session.cwd ?? session.id}（已归档，点击打开）`}
      >
        <span className="sb-item__title">{title}</span>
        <span className="sb-item__meta">{formatItemDate(getSessionLastActive(session.id, session.createdAt))}</span>
      </button>
      <div className="sb-item__actions sb-item__actions--visible">
        <button type="button" className="sb-item__action" title="恢复到侧栏" onClick={onRestore}>
          <RestoreIcon />
        </button>
      </div>
    </div>
  );
}

/** 行内重命名输入框：Enter 提交（空串 = 清除别名）、Esc 取消、失焦提交。 */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit(name: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="sb-rename"
      value={value}
      spellCheck={false}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(value);
        else if (event.key === 'Escape') onCancel();
      }}
      onBlur={() => onCommit(value)}
    />
  );
}

/** 引导进度环：细描边圆环，按完成步数填充。 */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const radius = 8;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        opacity="0.25"
      />
      <circle
        cx="10"
        cy="10"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - done / total)}
        transform="rotate(-90 10 10)"
        style={{ transition: 'stroke-dashoffset 0.3s ease' }}
      />
    </svg>
  );
}

/* ──────────────────────────── 工具 ──────────────────────────── */

/** 引导完成标记：完成过一次后跨启动不再显示「开始使用」卡片。 */
const ONBOARD_DISMISS_KEY = 'dshc.onboard-dismissed.v1';

function loadOnboardDismissed(): boolean {
  try {
    return localStorage.getItem(ONBOARD_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function persistOnboardDismissed(): void {
  try {
    localStorage.setItem(ONBOARD_DISMISS_KEY, '1');
  } catch {
    // 写入失败仅影响下次启动的展示，本进程内告别动画照常。
  }
}

/** 取路径最后一段做展示名；空串原样返回。 */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length > 0 ? (parts[parts.length - 1] ?? '') : '';
}

function formatItemDate(time: number): string {
  const date = new Date(time);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.getFullYear() === now.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/* ──────────────────────────── 图标（细线，与标题栏同语言） ──────────────────────────── */

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9.5l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M15.6 15.6L20.5 20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 10.5a6 6 0 1 1 12 0c0 3.8 1.4 5.2 2 6.2H4c.6-1 2-2.4 2-6.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.8 19.5a2.4 2.4 0 0 0 4.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function BellOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6 10.5a6 6 0 1 1 12 0c0 3.8 1.4 5.2 2 6.2H4c.6-1 2-2.4 2-6.2Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.8 19.5a2.4 2.4 0 0 0 4.4 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 4.5l15 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** 新对话（撰写）：方框 + 斜置笔，与「重命名」的裸笔图标区分。 */
function NewChatIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M19.5 11.2v6.3a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2h6.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8.7 15.3l9.6-9.6a1.85 1.85 0 0 1 2.6 2.6l-9.6 9.6-3.6 1 1-3.6Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3.5 7h17M4.5 7l1.3-3h12.4L19.5 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 7v11a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5V7" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M9.8 11.5h4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

/** 自动化：时钟。 */
function ClockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 7.5V12l3 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 弹窗源文件夹区的大号图标（打开的文件夹）。 */
function FolderOpenIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v1.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path
        d="M3.5 9.5v8.7a1.6 1.6 0 0 0 1.9 1.6l12.4-2.3a1.6 1.6 0 0 0 1.3-1.6v-4.4a1.6 1.6 0 0 0-1.9-1.6L6.7 9.7a1.6 1.6 0 0 1-1.2-.4L4 8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4.5 19.5l4-1L19.8 7.2a2 2 0 0 0-3-3L5.5 15.5l-1 4Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 派生会话：一分二的两条支线。 */
function ForkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="7" cy="5.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="17" cy="5.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="12" cy="18.5" r="2.2" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M7 7.7c0 4 1.5 6.3 4 8M17 7.7c0 4-1.5 6.3-4 8M7 7.7V11M17 7.7V11"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 4.5v9.5m0 0l-3.8-3.8M12 14l3.8-3.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 20v-4.5H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12 16.8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="7.5" cy="7.5" r="3.6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M10.1 10.1L20.5 20.5M15.6 15.6l2.4-2.4M18.8 18.8l2.4-2.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function TodoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3.5 6.5l1.8 1.8L8.5 5M3.5 16.5l1.8 1.8 3.2-3.3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.5 7H20M12.5 17.2H20" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13.5 4.5H7.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M10.5 12h9.5M16.8 8.8L20 12l-3.2 3.2"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9.5 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}
