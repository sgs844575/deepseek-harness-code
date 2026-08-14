import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type {
  AgentModeDto,
  InteractionBehaviorDto,
  PromptModeDto,
  ReasoningEffortDto,
} from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';
import { useProviders } from '../state/providers';

export interface ComposerProps {
  disabled: boolean;
  running: boolean;
  /** Agent 运行中发送输入的默认行为（设置“交互行为”）。 */
  runningBehavior: InteractionBehaviorDto;
  /** Agent 权限模式（默认询问 / 完全访问 / 计划模式）。 */
  agentMode: AgentModeDto;
  onAgentModeChange(mode: AgentModeDto): void;
  /** 打开设置（模型服务分区，模型菜单「管理模型」入口）。 */
  onOpenSettings(section?: 'model'): void;
  onSend(text: string, mode: PromptModeDto): void | Promise<void>;
  onStop(): void | Promise<void>;
  onNewSession(): void;
  onExportSession(): void;
}

const TEXTAREA_MAX_HEIGHT = 220;

/** 权限模式菜单项（完全对应 harness 原生能力）。 */
const MODE_OPTIONS: {
  value: AgentModeDto;
  label: string;
  description: string;
}[] = [
  { value: 'ask', label: '默认 · 询问', description: '变更类工具（写入 / 编辑 / 命令）执行前需要你确认。' },
  { value: 'full', label: '完全访问', description: '跳过全部审批，Agent 直接执行；仅在你信任任务时使用。' },
  { value: 'plan', label: '计划模式', description: '只调研与制定计划，修改类工具被拒绝；完成后经确认退出计划。' },
];

/** 思考强度（harness 原生 reasoningEffort 档位）。 */
const EFFORT_OPTIONS: { value: ReasoningEffortDto; label: string }[] = [
  { value: 'off', label: '思考 · 关闭' },
  { value: 'high', label: '思考 · 高' },
  { value: 'max', label: '思考 · 最大' },
];

type MenuId = 'plus' | 'mode' | 'model' | 'effort';

/**
 * 输入区（Cherry / ZCode 风格）：上方多行输入，下方工具栏——左侧「+」
 * 更多操作、权限模式、模型选择、思考强度四组胶囊菜单，右侧停止 / 发送。
 * Enter 发送（Shift+Enter 换行）；运行中发送的行为由设置“交互行为”决定。
 */
