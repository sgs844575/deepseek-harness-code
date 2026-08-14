/**
 * 会话最近活跃时间（本地记录，供自动归档判定“超过保留期”）。
 *
 * harness 会话头只有 createdAt；最后更新时间在本层维护：打开会话或收到
 * 该会话事件时刷新。写穿节流（60s）避免逐 token 写 localStorage。
 */

const STORAGE_KEY = 'dshc.session-activity.v1';
const PERSIST_INTERVAL_MS = 60_000;

function load(): Map<string, number> {
  if (typeof localStorage === 'undefined') return new Map();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Map();
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return new Map();
    const map = new Map<string, number>();
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const time = Number(value);
      if (Number.isFinite(time) && time > 0) map.set(id, time);
    }
    return map;
  } catch {
    return new Map();
  }
}

const activity: Map<string, number> = load();
let dirty = false;
let persistTimer: number | null = null;

function schedulePersist(): void {
  dirty = true;
  if (persistTimer !== null) return;
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    if (!dirty) return;
    dirty = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(activity)));
    } catch {
      // 写入失败仅影响持久化精度。
    }
  }, PERSIST_INTERVAL_MS);
}

/** 记录会话此刻活跃（打开 / 收到事件时调用）。 */
export function touchSessionActivity(sessionId: string): void {
  if (activity.get(sessionId) === undefined) {
    activity.set(sessionId, Date.now());
    schedulePersist();
    return;
  }
  // 已有记录：同分钟内不重复写内存，避免高频事件下的无谓脏标记。
  const previous = activity.get(sessionId) ?? 0;
  const now = Date.now();
  if (now - previous < 60_000) return;
  activity.set(sessionId, now);
  schedulePersist();
}

/** 会话最后活跃时间；从未在本机活跃过的会话回落 createdAt。 */
export function getSessionLastActive(sessionId: string, createdAt: number): number {
  return activity.get(sessionId) ?? createdAt;
}
