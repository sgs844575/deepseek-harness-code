import { describe, expect, it } from 'vitest';
import { buildSessionMarkdown, exportFileName } from './sessionExport';
import { foldEvents, initialSessionState } from './sessionStore';
import type { SessionEventDto } from '../../shared/protocol.js';

function event(type: string, data: unknown, seq = 0): SessionEventDto {
  return { type, seq, time: 0, data };
}

describe('buildSessionMarkdown', () => {
  it('导出用户/助手/思考/工具/错误的结构化 Markdown', () => {
    const state = foldEvents(initialSessionState(), [
      event('user/message', { message: { id: 'u1', role: 'user', content: [{ type: 'text', text: '改一下' }], source: { kind: 'user' } } }, 1),
      event('turn/start', { turn: 1 }, 2),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{"command":"echo hi"}' }, 3),
      event('tool/result', {
        turn: 1, step: 1,
        message: { id: 't1', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'hi' }] }] },
      }, 4),
      event('assistant/chunk', { turn: 1, step: 2, chunk: { type: 'text-delta', index: 0, text: '完成' } }, 5),
      event('assistant/message', {
        turn: 1, step: 2,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: '完成' }], source: { kind: 'model' } },
        usage: { inputTokens: 1, outputTokens: 2 },
      }, 6),
      event('turn/end', { turn: 1, reason: { kind: 'stop' } }, 7),
    ]);
    const markdown = buildSessionMarkdown(state, 'session-x');
    expect(markdown).toContain('## 用户');
    expect(markdown).toContain('改一下');
    expect(markdown).toContain('## 助手');
    expect(markdown).toContain('**工具 `pwsh`**');
    expect(markdown).toContain('↑1 ↓2 tokens');
  });

  it('工具结果包含三连反引号时自动抬高围栏', () => {
    const state = foldEvents(initialSessionState(), [
      event('turn/start', { turn: 1 }, 1),
      event('tool/call', { turn: 1, step: 1, callId: 'c1', name: 'pwsh', arguments: '{}' }, 2),
      event('tool/result', {
        turn: 1, step: 1,
        message: { id: 't1', role: 'user', content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: '```\ninner\n```' }] }] },
      }, 3),
    ]);
    const markdown = buildSessionMarkdown(state, 'session-x');
    // 三连反引号内容必须包在四连围栏里，避免截断 Markdown。
    expect(markdown).toContain('````\n```\ninner\n```\n````');
  });
});

describe('exportFileName', () => {
  it('优先标题并清洗 Windows 非法字符；无标题回退会话 id', () => {
    const titled = { ...initialSessionState(), title: '重构: "核心"模块?' };
    expect(exportFileName(titled, 'session-x')).toBe('重构_ _核心_模块_.md');
    expect(exportFileName(initialSessionState(), 'session-x')).toBe('session-x.md');
  });
});
