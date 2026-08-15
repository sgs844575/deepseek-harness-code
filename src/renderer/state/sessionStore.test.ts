import { describe, expect, it } from 'vitest';
import { foldEvent, foldEvents, initialSessionState } from './sessionStore';
import type { SessionEventDto } from '../../shared/protocol.js';

function event(type: string, data: unknown, seq = 0, time = 0): SessionEventDto {
  return { type, seq, time, data };
}

describe('sessionStore fold', () => {
  it('真人用户消息渲染为气泡，插件注入的 runtime-context 被跳过', () => {
    const state = foldEvents(initialSessionState(), [
      event('user/message', {
        message: { id: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } },
      }, 1),
      event('user/message', {
        message: { id: 'p1', role: 'user', content: [{ type: 'text', text: 'runtime context' }], source: { kind: 'plugin' } },
      }, 2),
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: 'u1', role: 'user', text: '你好' });
  });

  it('摊平形态的 user/message（消息字段在 data 根上，harness 实际广播/持久化形态）同样渲染', () => {
    const state = foldEvents(initialSessionState(), [
      event('user/message', {
        id: 'u2',
        role: 'user',
        content: [{ type: 'text', text: '摊平形态' }],
        source: { kind: 'user' },
      }, 1),
      event('user/message', {
        id: 'p2',
        role: 'user',
        content: [{ type: 'text', text: 'injected' }],
        source: { kind: 'plugin' },
      }, 2),
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: 'u2', role: 'user', text: '摊平形态' });
  });

  it('同一 user 消息重复投递（inbox 回执回放）会按 id 去重', () => {
    const message = { id: 'u1', role: 'user', content: [{ type: 'text', text: '你好' }], source: { kind: 'user' } };
    const state = foldEvents(initialSessionState(), [
      event('user/message', { message }, 1),
      event('user/message', { message }, 2),
    ]);
    expect(state.messages).toHaveLength(1);
  });

  it('思考耗时：首个 reasoning 增量到消息落定（回放路径同构）', () => {
    const state = foldEvents(initialSessionState(), [
      event('assistant/chunk', { chunk: { type: 'reasoning-delta', text: '想' } }, 1, 1000),
      event('assistant/chunk', { chunk: { type: 'reasoning-delta', text: '考' } }, 2, 2500),
      event('assistant/message', {
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '答' }], source: { kind: 'model' } },
        usage: { inputTokens: 10, outputTokens: 5 },
      }, 3, 4200),
    ]);
    expect(state.messages[0]?.reasoningDurationMs).toBe(3200);
    // 无思考的消息不产生耗时。
    const plain = foldEvent(initialSessionState(), event('assistant/message', {
      message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '答' }], source: { kind: 'model' } },
    }, 1, 9000));
    expect(plain.messages[0]?.reasoningDurationMs).toBeUndefined();
  });

  it('assistant/chunk 增量累计正文与思考，assistant/message 落定最终值', () => {
    const state = foldEvents(initialSessionState(), [
      event('turn/start', { turn: 1 }, 1),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '思考' } }, 2),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: '你' } }, 3),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: '好' } }, 4),
      event('assistant/message', {
        turn: 1,
        step: 1,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '你好！' }], source: { kind: 'model' } },
        usage: { inputTokens: 10, outputTokens: 5 },
      }, 5),
      event('turn/end', { turn: 1, reason: { kind: 'stop' } }, 6),
    ]);
    expect(state.messages).toHaveLength(1);
    const assistant = state.messages[0];
    expect(assistant).toMatchObject({ role: 'assistant', text: '你好！', reasoning: '思考', streaming: false });
    expect(assistant.usageText).toBe('↑10 ↓5 tokens');
    expect(state.running).toBe(false);
  });

  it('contextTokens 跟随最近一次请求的 inputTokens（无 usage 时保持上一值）', () => {
    const base = foldEvents(initialSessionState(), [
      event('assistant/message', {
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '一' }], source: { kind: 'model' } },
        usage: { inputTokens: 1000, outputTokens: 50 },
      }, 1),
    ]);
    expect(base.contextTokens).toBe(1000);
    expect(base.lastOutputTokens).toBe(50);
    expect(base.totalOutputTokens).toBe(50);
    // 下一条消息没有 usage：保持上一值（不误清零）。
    const kept = foldEvent(base, event('assistant/message', {
      message: { id: 'a2', role: 'assistant', content: [{ type: 'text', text: '二' }], source: { kind: 'model' } },
    }, 2));
    expect(kept.contextTokens).toBe(1000);
    expect(kept.lastOutputTokens).toBe(50);
    expect(kept.totalOutputTokens).toBe(50);
    // 再来一条带 usage：最近输出刷新，累计叠加。
    const next = foldEvent(kept, event('assistant/message', {
      message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: '三' }], source: { kind: 'model' } },
      usage: { inputTokens: 1200, outputTokens: 30 },
    }, 3));
    expect(next.lastOutputTokens).toBe(30);
    expect(next.totalOutputTokens).toBe(80);
    // 压缩后新请求的 inputTokens 回落（上下文变小）。
    const shrunk = foldEvent(kept, event('assistant/message', {
      message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: '三' }], source: { kind: 'model' } },
      usage: { inputTokens: 300, outputTokens: 20 },
    }, 3));
    expect(shrunk.contextTokens).toBe(300);
  });

  it('assistant/message 同时携带 reasoning 与 text 块时，思考不得混入正文（思考只显示一次）', () => {
    const state = foldEvents(initialSessionState(), [
      event('turn/start', { turn: 1 }, 1),
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '想' } }, 2),
      event('assistant/message', {
        turn: 1,
        step: 1,
        message: {
          id: 'a1',
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '完整的思考过程' },
            { type: 'text', text: '正式回答' },
          ],
          source: { kind: 'model' },
        },
      }, 3),
      event('turn/end', { turn: 1, reason: { kind: 'stop' } }, 4),
    ]);
    const assistant = state.messages[0];
    expect(assistant.text).toBe('正式回答');
    expect(assistant.reasoning).toBe('完整的思考过程');
  });

  it('工具调用与结果折叠为工具卡（callId 从 tool-result 块内提取）', () => {
    const state = foldEvents(initialSessionState(), [
      event('turn/start', { turn: 1 }, 1),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"echo hi"}' }, 2),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 't1',
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'hi' }] }],
          source: { kind: 'tool', callId: 'c1' },
        },
      }, 3),
      event('turn/end', { turn: 1, reason: { kind: 'stop' } }, 4),
    ]);
    const assistant = state.messages.find((message) => message.role === 'assistant');
    expect(assistant?.tools).toHaveLength(1);
    expect(assistant?.tools[0]).toMatchObject({ callId: 'c1', name: 'pwsh', status: 'done', resultText: 'hi' });
  });

  it('工具失败结果标记 error 并携带错误信息', () => {
    const state = foldEvents(initialSessionState(), [
      event('turn/start', { turn: 1 }, 1),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '' }, 2),
      event('tool/result', {
        turn: 1,
        step: 1,
        message: {
          id: 't1',
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'boom' }] }],
          source: { kind: 'tool', callId: 'c1' },
        },
        error: { name: 'ToolError', code: 'X' },
      }, 3),
    ]);
    const assistant = state.messages.find((message) => message.role === 'assistant');
    expect(assistant?.tools[0].status).toBe('error');
    expect(assistant?.tools[0].resultText).toContain('ToolError');
  });

  it('真实事件序（assistant/message 先落定、tool/call 随后）：工具挂回该消息，各步骤按时间线成独立消息', () => {
    const state = foldEvents(initialSessionState(), [
      event('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: '查版本' }], source: { kind: 'user' } } }, 1),
      event('turn/start', { turn: 1 }, 2),
      // step 1：reasoning → 消息落定 → 工具调用（真实序：message 先于 tool/call）
      event('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '找文件' } }, 3),
      event('assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'reasoning', text: '找文件' }], source: { kind: 'model' } } }, 4),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'glob', arguments: '{}' }, 5),
      event('tool/result', {
        turn: 1, step: 1,
        message: { id: 't1', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'package.json' }] }], source: { kind: 'tool', callId: 'c1' } },
      }, 6),
      // step 2：新的独立消息（reasoning + 工具）
      event('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'reasoning-delta', index: 0, text: '读取' } }, 7),
      event('assistant/message', { turn: 1, step: 2, message: { id: 'a2', role: 'assistant', content: [{ type: 'reasoning', text: '读取' }], source: { kind: 'model' } } }, 8),
      event('tool/call', { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{}' }, 9),
      event('tool/result', {
        turn: 1, step: 2,
        message: { id: 't2', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c2', content: [{ type: 'text', text: 'version 0.1.1' }] }], source: { kind: 'tool', callId: 'c2' } },
      }, 10),
      // step 3：最终文本（不带工具）
      event('assistant/chunk', { turn: 1, step: 3, chunk: { type: 'text-delta', index: 1, text: '版本是 0.1.1' } }, 11),
      event('assistant/message', { turn: 1, step: 3, message: { id: 'a3', role: 'assistant', content: [{ type: 'text', text: '版本是 0.1.1' }], source: { kind: 'model' } } }, 12),
      event('turn/end', { turn: 1, reason: { kind: 'stop' } }, 13),
    ]);
    const assistants = state.messages.filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(3);
    // 工具挂回它所属步骤的消息（而不是被推给下一条新消息）。
    expect(assistants[0]).toMatchObject({ reasoning: '找文件', text: '' });
    expect(assistants[0].tools[0]).toMatchObject({ callId: 'c1', status: 'done', resultText: 'package.json' });
    expect(assistants[1]).toMatchObject({ reasoning: '读取' });
    expect(assistants[1].tools[0]).toMatchObject({ callId: 'c2', status: 'done' });
    // 最终文本是独立消息且不携带工具 → 时间线顺序 = 消息顺序。
    expect(assistants[2]).toMatchObject({ text: '版本是 0.1.1', tools: [] });
  });

  it('turn/end 的错误以错误行呈现', () => {
    const state = foldEvent(
      initialSessionState(),
      event('turn/end', { turn: 1, reason: { kind: 'error', error: { message: '缺 API Key' } } }, 1),
    );
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ role: 'error', text: '错误: 缺 API Key' });
  });

  it('session/title 更新标题；历史回放与实时流走同一路径', () => {
    const events: SessionEventDto[] = [
      event('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } }, 1),
      event('session/title', { title: '打招呼', messageSeqs: [1], source: { kind: 'fallback' } }, 2),
    ];
    const state = foldEvents(initialSessionState(), events);
    expect(state.title).toBe('打招呼');
  });

  it('agent-preset/selected 空白期切换 last-wins；非法载荷忽略', () => {
    const state = foldEvents(initialSessionState(), [
      event('agent-preset/selected', { agentPreset: 'standard' }, 1),
      event('agent-preset/selected', { agentPreset: 'code' }, 2),
      event('agent-preset/selected', { agentPreset: '' }, 3),
      event('agent-preset/selected', {}, 4),
    ]);
    expect(state.agentPreset).toBe('code');
    // priming（创建回传的会话头预设）被后续切换事件覆盖；无事件时保持。
    expect(foldEvents({ ...initialSessionState(), agentPreset: 'plugin' }, [
      event('agent-preset/selected', { agentPreset: 'minimal' }, 1),
    ]).agentPreset).toBe('minimal');
  });


  it('todo/write 为整表替换快照：后写覆盖前写，实时与回放一致', () => {
    const state = foldEvents(initialSessionState(), [
      event('todo/write', { todos: [
        { content: '任务一', status: 'completed' },
        { content: '任务二', status: 'in_progress' },
      ] }, 1),
      event('todo/write', { todos: [
        { content: '任务二', status: 'completed' },
        { content: '任务三', status: 'pending' },
      ] }, 2),
    ]);
    expect(state.todos).toEqual([
      { content: '任务二', status: 'completed' },
      { content: '任务三', status: 'pending' },
    ]);
  });

  it('todo/write 非法条目被丢弃；空列表清空面板', () => {
    const state = foldEvents(initialSessionState(), [
      event('todo/write', { todos: [
        { content: '合法', status: 'pending' },
        { content: '', status: 'pending' },
        { content: '坏状态', status: 'doing' },
        'not-an-object',
      ] }, 1),
    ]);
    expect(state.todos).toEqual([{ content: '合法', status: 'pending' }]);

    const cleared = foldEvent(state, event('todo/write', { todos: [] }, 2));
    expect(cleared.todos).toEqual([]);
  });
});
