import { useCallback, useEffect, useState } from 'react';
import type { InteractionBehaviorDto, TerminalShellDto } from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';
import {
  MONO_FONT_PRESETS,
  UI_FONT_PRESETS,
  useAppearance,
  type ThemeMode,
} from '../state/appearance';
import { useAppSettings } from '../state/appSettings';
import { ProviderSettings } from './ProviderSettings';

export interface SettingsViewProps {
  /** 返回对话工作区。 */
  onClose(): void;
  /** 打开时定位到的分区（默认常规；账户菜单「API Key」跳模型服务）。 */
  initialSection?: SettingsSectionId;
}

export type SettingsSectionId = 'general' | 'appearance' | 'model' | 'behavior' | 'data';

const NAV_GROUPS: { label: string; items: { id: SettingsSectionId; title: string }[] }[] = [
  {
    label: '基础设置',
    items: [
      { id: 'general', title: '常规' },
      { id: 'appearance', title: '外观' },
      { id: 'model', title: '模型服务' },
    ],
  },
  {
    label: '行为',
    items: [{ id: 'behavior', title: '交互行为' }],
  },
  {
    label: '数据',
    items: [{ id: 'data', title: '数据' }],
  },
];

const SECTION_TITLES: Record<SettingsSectionId, string> = {
  general: '常规',
  appearance: '外观',
  model: '模型服务',
  behavior: '交互行为',
  data: '数据',
};

const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
  { label: '跟随系统', value: 'system' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
];

const SHELL_OPTIONS: { label: string; value: TerminalShellDto }[] = [
  { label: '系统默认', value: 'system' },
  { label: 'PowerShell', value: 'powershell' },
  { label: 'CMD', value: 'cmd' },
  { label: 'Git Bash', value: 'gitbash' },
];

const BEHAVIOR_OPTIONS: { label: string; value: InteractionBehaviorDto }[] = [
  { label: '队列', value: 'queue' },
  { label: '引导', value: 'steer' },
];

const FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 17, 18];
const RETENTION_OPTIONS = [7, 14, 30, 90];

/** 渲染层平台判定（无 node 类型环境）：Windows 才展示“隐藏到托盘”。 */
const IS_WINDOWS = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

/**
 * 设置页（全页覆盖，非弹窗）：左侧分组导航 +「返回工作区」，右侧卡片行。
 * 常规/交互行为/数据走主进程 app-settings（即时保存）；外观走本地
 * appearance 存储；模型服务（多供应商 / 多 Key）走 providers.json。
 */
export function SettingsView({ onClose, initialSection = 'general' }: SettingsViewProps) {
  const [section, setSection] = useState<SettingsSectionId>(initialSection);

  return (
    <div className="settingspage">
      <nav className="settingspage__nav">
        <button type="button" className="settingspage__back" onClick={onClose}>
          <BackIcon />
          返回工作区
        </button>
        <div className="settingspage__nav-scroll">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="settingspage__nav-group">
              <span className="settingspage__nav-group-label">{group.label}</span>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`settingspage__nav-item${section === item.id ? ' settingspage__nav-item--active' : ''}`}
                  onClick={() => setSection(item.id)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      </nav>
      <div className="settingspage__body">
        <h1 className="settingspage__title">{SECTION_TITLES[section]}</h1>
        {section === 'general' && <GeneralSection />}
        {section === 'appearance' && <AppearanceSection />}
        {section === 'model' && <ProviderSettings />}
        {section === 'behavior' && <BehaviorSection />}
        {section === 'data' && <DataSection />}
      </div>
    </div>
  );
}

/* ─────────────────────────── 常规 ─────────────────────────── */

