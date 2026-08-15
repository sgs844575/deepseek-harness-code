import { describe, expect, it } from 'vitest';
import { groupRounds } from './ChatView';
import type { ChatMessage } from '../state/sessionStore';

function message(id: string, role: ChatMessage['role'], text = ''): ChatMessage {
  return {
    id,
    role,
    text,
    reasoning: '',
    streaming: false,
    usageText: '',
    tools: [],
  };
}

describe('groupRounds（按用户消息切轮）', () => {
  it('每条用户消息开启新一轮，其后助手/错误消息归入该轮', () => {
    const rounds = groupRounds([
      message('u1', 'user', '第一个问题'),
      message('a1', 'assistant', '回答一'),
      message('a2', 'assistant', '补充'),
      message('e1', 'error', '出错'),
      message('u2', 'user', '追问'),
      message('a3', 'assistant', '回答二'),
    ]);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]?.user?.id).toBe('u1');
    expect(rounds[0]?.items.map((item) => item.id)).toEqual(['a1', 'a2', 'e1']);
    expect(rounds[1]?.user?.id).toBe('u2');
    expect(rounds[1]?.items.map((item) => item.id)).toEqual(['a3']);
  });

  it('首条用户消息之前的内容形成无锚点前导片段', () => {
    const rounds = groupRounds([message('e0', 'error', '启动失败'), message('u1', 'user', '问题')]);
    expect(rounds).toHaveLength(2);
    expect(rounds[0]?.user).toBeNull();
    expect(rounds[0]?.items.map((item) => item.id)).toEqual(['e0']);
    expect(rounds[1]?.user?.id).toBe('u1');
  });

  it('运行中插话（轮内再出现用户消息）开启新一轮，后续产出归属新轮', () => {
    const rounds = groupRounds([
      message('u1', 'user', '任务'),
      message('a1', 'assistant', '处理中'),
      message('u2', 'user', '插话补充'),
      message('a2', 'assistant', '按插话继续'),
    ]);
    expect(rounds).toHaveLength(2);
    expect(rounds[1]?.user?.text).toBe('插话补充');
    expect(rounds[1]?.items[0]?.id).toBe('a2');
  });

  it('空消息列表返回空轮次', () => {
    expect(groupRounds([])).toEqual([]);
  });
});
