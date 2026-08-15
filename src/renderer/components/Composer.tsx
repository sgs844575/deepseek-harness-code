import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import type {
  AgentModeDto,
  AgentPresetDto,
  InteractionBehaviorDto,
  PromptModeDto,
  ProviderPrefsDto,
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
  /** 当前上下文占用（最近一次请求的 inputTokens；null = 尚无数据）。 */
  contextTokens: number | null;
  /** Agent 预设名单（空数组 = 组合未启用 roster，隐藏选择器）。 */
  presets: AgentPresetDto[];
  /** 活动会话运行的预设 id（事件流 > 会话头 > 默认）。 */
  activePresetId?: string;
  /** roster 默认预设 id（新会话挂载它）。 */
  defaultPresetId?: string;
  /** 活动会话是否已锁定预设（已开始对话；选择将降级为设默认）。 */
  presetLocked: boolean;
  onSelectPreset(presetId: string): void;
  /** 打开设置（模型服务分区，模型菜单「管理模型」入口）。 */
  onOpenSettings(section?: 'model'): void;
  onSend(text: string, mode: PromptModeDto): void | Promise<void>;
  onStop(): void | Promise<void>;
  onNewSession(): void;
  onExportSession(): void;
}

const TEXTAREA_MAX_HEIGHT = 220;

/** harness llm-deepseek 的默认档（消息设置「默认」选项 = 恢复这些值）。 */
const DEFAULT_MAX_TOKENS = 256_000;
const DEFAULT_CONTEXT_WINDOW = 1_000_000;

/** 最大输出预设（tokens）。 */
const MAX_TOKENS_OPTIONS = [8_192, 16_384, 32_768, 65_536] as const;

/** 上下文窗口预设（tokens）。 */
const CONTEXT_WINDOW_OPTIONS = [65_536, 131_072, 262_144, 524_288, 1_048_576] as const;

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

type MenuId = 'plus' | 'preset' | 'mode' | 'model' | 'effort' | 'msgsettings';