function GeneralSection() {
  const { appearance, update } = useAppearance();
  const { settings, boot, update: updateApp } = useAppSettings();
  const [proxyInput, setProxyInput] = useState(settings.httpProxy);

  // 主进程真值到达 / 推送变更时，同步代理输入框（未编辑态下跟随）。
  useEffect(() => {
    setProxyInput(settings.httpProxy);
  }, [settings.httpProxy]);

  const proxyDirty = proxyInput.trim() !== settings.httpProxy;
  const hardwarePending = boot.hardwareAcceleration !== settings.hardwareAcceleration;

  return (
    <div className="settingspage__cards">
      <section className="settingscard">
        <SelectRow
          title="界面明暗"
          value={appearance.theme}
          options={THEME_OPTIONS}
          onChange={(value) => update({ theme: value as ThemeMode })}
        />
        <SelectRow
          title="集成终端 Shell"
          description="内嵌终端使用的 Shell（随三期终端功能生效）。"
          value={settings.terminalShell}
          options={SHELL_OPTIONS}
          onChange={(value) => updateApp({ terminalShell: value as TerminalShellDto })}
        />
        <div className="settings-row">
          <div className="settings-row__main">
            <div className="settings-row__title">HTTP 代理</div>
            <div className="settings-row__desc">如 http://127.0.0.1:7890；留空不代理。页面请求立即生效，Agent 网络请求重启后生效。</div>
            <div className="settings-row__inline">
              <input
                type="text"
                className="settingspage__input"
                placeholder="http://127.0.0.1:7890"
                value={proxyInput}
                onChange={(event) => setProxyInput(event.target.value)}
              />
              <button
                type="button"
                className="settingspage__save"
                disabled={!proxyDirty}
                onClick={() => updateApp({ httpProxy: proxyInput })}
              >
                保存
              </button>
            </div>
          </div>
        </div>
        <SwitchRow
          title="Chrome 硬件加速"
          description="关闭后界面改用软件渲染，修改后重启应用生效。"
          checked={settings.hardwareAcceleration}
          onChange={(checked) => updateApp({ hardwareAcceleration: checked })}
        >
          {hardwarePending && <RelaunchButton />}
        </SwitchRow>
        <SwitchRow
          title="任务通知"
          description="任务完成、失败或需要确认时发送桌面通知。"
          checked={settings.notifications}
          onChange={(checked) => updateApp({ notifications: checked })}
        />
        <SwitchRow
          title="通知声音"
          description="通知开启后，可单独关闭任务通知提示音。"
          disabled={!settings.notifications}
          checked={settings.notificationSound}
          onChange={(checked) => updateApp({ notificationSound: checked })}
        />
        {IS_WINDOWS && (
          <SwitchRow
            title="关闭窗口时隐藏到托盘"
            description="仅 Windows 生效。点击关闭按钮或关闭窗口快捷键时隐藏窗口，托盘中的退出仍会完全退出应用。"
            checked={settings.closeToTray}
            onChange={(checked) => updateApp({ closeToTray: checked })}
          />
        )}
        <SwitchRow
          title="保持电脑运行"
          description="打开后阻止系统因空闲进入休眠（仍可手动睡眠/合盖休眠）。桌面端全局生效。"
          checked={settings.keepAwake}
          onChange={(checked) => updateApp({ keepAwake: checked })}
        />
      </section>
    </div>
  );
}

/* ─────────────────────────── 交互行为 ─────────────────────────── */

function BehaviorSection() {
  const { settings, update } = useAppSettings();
  return (
    <div className="settingspage__cards">
      <section className="settingscard">
        <SelectRow
          title="交互行为"
          description="Agent 运行时将后续输入加入队列，或引导至下一轮工具调用后运行。"
          value={settings.interactionBehavior}
          options={BEHAVIOR_OPTIONS}
          onChange={(value) =>
            update({ interactionBehavior: value === 'steer' ? 'steer' : 'queue' })
          }
        />
        <SwitchRow
          title="提问自动继续"
          description="开启后，Agent 提问 5 分钟未回答会自动继续；关闭后，当前和后续提问会一直等待你的回答。"
          checked={settings.autoContinueQuestions}
          onChange={(checked) => update({ autoContinueQuestions: checked })}
        />
        <SwitchRow
          title="显示思考过程"
          description="在消息流中展示完整的模型思考内容；关闭时每轮仍展示第一次思考。"
          checked={settings.showThinking}
          onChange={(checked) => update({ showThinking: checked })}
        />
        <SwitchRow
          title="显示待办"
          description="在消息流上方展示待办（Todo）任务卡片。"
          checked={settings.showTodos}
          onChange={(checked) => update({ showTodos: checked })}
        />
      </section>
    </div>
  );
}

/* ─────────────────────────── 数据 ─────────────────────────── */

