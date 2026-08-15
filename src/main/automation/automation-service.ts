import type { AppSettingsStore } from '../settings/app-settings-store.js';
import type { AutomationDto, AutomationScheduleDto } from '../../shared/protocol.js';
import type { HarnessService } from '../harness/harness-service.js';

/** 调度扫描间隔（毫秒）：30s 粒度对「分钟级」调度足够。 */
const TICK_MS = 30_000;

export interface AutomationServiceOptions {
  store: AppSettingsStore;
  /** harness 应答面：就绪判定 + 建会话 + 注入 prompt。 */
  harness: Pick<HarnessService, 'getState' | 'createSession' | 'prompt'>;
}

/**
 * 自动化调度服务：周期扫描 app-settings 的 automations，
 * 到点在当前工作区创建新会话并注入 prompt——结果进入会话流，
 * 即 Codex App「自动化」的本地形态（无云端收件箱，会话即结果）。
 *
 * 触发位语义：lastRunAt 只在实际触发（成功或失败）时推进；
 * harness 未就绪等情况跳过且不占位，下一轮 tick 自动重试。
 * 应用关闭期间错过的触发不补跑（到期只触发一次）。
 */
export class AutomationService {
  private readonly store: AutomationServiceOptions['store'];
  private readonly harness: AutomationServiceOptions['harness'];
  /** 正在触发的任务（防重入：触发改写 lastRunAt 前的同 tick 重复扫描）。 */
  private readonly firing = new Set<string>();
  private timer: NodeJS.Timeout | undefined;

  constructor(options: AutomationServiceOptions) {
    this.store = options.store;
    this.harness = options.harness;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 扫描一轮到期任务（定时器调用；测试/立即检查亦可直调，内部逐个等待完成）。 */
  async tick(): Promise<void> {
    const automations = this.store.get().automations;
    if (automations.length === 0) return;
    const now = Date.now();
    for (const automation of automations) {
      if (!automation.enabled || this.firing.has(automation.id)) continue;
      const from = automation.lastRunAt ?? automation.createdAt;
      if (now < nextRunAt(automation.schedule, from)) continue;
      await this.fire(automation);
    }
  }

  /** 触发一次任务：建会话 + 注入 prompt；结果写回 lastRun*（经 store 推送渲染层）。 */
  private async fire(automation: AutomationDto): Promise<void> {
    this.firing.add(automation.id);
    let status: string;
    try {
      if (this.harness.getState().status !== 'ready') {
        // 不占触发位：本轮跳过，下一 tick 重试。
        return;
      }
      const { sessionId } = await this.harness.createSession();
      await this.harness.prompt(sessionId, automation.prompt);
      status = 'ok';
    } catch (error) {
      status = `error：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.firing.delete(automation.id);
    }
    const list = this.store
      .get()
      .automations.map((item) =>
        item.id === automation.id ? { ...item, lastRunAt: Date.now(), lastRunStatus: status } : item,
      );
    this.store.update({ automations: list });
  }
}

/**
 * 下一次应触发的时间戳：from 之后（严格大于）最近的调度点。
 * - daily：每天 time；
 * - weekly：每周 weekday time；
 * - interval：from + minutes（滚动间隔）。
 */
export function nextRunAt(schedule: AutomationScheduleDto, from: number): number {
  if (schedule.type === 'interval') return from + schedule.minutes * 60_000;
  const [hourRaw, minuteRaw] = schedule.time.split(':');
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return Number.POSITIVE_INFINITY;
  const from_ = new Date(from);
  // 候选一：from 当天的调度时刻；已过则按类型步进（明天 / 下周）。
  const candidate = new Date(from_);
  candidate.setHours(hour, minute, 0, 0);
  if (schedule.type === 'weekly') {
    const target = Math.min(6, Math.max(0, Math.round(schedule.weekday)));
    let day = candidate;
    for (let step = 0; step < 8; step += 1) {
      if (day.getDay() === target && day.getTime() > from) return day.getTime();
      day = new Date(day.getTime() + 24 * 60 * 60 * 1000);
      day.setHours(hour, minute, 0, 0);
    }
    return Number.POSITIVE_INFINITY;
  }
  if (candidate.getTime() > from) return candidate.getTime();
  return candidate.getTime() + 24 * 60 * 60 * 1000;
}
