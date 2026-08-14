import { useSyncExternalStore } from 'react';

/**
 * 已归档会话清单（自动归档的客户端落地）。
 *
 * harness 没有归档接口，归档在本层表现为“从侧栏隐藏”：id 集合存 localStorage。
 * 数据不删除、历史可回放——将来 harness 提供归档面时可平滑迁移。
 */

const STORAGE_KEY = 'dshc.archived-sessions.v1';

function load(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}

let archived: Set<string> = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...archived]));
  } catch {
    // 写入失败仅影响持久化，本次会话仍生效。
  }
}

export function getArchivedSessions(): Set<string> {
  return archived;
}

export function archiveSessions(ids: string[]): void {
  mutate(ids, (next, id) => next.add(id));
}

/** 恢复归档会话（重新出现在侧栏）。 */
export function unarchiveSessions(ids: string[]): void {
  mutate(ids, (next, id) => next.delete(id));
}

function mutate(ids: string[], apply: (next: Set<string>, id: string) => void): void {
  if (ids.length === 0) return;
  const next = new Set(archived);
  let changed = false;
  for (const id of ids) {
    const before = next.size;
    apply(next, id);
    if (next.size !== before) changed = true;
  }
  if (!changed) return;
  archived = next;
  persist();
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** React hook：读归档集合并订阅变更。 */
export function useArchivedSessions(): Set<string> {
  return useSyncExternalStore(subscribe, getArchivedSessions);
}