function DataSection() {
  const { settings, boot, update } = useAppSettings();
  const [dataNotice, setDataNotice] = useState('');
  const dataPending = boot.dataPath !== settings.dataPath;

  const pickDataPath = useCallback(async () => {
    setDataNotice('');
    try {
      const result = await requireBridge().appSettings.pickDataPath();
      if (result.changed) {
        setDataNotice(`现有数据已复制到 ${result.path}，重启应用后生效。`);
      } else if (result.error !== undefined) {
        setDataNotice(`迁移失败：${result.error}`);
      }
    } catch (error) {
      setDataNotice(`迁移失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  return (
    <div className="settingspage__cards">
      <section className="settingscard">
        <SwitchRow
          title="自动归档旧任务"
          description="定时扫描最近打开过的工作区，将已完成、无未读、未置顶且超过保留期的任务自动归档（从侧栏隐藏，数据不删除）。"
          checked={settings.autoArchive}
          onChange={(checked) => update({ autoArchive: checked })}
        />
        <SelectRow
          title="归档保留时长"
          description="任务最后更新时间早于该时长后，才会进入自动归档候选。"
          value={String(settings.archiveRetentionDays)}
          options={RETENTION_OPTIONS.map((days) => ({ label: `${days} 天后归档`, value: String(days) }))}
          onChange={(value) => update({ archiveRetentionDays: Number(value) })}
        />
        <div className="settings-row">
          <div className="settings-row__main">
            <div className="settings-row__title">数据存储路径</div>
            <div className="settings-row__desc">
              应用数据根目录（默认为用户主目录 ~/.deep-seek-harness-code，与其他 Agent CLI 一致）。
              修改后会将现有数据复制到新位置。
            </div>
            <div className="settings-row__inline">
              <span className="settingspage__path" title={settings.dataPath}>
                {settings.dataPath.length > 0 ? settings.dataPath : '默认（~/.deep-seek-harness-code）'}
              </span>
              <button type="button" className="settingspage__save" onClick={() => void pickDataPath()}>
                修改…
              </button>
            </div>
            {dataNotice.length > 0 && <div className="settings-row__desc settings-row__desc--accent">{dataNotice}</div>}
          </div>
          {dataPending && <RelaunchButton />}
        </div>
      </section>
    </div>
  );
}

/* ─────────────────────────── 外观 ─────────────────────────── */

function AppearanceSection() {
  const { appearance, update } = useAppearance();
  return (
    <div className="settingspage__cards">
      <section className="settingscard">
        <SelectRow
          title="主题"
          value={appearance.theme}
          options={THEME_OPTIONS}
          onChange={(value) => update({ theme: value as ThemeMode })}
        />
        <FontRow
          title="界面字体"
          presets={UI_FONT_PRESETS}
          value={appearance.uiFont}
          onChange={(uiFont) => update({ uiFont })}
        />
        <FontRow
          title="等宽字体（代码 / 工具卡 / 输入区）"
          presets={MONO_FONT_PRESETS}
          value={appearance.monoFont}
          onChange={(monoFont) => update({ monoFont })}
        />
        <SelectRow
          title="界面字号"
          value={String(appearance.fontSize)}
          options={FONT_SIZE_OPTIONS.map((size) => ({ label: `${size} px`, value: String(size) }))}
          onChange={(value) => update({ fontSize: Number(value) })}
        />
      </section>
    </div>
  );
}

/* ─────────────────────────── 通用行组件 ─────────────────────────── */

function SwitchRow({
  title,
  description,
  checked,
  onChange,
  disabled = false,
  hint,
  children,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  /** 追加到 description 末尾的短提示（如“修改后重启生效”）。 */
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__main">
        <div className="settings-row__title">{title}</div>
        {(description !== undefined || hint !== undefined) && (
          <div className="settings-row__desc">
            {description}
            {hint !== undefined && <span className="settings-row__hint">{hint}</span>}
          </div>
        )}
      </div>
      <div className="settings-row__control">
        {children}
        <input
          type="checkbox"
          role="switch"
          className="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      </div>
    </div>
  );
}

function SelectRow({
  title,
  description,
  value,
  options,
  onChange,
}: {
  title: string;
  description?: string;
  value: string;
  options: { label: string; value: string }[];
  onChange(value: string): void;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row__main">
        <div className="settings-row__title">{title}</div>
        {description !== undefined && <div className="settings-row__desc">{description}</div>}
      </div>
      <div className="settings-row__control">
        <select className="settingspage__select" value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** 字体行：预设下拉 +「自定义…」转文本框（值不在预设里时自动显示为自定义态）。 */
const CUSTOM_FONT = '__custom__';

function FontRow({
  title,
  presets,
  value,
  onChange,
}: {
  title: string;
  presets: { label: string; value: string }[];
  value: string;
  onChange(value: string): void;
}) {
  const inPresets = presets.some((preset) => preset.value === value);
  const selectValue = inPresets ? value : CUSTOM_FONT;
  return (
    <div className="settings-row">
      <div className="settings-row__main">
        <div className="settings-row__title">{title}</div>
        <div className="settings-row__inline">
          <select
            className="settingspage__select settingspage__select--wide"
            value={selectValue}
            onChange={(event) => {
              if (event.target.value !== CUSTOM_FONT) onChange(event.target.value);
            }}
          >
            {presets.map((preset) => (
              <option key={preset.label} value={preset.value}>
                {preset.label}
              </option>
            ))}
            <option value={CUSTOM_FONT}>自定义…</option>
          </select>
          {selectValue === CUSTOM_FONT && (
            <input
              type="text"
              className="settingspage__input"
              placeholder="字体名，如 'Sarasa Mono SC'"
              value={value}
              onChange={(event) => onChange(event.target.value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** “重启后生效”类操作的立即重启按钮。 */
function RelaunchButton() {
  return (
    <button
      type="button"
      className="settingspage__save settingspage__save--primary"
      onClick={() => void requireBridge().app.relaunch()}
    >
      重启应用
    </button>
  );
}

function BackIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
