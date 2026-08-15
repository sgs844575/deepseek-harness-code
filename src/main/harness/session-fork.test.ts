import { describe, expect, it } from 'vitest';
import { completedTurnPrefix } from './session-fork.js';
import type { SessionEvent } from './harness-context.js';

function events(...types: string[]): SessionEvent[] {
  return types.map((type, index) => ({ type, seq: index, time: 0 }));
}

describe('completedTurnPrefix', () => {
  it('无 turn/end 时返回空（全新会话）', () => {
    expect(completedTurnPrefix(events('user/message', 'assistant/chunk'))).toEqual([]);
    expect(completedTurnPrefix([])).toEqual([]);
  });

  it('截取到最后一个 turn/end（含）；之后的事件丢弃', () => {
    const list = events(
      'user/message',
      'assistant/message',
      'turn/end',
      'user/message',
      'tool/call',
      'turn/end',
      'user/message',
      'tool/call',
    );
    const seed = completedTurnPrefix(list);
    expect(seed).toHaveLength(6);
    expect(seed[seed.length - 1]?.type).toBe('turn/end');
  });

  it('不修改输入（纯函数）', () => {
    const list = events('user/message', 'turn/end', 'user/message');
    completedTurnPrefix(list);
    expect(list).toHaveLength(3);
  });
});
