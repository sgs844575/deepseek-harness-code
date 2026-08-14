import { useCallback, useSyncExternalStore } from 'react';

/**
 * 外观偏好存储：主题（浅色/深色/跟随系统）+ 界面/等宽字体 + 基础字号。
 *
 * 外观属于客户端本地偏好，不进 harness 设置文档，直接落 localStorage。
 * 写入即生效：applyAppearance 把解析结果写到 <html> 的 data-theme 与
 * CSS 自定义属性上，全部样式经 token 消费，无需逐组件传参。
 */

export type ThemeMode = 'system' | 'light' | 'dark';

export interface AppearanceSettings {
  theme: ThemeMode;
  /** 界面字体（CSS font-family 值；空串 = 默认系统栈）。 */
  uiFont: string;
  /** 等宽字体（空串 = 内置 JetBrains Mono 栈）。 */
  monoFont: string;
  /** 基础字号（px，12–18）。 */
  fontSize: number;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  theme: 'system',
  uiFont: '',
  monoFont: '',
  fontSize: 14,
};

/** 界面字体预设：值为空串表示默认栈。 */
export const UI_FONT_PRESETS: { label: string; value: string }[] = [
  { label: '系统默认', value: '' },
  { label: 'Segoe UI', value: "'Segoe UI'" },
  { label: '微软雅黑', value: "'Microsoft YaHei'" },
  { label: '霞鹜文楷等宽', value: "'LXGW WenKai Mono'" },
];

/** 等宽字体预设：值为空串表示 JetBrains Mono（内置）。 */
export const MONO_FONT_PRESETS: { label: string; value: string }[] = [
  { label: 'JetBrains Mono（内置）', value: '' },
  { label: 'Cascadia Code', value: "'Cascadia Code'" },
  { label: 'Cascadia Mono', value: "'Cascadia Mono'" },
  { label: 'Consolas', value: 'Consolas' },
  { label: 'Courier New', value: "'Courier New'" },
];

const STORAGE_KEY = 'dshc.appearance.v1';
const FONT_UI_DEFAULT = "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif";
const FONT_MONO_DEFAULT = "'JetBrains Mono', 'Cascadia Code', Consolas, monospace";

function clampFontSize(size: unknown): number {
  const value = typeof size === 'number' ? size : Number(size);
  if (!Number.isFinite(value)) return DEFAULT_APPEARANCE.fontSize;
  return Math.min(18, Math.max(12, Math.round(value)));
}

function normalizeTheme(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

function load(): AppearanceSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_APPEARANCE };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_APPEARANCE };
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      theme: normalizeTheme(parsed.theme),
      uiFont: typeof parsed.uiFont === 'string' ? parsed.uiFont : '',
      monoFont: typeof parsed.monoFont === 'string' ? parsed.monoFont : '',
      fontSize: clampFontSize(parsed.fontSize),
    };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

let settings: AppearanceSettings = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // 隐私模式等场景写入失败可接受：仅本次会话生效。
  }
}

/** 把当前设置解析并写到文档根节点（data-theme + 字体/字号 token）。 */
function applyToDocument(next: AppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved =
    next.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : next.theme;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  root.style.setProperty('--font-ui', next.uiFont.length > 0 ? `${next.uiFont}, ${FONT_UI_DEFAULT}` : FONT_UI_DEFAULT);
  root.style.setProperty(
    '--font-mono',
    next.monoFont.length > 0 ? `${next.monoFont}, ${FONT_MONO_DEFAULT}` : FONT_MONO_DEFAULT,
  );
  root.style.setProperty('--font-size-base', `${clampFontSize(next.fontSize)}px`);
}

function publish(next: AppearanceSettings): void {
  settings = next;
  applyToDocument(next);
  persist();
  for (const notify of listeners) notify();
}

export function getAppearance(): AppearanceSettings {
  return settings;
}

export function updateAppearance(patch: Partial<AppearanceSettings>): void {
  publish({ ...settings, ...patch });
}

export function subscribeAppearance(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/**
 * 外观初始化 + 系统主题跟随。
 * 在 React 挂载前调用一次，避免首帧默认主题闪变；系统主题变化时自动重应用。
 */
export function initAppearance(): void {
  applyToDocument(settings);
  if (typeof window.matchMedia === 'function') {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    media.addEventListener('change', () => {
      if (settings.theme === 'system') applyToDocument(settings);
    });
  }
}

/** React hook：读外观设置并订阅变更。 */
export function useAppearance(): {
  appearance: AppearanceSettings;
  update: (patch: Partial<AppearanceSettings>) => void;
} {
  const appearance = useSyncExternalStore(subscribeAppearance, getAppearance);
  const update = useCallback((patch: Partial<AppearanceSettings>) => updateAppearance(patch), []);
  return { appearance, update };
}

/** 当前解析后的实际主题（'light' | 'dark'），供快捷切换按钮判断图标。 */
export function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}
