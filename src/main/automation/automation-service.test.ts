import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextRunAt, AutomationService } from './automation-service.js';
import { AppSettingsStore } from '../settings/app-settings-store.js';
import type { AutomationDto } from '../../shared/protocol.js';

/** 固定时区安全的时间构造（测试环境本地时区无关，字段显式给全）。 */
function at(year: number, month: number, day: number, hour: number, minute: number): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe('nextRunAt', () => {
  it('daily：当天时刻未过取当天，已过取明天', () => {
    const schedule = { type: 'daily', time: '09:00' } as const;
    expect(nextRunAt(schedule, at(2026, 8, 15, 8, 0))).toBe(at(2026, 8, 15, 9, 0));
    expect(nextRunAt(schedule, at(2026, 8, 15, 9, 0))).toBe(at(2026, 8, 16, 9, 0));
    expect(nextRunAt(schedule, at(2026, 8, 15, 10, 30))).toBe(at(2026, 8, 16, 9, 0));
  });

  it('weekly：取下一个目标 weekday 的调度时刻（不含 from 本身）', () => {
    // 2026-08-15 是周六（getDay()=6）；目标周一（1）。
    const schedule = { type: 'weekly', weekday: 1, time: '09:30' } as const;
    expect(nextRunAt(schedule, at(2026, 8, 15, 8, 0))).toBe(at(2026, 8, 17, 9, 30));
    // 周一当天已过时刻 → 下周一。
    expect(nextRunAt(schedule, at(2026, 8, 17, 10, 0))).toBe(at(2026, 8, 24, 9, 30));
  });

  it('interval：从基准点滚动 N 分钟', () => {
    const schedule = { type: 'interval', minutes: 30 } as const;
    expect(nextRunAt(schedule, at(2026, 8, 15, 9, 0))).toBe(at(2026, 8, 15, 9, 30));
  });
});

function tempStore(): { store: AppSettingsStore; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'dshc-automation-'));
  const store = new AppSettingsStore(path.join(dir, 'app-settings.json'));
  return { store, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function task(overrides: Partial<AutomationDto> = {}): AutomationDto {
  return {
    id: 't1',
    name: '每日简报',
    prompt: '总结今天的待办',
    schedule: { type: 'interval', minutes: 1 },
    enabled: true,
    createdAt: Date.now() - 10 * 60 * 1000,
    ...overrides,
  };
}

describe('AutomationService', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  it('到点触发：建会话并注入 prompt，写回 lastRun*', async () => {
    const { store, cleanup } = tempStore();
    cleanups.push(cleanup);
    const createSession = vi.fn(async () => ({ sessionId: 's1', agentPreset: 'plugin' }));
    const prompt = vi.fn(async () => undefined);
    const service = new AutomationService({
      store,
      harness: { getState: () => ({ status: 'ready', workspace: 'D:/x' }), createSession, prompt },
    });
    store.update({ automations: [task()] });
    await service.tick();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledWith('s1', '总结今天的待办');
    const saved = store.get().automations[0];
    expect(saved?.lastRunStatus).toBe('ok');
    expect(saved?.lastRunAt).toBeGreaterThan(0);
    // 已触发后：lastRunAt 推进，紧随的 tick 不再重复触发。
    await service.tick();
    expect(prompt.mock.calls.length).toBe(1);
  });

  it('harness 未就绪：跳过且不占用触发位，就绪后重试成功', async () => {
    const { store, cleanup } = tempStore();
    cleanups.push(cleanup);
    const createSession = vi.fn(async () => ({ sessionId: 's2' }));
    const prompt = vi.fn(async () => undefined);
    let ready = false;
    const service = new AutomationService({
      store,
      harness: {
        getState: () => ({ status: ready ? 'ready' : 'booting', workspace: 'D:/x' }),
        createSession,
        prompt,
      },
    });
    store.update({ automations: [task()] });
    await service.tick();
    expect(prompt).not.toHaveBeenCalled();
    expect(store.get().automations[0]?.lastRunAt).toBeUndefined();
    ready = true;
    await service.tick();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(store.get().automations[0]?.lastRunStatus).toBe('ok');
  });

  it('禁用的任务不触发', async () => {
    const { store, cleanup } = tempStore();
    cleanups.push(cleanup);
    const prompt = vi.fn(async () => undefined);
    const service = new AutomationService({
      store,
      harness: {
        getState: () => ({ status: 'ready', workspace: 'D:/x' }),
        createSession: async () => ({ sessionId: 's3' }),
        prompt,
      },
    });
    store.update({ automations: [task({ enabled: false })] });
    await service.tick();
    expect(prompt).not.toHaveBeenCalled();
  });
});
