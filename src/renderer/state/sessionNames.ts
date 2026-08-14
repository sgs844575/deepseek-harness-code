import { useSyncExternalStore } from 'react';

/**
 * 会话本地别名（重命名）：纯客户端覆盖层，叠加在 session/title 事件标题之上。
 * harness 持久化暂无重命名接口，别名存 localStorage；后续 harness 支持时可平滑迁移。
 */

const STORAGE_KEY = 'dshc.session-names.v1';

function load(): Record<string, string> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    const names: Record<string, string> = {};
    for (const [id, name] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof name === 'string' && name.trim().length > 0) names[id] = name.trim();
    }
    return names;
  } catch {
    return {};
  }
}

let names: Record<string, string> = load();
const listeners = new Set<() => void>();

function publish(next: Record<string, string>): void {
  names = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  } catch {
    // 写入失败仅影响持久化，本次会话仍生效。
  }
  for (const notify of listeners) notify();
}

export function getSessionNames(): Record<string, string> {
  return names;
}

export function setSessionName(sessionId: string, name: string): void {
  const trimmed = name.trim();
  const next = { ...names };
  if (trimmed.length === 0) delete next[sessionId];
  else next[sessionId] = trimmed;
  publish(next);
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  }
}

/** React hook：读会话别名表并订阅变更。 */
export function useSessionNames(): Record<string, string> {
  return useSyncExternalStore(subscribe, getSessionNames);
}
