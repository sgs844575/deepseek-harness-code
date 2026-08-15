import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AgentModeDto,
  AppSettingsDto,
  ProjectEntryDto,
  TerminalShellDto,
} from '../../shared/protocol.js';

/**
 * 应用设置存储：~/.deep-seek-harness-code/app-settings.json 的读写与归一化。
 *
 * 与 harness 设置文档（settings.yaml）无关——这里只放客户端自身的行为偏好
 * （终端 Shell / 代理 / 通知 / 托盘 / 休眠 / 归档……）。
 * 读写均为同步小文件操作（< 1KB），无需异步化。
 */

/** 设置文件名（放在应用主目录 ~/.deep-seek-harness-code 下）。 */
export const APP_SETTINGS_FILE_NAME = 'app-settings.json';

export const DEFAULT_APP_SETTINGS: AppSettingsDto = {
  terminalShell: 'system',
  httpProxy: '',
  hardwareAcceleration: true,
  notifications: true,
  notificationSound: true,
  closeToTray: false,
  keepAwake: false,
  interactionBehavior: 'queue',
  agentMode: 'ask',
  autoContinueQuestions: false,
  showThinking: true,
  showTodos: true,
  autoArchive: false,
  archiveRetentionDays: 7,
  dataPath: '',
  projects: [],
  sandboxEnabled: false,
};

const TERMINAL_SHELLS = new Set<TerminalShellDto>(['system', 'powershell', 'cmd', 'gitbash']);
const AGENT_MODES = new Set<AgentModeDto>(['ask', 'full', 'plan']);

function normalizeProxy(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length === 0) return '';
  // 宽松接受 host:port（补 http://）与完整 URL；其余一律视为未配置。
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed;
  if (/^[\w.-]+:\d+$/.test(trimmed)) return `http://${trimmed}`;
  return '';
}

function clampRetentionDays(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return DEFAULT_APP_SETTINGS.archiveRetentionDays;
  return Math.min(365, Math.max(1, Math.round(num)));
}

/** path 末段（项目展示名兜底）。 */
function pathBasename(value: string): string {
  const parts = value.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? value;
}

/** 项目列表归一化：路径规范化（resolve，兼容正反斜杠）、非法项剔除、
 * name 兜底路径末段、按路径（小写）去重。 */
function normalizeProjects(raw: unknown): ProjectEntryDto[] {
  if (!Array.isArray(raw)) return [];
  const byPath = new Map<string, ProjectEntryDto>();
  for (const item of raw.slice(0, 50)) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.path !== 'string' || record.path.trim().length === 0) continue;
    let target: string;
    try {
      target = path.resolve(record.path.trim());
    } catch {
      continue;
    }
    const name =
      typeof record.name === 'string' && record.name.trim().length > 0
        ? record.name.trim().slice(0, 60)
        : pathBasename(target);
    byPath.set(target.toLowerCase(), { path: target, name });
  }
  return [...byPath.values()];
}

/** 逐字段防御性归一化：未知/非法值回落默认，保证磁盘脏数据不会击穿运行时。 */
export function normalizeAppSettings(raw: unknown): AppSettingsDto {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    terminalShell:
      typeof record.terminalShell === 'string' && TERMINAL_SHELLS.has(record.terminalShell as TerminalShellDto)
        ? (record.terminalShell as TerminalShellDto)
        : DEFAULT_APP_SETTINGS.terminalShell,
    httpProxy: normalizeProxy(record.httpProxy),
    hardwareAcceleration: record.hardwareAcceleration !== false,
    notifications: record.notifications !== false,
    notificationSound: record.notificationSound !== false,
    closeToTray: record.closeToTray === true,
    keepAwake: record.keepAwake === true,
    interactionBehavior:
      record.interactionBehavior === 'steer' || record.interactionBehavior === 'queue'
        ? record.interactionBehavior
        : DEFAULT_APP_SETTINGS.interactionBehavior,
    agentMode:
      typeof record.agentMode === 'string' && AGENT_MODES.has(record.agentMode as AgentModeDto)
        ? (record.agentMode as AgentModeDto)
        : DEFAULT_APP_SETTINGS.agentMode,
    autoContinueQuestions: record.autoContinueQuestions === true,
    showThinking: record.showThinking !== false,
    showTodos: record.showTodos !== false,
    autoArchive: record.autoArchive === true,
    archiveRetentionDays: clampRetentionDays(record.archiveRetentionDays),
    dataPath: typeof record.dataPath === 'string' ? record.dataPath : '',
    projects: normalizeProjects(record.projects),
    sandboxEnabled: record.sandboxEnabled === true,
  };
}

/** 一次性读取设置文件（无副作用、不抛错）：供 app ready 前的启动判定使用。 */
export function loadAppSettingsFile(filePath: string): AppSettingsDto {
  try {
    return normalizeAppSettings(JSON.parse(readFileSync(filePath, 'utf8')));
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

type Listener = (settings: AppSettingsDto) => void;

export class AppSettingsStore {
  private readonly filePath: string;
  private settings: AppSettingsDto;
  private readonly listeners = new Set<Listener>();

  constructor(filePath: string) {
    this.filePath = filePath;
    this.settings = loadAppSettingsFile(filePath);
  }

  get(): AppSettingsDto {
    return this.settings;
  }

  /** 部分更新：合并 → 归一化 → 落盘 → 通知订阅者。返回归一化后的完整设置。 */
  update(patch: Partial<AppSettingsDto>): AppSettingsDto {
    const next = normalizeAppSettings({ ...this.settings, ...patch });
    this.settings = next;
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(next, null, 2), 'utf8');
    } catch (error) {
      console.error('[app-settings] 写入失败：', error);
    }
    for (const listener of this.listeners) listener(next);
    return next;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