export function Composer({
  disabled,
  running,
  runningBehavior,
  agentMode,
  onAgentModeChange,
  onOpenSettings,
  onSend,
  onStop,
  onNewSession,
  onExportSession,
}: ComposerProps) {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState<MenuId | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { snapshot } = useProviders();
  const [defaultModel, setDefaultModel] = useState('');

  // 默认模型跟随（激活供应商 / 目录变化时刷新）。
  useEffect(() => {
    void requireBridge()
      .settings.getDefaultModel()
      .then((selection) => setDefaultModel(selection.model))
      .catch(() => undefined);
  }, [snapshot]);

  // 输入内容变化时自动增高（1 行起，封顶 TEXTAREA_MAX_HEIGHT）。
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [text]);

  // 任一菜单打开时：点击外部或 Esc 关闭。
  useEffect(() => {
    if (menu === null) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setMenu(null);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  const submit = useCallback(() => {
    const value = text.trim();
    if (value.length === 0 || disabled) return;
    setText('');
    const mode: PromptModeDto = running ? runningBehavior : 'queue';
    void onSend(value, mode);
    textareaRef.current?.focus();
  }, [text, disabled, running, runningBehavior, onSend]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const canSend = !disabled && text.trim().length > 0;
  const activeProvider = snapshot.providers.find(
    (provider) => provider.id === snapshot.activeProviderId,
  );
  const modeOption = MODE_OPTIONS.find((option) => option.value === agentMode) ?? MODE_OPTIONS[0];
  const effortLabel =
    EFFORT_OPTIONS.find((option) => option.value === snapshot.prefs.reasoningEffort)?.label ?? '';

  const selectModel = useCallback(async (providerId: string, modelId: string) => {
    setMenu(null);
    try {
      await requireBridge().providers.selectModel(providerId, modelId);
      setDefaultModel(modelId);
    } catch (error) {
      console.error('切换模型失败', error);
    }
  }, []);

  const changeEffort = useCallback((effort: ReasoningEffortDto) => {
    setMenu(null);
    void requireBridge()
      .providers.updatePrefs({ reasoningEffort: effort })
      .catch((error) => console.error('保存思考强度失败', error));
  }, []);

  return (
    <div className="composer" ref={rootRef}>
      <div className={`composer__card${disabled ? ' composer__card--disabled' : ''}`}>
        <textarea
          ref={textareaRef}
          className="composer__textarea"
          value={text}
          placeholder={
            disabled
              ? '等待 harness 就绪…'
              : running
                ? runningBehavior === 'steer'
                  ? '运行中——输入内容将插话（steer）'
                  : '运行中——输入内容将加入队列'
                : '描述任务，Enter 发送'
          }
          disabled={disabled}
          rows={1}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="composer__toolbar">
          <div className="composer__left">
            {/* ＋ 更多操作 */}
            <div className="composer__pillwrap">
              <button
                type="button"
                className={`composer__pill${menu === 'plus' ? ' composer__pill--open' : ''}`}
                title="更多操作"
                disabled={disabled}
                aria-expanded={menu === 'plus'}
                onClick={() => setMenu((current) => (current === 'plus' ? null : 'plus'))}
              >
                <PlusIcon />
              </button>
              {menu === 'plus' && (
                <div className="composer__pop" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="composer__pop-item"
                    onClick={() => {
                      setMenu(null);
                      onNewSession();
                    }}
                  >
                    <span className="composer__pop-item-icon"><PlusIcon /></span>
                    <span className="composer__pop-item-title">新会话</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="composer__pop-item"
                    disabled={disabled}
                    onClick={() => {
                      setMenu(null);
                      onExportSession();
                    }}
                  >
                    <span className="composer__pop-item-icon"><ExportIcon /></span>
                    <span className="composer__pop-item-title">导出当前会话为 Markdown</span>
                  </button>
                </div>
              )}
            </div>

            {/* 权限模式 */}
            <div className="composer__pillwrap">
              <button
                type="button"
                className={`composer__pill${menu === 'mode' ? ' composer__pill--open' : ''}${
                  agentMode !== 'ask' ? ' composer__pill--accent' : ''
                }`}
                title="Agent 权限模式"
                aria-expanded={menu === 'mode'}
                onClick={() => setMenu((current) => (current === 'mode' ? null : 'mode'))}
              >
                <ModeIcon mode={agentMode} />
                <span className="composer__pill-label">{modeOption.label}</span>
                <ChevronDownIcon />
              </button>
              {menu === 'mode' && (
                <div className="composer__pop" role="menu">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={option.value}
                      className={`composer__pop-item${option.value === agentMode ? ' composer__pop-item--active' : ''}`}
                      onClick={() => {
                        setMenu(null);
                        onAgentModeChange(option.value);
                      }}
                    >
                      <span className="composer__pop-item-icon">
                        <ModeIcon mode={option.value} />
                      </span>
                      <span className="composer__pop-item-main">
                        <span className="composer__pop-item-title">{option.label}</span>
                        <span className="composer__pop-item-desc">{option.description}</span>
                      </span>
                      {option.value === agentMode && (
                        <span className="composer__pop-check"><CheckIcon /></span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 模型选择 */}
            <div className="composer__pillwrap">
              <button
                type="button"
                className={`composer__pill${menu === 'model' ? ' composer__pill--open' : ''}`}
                title="切换模型 / 供应商"
                aria-expanded={menu === 'model'}
                onClick={() => setMenu((current) => (current === 'model' ? null : 'model'))}
              >
                <ModelIcon />
                <span className="composer__pill-label">
                  {defaultModel.length > 0 ? defaultModel : '选择模型'}
                </span>
                <ChevronDownIcon />
              </button>
              {menu === 'model' && (
                <div className="composer__pop composer__pop--model" role="menu">
                  {snapshot.providers.map((provider) => (
                    <div key={provider.id}>
                      <div className="composer__pop-group">
                        {provider.name}
                        {provider.id === snapshot.activeProviderId && (
                          <span className="composer__pop-group-badge">使用中</span>
                        )}
                      </div>
                      {provider.models.length === 0 ? (
                        <button
                          type="button"
                          className="composer__pop-item"
                          onClick={() => {
                            setMenu(null);
                            onOpenSettings('model');
                          }}
                        >
                          <span className="composer__pop-item-main">
                            <span className="composer__pop-item-desc">未配置模型，去设置…</span>
                          </span>
                        </button>
                      ) : (
                        provider.models.map((model) => {
                          const active =
                            provider.id === snapshot.activeProviderId && model.id === defaultModel;
                          return (
                            <button
                              type="button"
                              role="menuitem"
                              key={model.id}
                              className={`composer__pop-item${active ? ' composer__pop-item--active' : ''}`}
                              onClick={() => void selectModel(provider.id, model.id)}
                            >
                              <span className="composer__pop-item-main">
                                <span className="composer__pop-item-title">
                                  {model.name ?? model.id}
                                </span>
                                <span className="composer__pop-item-id">{model.id}</span>
                              </span>
                              {active && <span className="composer__pop-check"><CheckIcon /></span>}
                            </button>
                          );
                        })
                      )}
                    </div>
                  ))}
                  <div className="composer__pop-sep" />
                  <button
                    type="button"
                    role="menuitem"
                    className="composer__pop-item"
                    onClick={() => {
                      setMenu(null);
                      onOpenSettings('model');
                    }}
                  >
                    <span className="composer__pop-item-icon"><GearIcon /></span>
                    <span className="composer__pop-item-title">
                      管理模型{activeProvider !== undefined ? `（${activeProvider.name}）` : ''}
                    </span>
                  </button>
                </div>
              )}
            </div>

            {/* 思考强度 */}
            <div className="composer__pillwrap">
              <button
                type="button"
                className={`composer__pill${menu === 'effort' ? ' composer__pill--open' : ''}`}
                title="思考强度（reasoningEffort）"
                aria-expanded={menu === 'effort'}
                onClick={() => setMenu((current) => (current === 'effort' ? null : 'effort'))}
              >
                <BoltIcon />
                <span className="composer__pill-label">{effortLabel}</span>
                <ChevronDownIcon />
              </button>
              {menu === 'effort' && (
                <div className="composer__pop" role="menu">
                  {EFFORT_OPTIONS.map((option) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={option.value}
                      className={`composer__pop-item${
                        option.value === snapshot.prefs.reasoningEffort ? ' composer__pop-item--active' : ''
                      }`}
                      onClick={() => changeEffort(option.value)}
                    >
                      <span className="composer__pop-item-icon"><BoltIcon /></span>
                      <span className="composer__pop-item-title">{option.label}</span>
                      {option.value === snapshot.prefs.reasoningEffort && (
                        <span className="composer__pop-check"><CheckIcon /></span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="composer__right">
            {running && (
              <button
                type="button"
                className="composer__icon-btn composer__icon-btn--stop"
                title="停止当前任务"
                onClick={() => void onStop()}
              >
                <StopIcon />
              </button>
            )}
            <button
              type="button"
              className="composer__send"
              disabled={!canSend}
              title={
                running
                  ? runningBehavior === 'steer'
                    ? '插话（发送给运行中的任务）'
                    : '加入队列（当前任务结束后执行）'
                  : '发送'
              }
              onClick={submit}
            >
              <ArrowUpIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---- 内联 SVG 图标（线性、圆头） ---- */

function ModeIcon({ mode }: { mode: AgentModeDto }) {
  if (mode === 'plan') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M8 4.5h8a2 2 0 0 1 2 2v13l-6-3-6 3v-13a2 2 0 0 1 2-2Z"
          stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
        />
        <path d="M9.5 9.5h5M9.5 13h3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (mode === 'full') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3.2l7 2.6v5.4c0 4.3-2.9 7.4-7 9-4.1-1.6-7-4.7-7-9V5.8l7-2.6Z"
          stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
        />
        <path d="M8.8 12l2.3 2.3 4.1-4.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.2l7 2.6v5.4c0 4.3-2.9 7.4-7 9-4.1-1.6-7-4.7-7-9V5.8l7-2.6Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
      />
      <path d="M12 8.4v4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="15.4" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ModelIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 3.4v2.4M12 18.2v2.4M3.4 12h2.4M18.2 12h2.4M5.9 5.9l1.7 1.7M16.4 16.4l1.7 1.7M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13.2 3.2 5.8 13.4h5l-1 7.4 7.4-10.2h-5l1-7.4Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 3.8v2.1M12 18.1v2.1M4.6 8.1l1.8 1M17.6 14.9l1.8 1M4.6 15.9l1.8-1M17.6 9.1l1.8-1"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 9.5l5.5 6 5.5-6"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.8 9.6 17.4 19 7.6"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 19V5M5.5 11.5 12 5l6.5 6.5"
        stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v11m0 0 4-4m-4 4-4-4M5 19.5h14"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
