import type { SessionEvent, SessionInspection } from './harness-context.js';

/**
 * 会话派生（fork）的纯函数部分：从父会话事件流中截取可作种子的
 * 「已完成回合前缀」。
 *
 * 语义对齐 harness subagent-fork-in-process 的 completedTurnPrefix：
 * 种子必须结束于最后一个 turn/end——进行中的回合不成对，无法作为
 * 合法子会话回放；没有任何已完成回合时返回空（= 全新会话）。
 * 持久化事件 seq === 数组下标（追加契约），切片天然从 0 连续。
 */
export function completedTurnPrefix(events: SessionEvent[]): SessionEvent[] {
  let lastEndIndex = -1;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === 'turn/end') {
      lastEndIndex = i;
      break;
    }
  }
  if (lastEndIndex === -1) return [];
  return events.slice(0, lastEndIndex + 1);
}

/**
 * 会话实际运行的 Agent 预设（dsh-agent-presets resolveSessionPreset 语义的
 * 本地实现）：头部记录的是「以什么开始」，空白期的 agent-preset/selected
 * 事件（最后一条胜出）才是「实际运行」——所有重建路径（resume / fork /
 * 选择器摘要）都必须走解析而非直接读头部。
 */
export function resolveSessionPreset(inspection: SessionInspection): string | undefined {
  for (let i = inspection.events.length - 1; i >= 0; i -= 1) {
    const event = inspection.events[i];
    if (event?.type !== 'agent-preset/selected') continue;
    const preset = (event.data as { agentPreset?: unknown } | undefined)?.agentPreset;
    if (typeof preset === 'string') return preset;
  }
  return inspection.meta.agentPreset;
}