/** tokens → 紧凑展示（12,345 / 1.2M）。 */
function formatTokens(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`;
  return value.toLocaleString('en-US');
}

/**
 * 输入区（Cherry / ZCode 风格）：上方多行输入，下方工具栏——左下角起
 * Agent 预设（plugin/标准/PTC/极简/创造…，空白会话可切）、「+」更多操作、
 * 权限模式、模型选择、思考强度、消息设置六组胶囊菜单，右侧上下文圆环
 * （hover 详情）+ 停止 / 发送。Enter 发送（Shift+Enter 换行）；运行中
 * 发送的行为由设置“交互行为”决定。
 */
export function Composer({
  disabled,
  running,
  runningBehavior,
  agentMode,
  onAgentModeChange,
  contextTokens,
  presets,
  activePresetId,
  defaultPresetId,
  presetLocked,
  onSelectPreset,
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
  const activePreset = presets.find((preset) => preset.id === activePresetId);
  const presetLabel = activePreset?.name ?? activePreset?.id ?? activePresetId ?? '';
  const effortLabel =
    EFFORT_OPTIONS.find((option) => option.value === snapshot.prefs.reasoningEffort)?.label ?? '';
  // 上下文统计：分母 = 当前模型 contextWindow > prefs 兜底 > harness 默认。
  const activeModel =
    activeProvider?.models.find((model) => model.id === defaultModel) ?? undefined;
  const contextMax =
    activeModel?.contextWindow ?? snapshot.prefs.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const contextPercentage =
    contextTokens !== null && contextMax > 0
      ? Math.min(100, Math.max(0, Math.round((contextTokens / contextMax) * 100)))
      : null;
  const maxTokensValue = snapshot.prefs.maxTokens ?? DEFAULT_MAX_TOKENS;
  const contextWindowValue = snapshot.prefs.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  const updatePrefs = useCallback((patch: Partial<ProviderPrefsDto>) => {
    void requireBridge()
      .providers.updatePrefs(patch)
      .catch((error) => console.error('保存消息设置失败', error));
  }, []);

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
            {/* Agent 预设（输入框左下首位）：空白会话切换当前会话，已开始则设默认 */}
            {presets.length > 0 && (
              <div className="composer__pillwrap">
                <button
                  type="button"
                  className={`composer__pill${menu === 'preset' ? ' composer__pill--open' : ''}${
                    activePresetId !== undefined && activePresetId !== defaultPresetId
                      ? ' composer__pill--accent'
                      : ''
                  }`}
                  title="Agent 预设（标准 / PTC / 极简 / 创造 …）"
                  aria-expanded={menu === 'preset'}
                  onClick={() => setMenu((current) => (current === 'preset' ? null : 'preset'))}
                >
                  <PresetIcon />
                  <span className="composer__pill-label">{presetLabel}</span>
                  <ChevronDownIcon />
                </button>
                {menu === 'preset' && (
                  <div className="composer__pop composer__pop--preset" role="menu">
                    <div className="composer__pop-note">
                      {presetLocked
                        ? '当前会话已开始，预设锁定；选择将设为之后新会话的默认。'
                        : '切换当前（空白）会话的预设。'}
                    </div>
                    {presets.map((preset) => {
                      const active = preset.id === activePresetId;
                      const presetDescription =
                        preset.broken !== undefined
                          ? `无法组装：${preset.broken}`
                          : (preset.description ?? '');
                      return (
                        <button
                          type="button"
                          role="menuitem"
                          key={preset.id}
                          className={`composer__pop-item${active ? ' composer__pop-item--active' : ''}`}
                          disabled={preset.broken !== undefined}
                          title={preset.broken !== undefined ? `无法组装：${preset.broken}` : undefined}
                          onClick={() => {
                            setMenu(null);
                            onSelectPreset(preset.id);
                          }}
                        >
                          <span className="composer__pop-item-icon"><PresetIcon /></span>
                          <span className="composer__pop-item-main">
                            <span className="composer__pop-item-title">
                              {preset.name ?? preset.id}
                              {preset.id === defaultPresetId && (
                                <span className="composer__pop-group-badge">默认</span>
                              )}
                              {preset.trust === 'user' && (
                                <span className="composer__pop-group-badge">自建</span>
                              )}
                            </span>
                            {presetDescription.length > 0 && (
                              <span className="composer__pop-item-desc">{presetDescription}</span>
                            )}
                          </span>
                          {active && <span className="composer__pop-check"><CheckIcon /></span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

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

            {/* 消息设置：输出上限 / 上下文窗口（写入 llm 设置段，下一请求生效） */}
            <div className="composer__pillwrap">
              <button
                type="button"
                className={`composer__pill${menu === 'msgsettings' ? ' composer__pill--open' : ''}${
                  snapshot.prefs.maxTokens !== undefined || snapshot.prefs.contextWindow !== undefined
                    ? ' composer__pill--accent'
                    : ''
                }`}
                title="消息设置（最大输出 / 上下文窗口）"
                aria-expanded={menu === 'msgsettings'}
                onClick={() => setMenu((current) => (current === 'msgsettings' ? null : 'msgsettings'))}
              >
                <SlidersIcon />
                <span className="composer__pill-label">消息设置</span>
                <ChevronDownIcon />
              </button>
              {menu === 'msgsettings' && (
                <div className="composer__pop composer__pop--settings" role="menu">
                  <div className="composer__pop-setting">
                    <div className="composer__pop-setting-title">最大输出</div>
                    <div className="composer__pop-setting-desc">
                      单次请求的输出上限（当前 {formatTokens(maxTokensValue)}）
                    </div>
                    <div className="composer__chips">
                      <button
                        type="button"
                        className={`composer__chip${snapshot.prefs.maxTokens === undefined ? ' composer__chip--active' : ''}`}
                        onClick={() => updatePrefs({ maxTokens: undefined })}
                      >
                        默认 {formatTokens(DEFAULT_MAX_TOKENS)}
                      </button>
                      {MAX_TOKENS_OPTIONS.map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={`composer__chip${snapshot.prefs.maxTokens === value ? ' composer__chip--active' : ''}`}
                          onClick={() => updatePrefs({ maxTokens: value })}
                        >
                          {formatTokens(value)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="composer__pop-setting">
                    <div className="composer__pop-setting-title">上下文窗口</div>
                    <div className="composer__pop-setting-desc">
                      模型未声明时的上下文容量兜底（当前 {formatTokens(contextWindowValue)}，统计圆环按此计算）
                    </div>
                    <div className="composer__chips">
                      {CONTEXT_WINDOW_OPTIONS.map((value) => (
                        <button
                          type="button"
                          key={value}
                          className={`composer__chip${snapshot.prefs.contextWindow === value ? ' composer__chip--active' : ''}`}
                          onClick={() => updatePrefs({ contextWindow: value })}
                        >
                          {formatTokens(value)}
                        </button>
                      ))}
                      <button
                        type="button"
                        className={`composer__chip${snapshot.prefs.contextWindow === undefined ? ' composer__chip--active' : ''}`}
                        onClick={() => updatePrefs({ contextWindow: undefined })}
                      >
                        默认 {formatTokens(DEFAULT_CONTEXT_WINDOW)}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="composer__right">
            {/* 上下文占用圆环（Cherry 同款）：conic 渐变按占用插值着色，hover 展示详情 */}
            {contextPercentage !== null && (
              <div className="composer__ctxwrap" tabIndex={0} role="meter"
                aria-label={`上下文占用 ${contextPercentage}%`}
                aria-valuemin={0} aria-valuemax={100} aria-valuenow={contextPercentage}
              >
                <ContextRing percentage={contextPercentage} busy={running} />
                <div className="composer__ctxpop">
                  <div className="composer__ctxpop-title">上下文用量</div>
                  <div className="composer__ctxbar">
                    <div
                      className="composer__ctxbar-fill"
                      style={{
                        width: `${contextPercentage}%`,
                        background: contextColor(contextPercentage),
                      }}
                    />
                  </div>
                  <div className="composer__ctxpop-row">
                    <span>
                      {(contextTokens ?? 0).toLocaleString('en-US')} / {formatTokens(contextMax)}（{contextPercentage}%）
                    </span>
                    <span className="composer__ctxpop-model">
                      {activeModel?.name ?? activeModel?.id ?? defaultModel}
                    </span>
                  </div>
                </div>
              </div>
            )}
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

/** 上下文占用配色（Cherry Studio 同款插值）：≤50% ok→warn，>50% warn→danger。 */
function contextColor(percentage: number): string {
  const pct = Math.min(100, Math.max(0, percentage));
  if (pct <= 50) {
    const warnWeight = Math.round(pct * 2);
    return `color-mix(in srgb, var(--ok) ${100 - warnWeight}%, var(--warn) ${warnWeight}%)`;
  }
  const dangerWeight = Math.round((pct - 50) * 2);
  return `color-mix(in srgb, var(--warn) ${100 - dangerWeight}%, var(--danger) ${dangerWeight}%)`;
}

/** 上下文占用圆环：conic-gradient 描边，运行中呼吸动画。 */
function ContextRing({ percentage, busy }: { percentage: number; busy: boolean }) {
  return (
    <span
      className={`composer__ring${busy ? ' composer__ring--busy' : ''}`}
      style={
        {
          '--ctx-color': contextColor(percentage),
          '--ctx-pct': `${percentage}%`,
        } as CSSProperties
      }
      aria-hidden
    >
      <span className="composer__ring-inner" />
      <span className="composer__ring-text">{percentage}%</span>
    </span>
  );
}

/** 消息设置（滑杆）图标。 */
function SlidersIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7.5h9M17.5 7.5H19M5 16.5h2M10.5 16.5H19"
        stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      />
      <circle cx="15.5" cy="7.5" r="2.1" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="8.5" cy="16.5" r="2.1" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

/** Agent 预设（层叠组合）图标。 */
function PresetIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.6 20 8l-8 4.4L4 8l8-4.4Z"
        stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"
      />
      <path
        d="M4.6 12.4 12 16.5l7.4-4.1M4.6 16.4 12 20.5l7.4-4.1"
        stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

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
