import { useCallback, useEffect, useState } from 'react';
import type {
  AutomationDto,
  AutomationScheduleDto,
  InteractionBehaviorDto,
  TerminalShellDto,
} from '../../shared/protocol.js';
import { requireBridge } from '../ipc/api';
import {
  MONO_FONT_PRESETS,
  UI_FONT_PRESETS,
  useAppearance,
  type ThemeMode,
} from '../state/appearance';
import { useAppSettings } from '../state/appSettings';
import { McpSettings } from './McpSettings';
import { ProviderSettings } from './ProviderSettings';

export interface SettingsViewProps {
  /** 返回对话工作区。 */
  onClose(): void;
  /** 打开时定位到的分区（默认常规；账户菜单「API Key」跳模型服务）。 */
  initialSection?: SettingsSectionId;
}

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'model'
  | 'behavior'
  | 'rules'
  | 'automation'
  | 'mcp'
  | 'data';

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
    items: [
      { id: 'behavior', title: '交互行为' },
      { id: 'rules', title: '项目规则' },
    ],
  },
  {
    label: '扩展',
    items: [
      { id: 'automation', title: '自动化' },
      { id: 'mcp', title: 'MCP 服务器' },
    ],
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
  rules: '项目规则',
  automation: '自动化',
  mcp: 'MCP 服务器',
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
        {section === 'model' ? (
          // 模型服务为两级页面（供应商列表 / 供应商配置），自带各自的页头标题。
          <ProviderSettings />
        ) : section === 'mcp' ? (
          // MCP 服务器为独立管理页（页头带应用变更按钮）。
          <McpSettings />
        ) : (
          <>
            <h1 className="settingspage__title">{SECTION_TITLES[section]}</h1>
            {section === 'general' && <GeneralSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'behavior' && <BehaviorSection />}
            {section === 'rules' && <RulesSection />}
            {section === 'automation' && <AutomationSection />}
            {section === 'data' && <DataSection />}
          </>
        )}
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
  const { settings, boot, update } = useAppSettings();
  const sandboxPending = boot.sandboxEnabled !== settings.sandboxEnabled;
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
      <section className="settingscard">
        <SwitchRow
          title="命令沙箱（实验）"
          description="pwsh 与文件写入默认限制在工作区和临时目录内（Windows ACL 令牌约束），越界操作经审批升级；read-only 场景下 PowerShell 会进入受限语言模式。修改后重启应用生效。"
          checked={settings.sandboxEnabled}
          onChange={(checked) => update({ sandboxEnabled: checked })}
        >
          {sandboxPending && <RelaunchButton />}
        </SwitchRow>
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

/* ─────────────────────────── 项目规则（AGENTS.md） ─────────────────────────── */

/**
 * 规则分区：全局（数据目录）与当前项目两层 AGENTS.md 编辑器。
 * harness 会在每次会话启动时自动发现并按「全局 → 项目根 → 当前目录」
 * 逐层合并注入（兼容 CLAUDE.md 与 *.local.md 变体），保存即对后续会话生效。
 */
function RulesSection() {
  return (
    <div className="settingspage__cards">
      <section className="settingscard">
        <RulesEditor
          scope="global"
          title="全局规则"
          description="对所有项目生效的固定约定（编码规范、沟通偏好等）。"
        />
        <div className="settings-sep" />
        <RulesEditor
          scope="project"
          title="项目规则"
          description="仅对当前工作区生效（构建命令、目录约定、提交规范等）。"
        />
        <div className="settings-note">
          Agent 在每次会话启动时按「全局 → 项目根 → 当前目录」逐层合并读取规则文件；
          同目录下 AGENTS.md 优先，另兼容 CLAUDE.md 与 *.local.md 变体。全部规则合并上限
          64 KiB，超出部分会被截断。修改对后续会话生效，进行中的会话不受影响。
        </div>
      </section>
    </div>
  );
}

function RulesEditor({
  scope,
  title,
  description,
}: {
  scope: 'global' | 'project';
  title: string;
  description: string;
}) {
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await requireBridge().app.readRules(scope);
      setFile({ path: result.path, content: result.content });
      setDraft(result.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = file !== null && draft !== file.content;

  const save = useCallback(async () => {
    setError('');
    try {
      const result = await requireBridge().app.writeRules(scope, draft);
      setFile({ path: result.path, content: result.content });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [scope, draft]);

  return (
    <div className="settings-row settings-row--stack">
      <div className="settings-row__main">
        <div className="settings-row__title">
          {title}
          {file !== null && (
            <span className={`settingspage__rules-badge${dirty ? '' : ' settingspage__rules-badge--on'}`}>
              {dirty ? '未保存' : '已同步'}
            </span>
          )}
        </div>
        <div className="settings-row__desc">{description}</div>
        <textarea
          className="settingspage__rules-editor"
          value={draft}
          spellCheck={false}
          placeholder={'# 用 Markdown 写下约定\n- 修改 JS 文件后运行 npm test\n- 提交信息使用中文'}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Ctrl/Cmd+S 保存（拦截浏览器默认保存对话框）。
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              if (dirty) void save();
            }
          }}
        />
        <div className="settings-row__inline">
          <span className="settingspage__path" title={file?.path}>
            {file?.path ?? '…'}
          </span>
          <button
            type="button"
            className="settingspage__save settingspage__save--primary"
            disabled={!dirty}
            onClick={() => void save()}
          >
            {saved ? '已保存' : '保存'}
          </button>
        </div>
        {error.length > 0 && <div className="settings-row__desc settings-row__desc--accent">{error}</div>}
      </div>
    </div>
  );
}

/* ─────────────────────────── 自动化 ─────────────────────────── */

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function describeSchedule(schedule: AutomationScheduleDto): string {
  if (schedule.type === 'daily') return `每天 ${schedule.time}`;
  if (schedule.type === 'weekly') return `每${WEEKDAY_LABELS[schedule.weekday] ?? '周一'} ${schedule.time}`;
  return `每 ${schedule.minutes} 分钟`;
}

function formatRunStamp(at: number | undefined, status: string | undefined): string {
  if (at === undefined) return '尚未运行';
  const date = new Date(at);
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (status === undefined || status === 'ok') return `${stamp} · 成功`;
  return `${stamp} · ${status}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 自动化分区：定时任务的创建与管理。到点由主进程在当前工作区
 * 创建会话并注入 prompt（结果进入会话流）；harness 未就绪时跳过
 * 不占触发位，应用关闭期间错过的触发不补跑。
 */
function AutomationSection() {
  const { settings, update } = useAppSettings();
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const patch = (id: string, changes: Partial<AutomationDto>): void => {
    update({
      automations: settings.automations.map((item) => (item.id === id ? { ...item, ...changes } : item)),
    });
  };

  const remove = (id: string): void => {
    update({ automations: settings.automations.filter((item) => item.id !== id) });
    if (editingId === id) {
      setEditingId(null);
      setFormOpen(false);
    }
  };

  const editing = settings.automations.find((item) => item.id === editingId);

  const save = (automation: AutomationDto): void => {
    const exists = settings.automations.some((item) => item.id === automation.id);
    update({
      automations: exists
        ? settings.automations.map((item) => (item.id === automation.id ? automation : item))
        : [...settings.automations, automation],
    });
    setFormOpen(false);
    setEditingId(null);
  };

  return (
    <div className="settingspage__cards">
      <section className="settingscard">
        <div className="settings-row settings-row--foot">
          <span className="automation-count">
            {settings.automations.length > 0
              ? `${settings.automations.filter((item) => item.enabled).length} 个启用 / 共 ${settings.automations.length} 个`
              : ''}
          </span>
          <button
            type="button"
            className="settingspage__save settingspage__save--primary"
            onClick={() => {
              setEditingId(null);
              setFormOpen((open) => !open || editingId !== null);
            }}
          >
            新建任务
          </button>
        </div>
        {formOpen && (
          <AutomationForm
            initial={editing}
            onCancel={() => {
              setFormOpen(false);
              setEditingId(null);
            }}
            onSave={save}
          />
        )}
        {settings.automations.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row__main">
              <div className="settings-row__desc">
                暂无自动化任务。新建一个，让 Agent 定时在当前工作区执行——每日简报、仓库检查、定时继续任务等。
              </div>
            </div>
          </div>
        ) : (
          settings.automations.map((item) => (
            <div key={item.id} className="settings-row settings-row--stack">
              <div className="settings-row__main">
                <div className="settings-row__title">
                  {item.name}
                  {!item.enabled && <span className="automation-off">已停用</span>}
                </div>
                <div className="settings-row__desc">
                  {describeSchedule(item.schedule)} · 上次：{formatRunStamp(item.lastRunAt, item.lastRunStatus)}
                </div>
                <div className="automation-prompt" title={item.prompt}>
                  {item.prompt}
                </div>
              </div>
              <div className="settings-row__control">
                <button
                  type="button"
                  className="settingspage__save"
                  onClick={() => {
                    setEditingId(item.id);
                    setFormOpen(true);
                  }}
                >
                  编辑
                </button>
                <button type="button" className="settingspage__save settingspage__save--danger" onClick={() => remove(item.id)}>
                  删除
                </button>
                <input
                  type="checkbox"
                  role="switch"
                  className="switch"
                  checked={item.enabled}
                  aria-label={`${item.name} 启用`}
                  onChange={(event) => patch(item.id, { enabled: event.target.checked })}
                />
              </div>
            </div>
          ))
        )}
        <div className="settings-note">
          任务在主进程定时调度，到点在「当前工作区」创建新会话并注入提示词，结果进入该会话
          （侧栏可见）；harness 未就绪时本轮跳过、不占用触发位，应用关闭期间错过的触发不补跑。
        </div>
      </section>
    </div>
  );
}

/** 新建 / 编辑表单：名称、提示词、调度（每天 / 每周 / 间隔分钟）。 */
function AutomationForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: AutomationDto | undefined;
  onCancel(): void;
  onSave(automation: AutomationDto): void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [type, setType] = useState<AutomationScheduleDto['type']>(initial?.schedule.type ?? 'daily');
  const [time, setTime] = useState(initial?.schedule.type === 'weekly' || initial?.schedule.type === 'daily' ? initial.schedule.time : '09:00');
  const [weekday, setWeekday] = useState(initial?.schedule.type === 'weekly' ? initial.schedule.weekday : 1);
  const [minutes, setMinutes] = useState(initial?.schedule.type === 'interval' ? initial.schedule.minutes : 30);

  const canSave = name.trim().length > 0 && prompt.trim().length > 0;

  const submit = (): void => {
    const schedule: AutomationScheduleDto =
      type === 'weekly'
        ? { type, weekday, time }
        : type === 'interval'
          ? { type, minutes }
          : { type: 'daily', time };
    onSave({
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim(),
      prompt: prompt.trim(),
      schedule,
      enabled: initial?.enabled ?? true,
      createdAt: initial?.createdAt ?? Date.now(),
      ...(initial?.lastRunAt !== undefined ? { lastRunAt: initial.lastRunAt } : {}),
      ...(initial?.lastRunStatus !== undefined ? { lastRunStatus: initial.lastRunStatus } : {}),
    });
  };

  return (
    <div className="settings-row settings-row--stack automation-form">
      <div className="settings-row__main">
        <div className="settings-row__title">{initial === undefined ? '新建任务' : `编辑：${initial.name}`}</div>
        <div className="settings-row__inline">
          <input
            type="text"
            className="settingspage__input"
            placeholder="任务名称，如「每日简报」"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
          />
          <select
            className="settingspage__select"
            value={type}
            onChange={(event) => setType(event.target.value as AutomationScheduleDto['type'])}
          >
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="interval">间隔分钟</option>
          </select>
          {type === 'daily' && (
            <input
              type="time"
              className="settingspage__input settingspage__input--time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          )}
          {type === 'weekly' && (
            <>
              <select
                className="settingspage__select"
                value={String(weekday)}
                onChange={(event) => setWeekday(Number(event.target.value))}
              >
                {WEEKDAY_LABELS.map((label, index) => (
                  <option key={label} value={String(index)}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="time"
                className="settingspage__input settingspage__input--time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </>
          )}
          {type === 'interval' && (
            <input
              type="number"
              className="settingspage__input settingspage__input--time"
              min={1}
              max={1440}
              value={minutes}
              onChange={(event) => setMinutes(Math.min(1440, Math.max(1, Number(event.target.value) || 1)))}
            />
          )}
        </div>
        <textarea
          className="settingspage__rules-editor"
          value={prompt}
          spellCheck={false}
          placeholder="到点注入给 Agent 的提示词，如「总结今天的待办并输出简报」"
          onChange={(event) => setPrompt(event.target.value)}
        />
      </div>
      <div className="settings-row__control">
        <button type="button" className="settingspage__save" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="settingspage__save settingspage__save--primary"
          disabled={!canSave}
          onClick={submit}
        >
          保存任务
        </button>
      </div>
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
