/**
 * SessionEvent → UI 状态的折叠（fold）器。
 *
 * 纯函数模块：实时流（assistant/chunk 增量）与历史回放（M4 的
 * sessionPersistence.inspect）走同一条折叠路径，保证两种来源渲染一致。
 */

import type { SessionEventDto } from '../../shared/protocol.js';

export interface ToolCallItem {
  callId: string;
  name: string;
  argumentsText: string;
  status: 'running' | 'done' | 'error';
  resultText: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  /** 正文（流式期间为增量累计，assistant/message 后为最终值）。 */
  text: string;
  /** 思考过程（reasoning 流）。 */
  reasoning: string;
  streaming: boolean;
  usageText: string;
  tools: ToolCallItem[];
}

/** todo/write 快照中的单个任务（@deepseek-ai/dsh-session TodoItem 的客户端视图）。 */
export interface TodoItemUi {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface SessionUiState {
  messages: ChatMessage[];
  running: boolean;
  /** 会话标题（session/title 事件；持久化回放同样产生）。 */
  title: string;
  /** 最新任务列表快照（todo/write 为整表替换，last-wins）。 */
  todos: TodoItemUi[];
}

export function initialSessionState(): SessionUiState {
  return { messages: [], running: false, title: '', todos: [] };
}

/* ──────────────────────────── 事件 data 的防御性收窄 ──────────────────────────── */

const TODO_STATUSES = new Set(['pending', 'in_progress', 'completed']);

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

/** todo/write 条目 → UI 视图（content 非空字符串 + 合法 status，否则丢弃）。 */
function toTodoItemUi(raw: unknown): TodoItemUi | null {
  const record = asRecord(raw);
  if (record === undefined) return null;
  const content = typeof record.content === 'string' ? record.content : '';
  const status = typeof record.status === 'string' ? record.status : '';
  if (content.length === 0 || !TODO_STATUSES.has(status)) return null;
  return { content, status: status as TodoItemUi['status'] };
}

interface BlockLike {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

interface MessageLike {
  id?: string;
  role?: string;
  content?: BlockLike[];
  source?: { kind?: string };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function blocksText(message: unknown): string {
  const record = asRecord(message);
  const content = record?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const b = asRecord(block);
      // reasoning 块的 text 属于思考过程（单独走 message.reasoning），不得混入正文，
      // 否则思考会在正文里再出现一次（“思考过程显示两边”）。
      return typeof b?.text === 'string' && b.type !== 'reasoning' ? b.text : '';
    })
    .join('');
}

function blocksReasoning(message: unknown): string {
  const record = asRecord(message);
  const content = record?.content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      const b = asRecord(block);
      return b?.type === 'reasoning' && typeof b.text === 'string' ? b.text : '';
    })
    .join('');
}

/** 从块列表提取文本：支持 text 块与 tool-result 块内嵌的 content 数组。 */
function collectBlockText(blocks: unknown[], parts: string[]): void {
  for (const raw of blocks) {
    const block = asRecord(raw);
    if (block === undefined) continue;
    if (typeof block.text === 'string' && block.type === 'text') {
      parts.push(block.text);
      continue;
    }
    if (typeof block.output === 'string') {
      parts.push(block.output);
      continue;
    }
    // tool-result 块的载荷在嵌套 content 数组里。
    if (Array.isArray(block.content)) {
      collectBlockText(block.content as unknown[], parts);
    }
  }
}

/** 工具结果文本：优先结构化文本字段，否则整体 JSON 化（截断）。 */
function resultText(message: unknown): string {
  const record = asRecord(message);
  if (Array.isArray(record?.content)) {
    const parts: string[] = [];
    collectBlockText(record.content as unknown[], parts);
    const joined = parts.filter((part) => part.length > 0).join('\n');
    if (joined.length > 0) {
      return joined.length > 4000 ? `${joined.slice(0, 4000)}\n…(截断)` : joined;
    }
  }
  try {
    const serialized = JSON.stringify(record ?? message, null, 2) ?? '';
    return serialized.length > 4000 ? `${serialized.slice(0, 4000)}\n…(截断)` : serialized;
  } catch {
    return String(message);
  }
}

/* ──────────────────────────── 折叠 ──────────────────────────── */

/** 找到（或创建）承接工具卡/增量文本的当前 assistant 消息。 */
function appendAssistantPlaceholder(state: SessionUiState, idHint: string): SessionUiState {
  const last = state.messages[state.messages.length - 1];
  if (last !== undefined && last.role === 'assistant' && last.streaming) return state;
  return {
    ...state,
    messages: [
      ...state.messages,
      { id: idHint, role: 'assistant', text: '', reasoning: '', streaming: true, usageText: '', tools: [] },
    ],
  };
}

function mapLastAssistant(
  state: SessionUiState,
  mutate: (message: ChatMessage) => ChatMessage,
): SessionUiState {
  const messages = [...state.messages];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      messages[i] = mutate(messages[i]);
      return { ...state, messages };
    }
  }
  return state;
}

export function foldEvent(state: SessionUiState, event: SessionEventDto): SessionUiState {
  const data = asRecord(event.data) ?? {};
  switch (event.type) {
    case 'user/message': {
      const message = data.message as MessageLike | undefined;
      // 只渲染真人输入；插件注入的 runtime-context 快照（source.kind === 'plugin'）跳过。
      if (message?.source?.kind !== 'user') return state;
      const text = blocksText(message);
      if (text.length === 0) return state;
      const id = typeof message?.id === 'string' ? message.id : `user-${event.seq}`;
      // inbox 投递回执可能造成同一消息重复出现（如 agent/inbox/spliced 配套回放），按 id 去重。
      if (state.messages.some((existing) => existing.id === id)) return state;
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id,
            role: 'user',
            text,
            reasoning: '',
            streaming: false,
            usageText: '',
            tools: [],
          },
        ],
      };
    }
    case 'assistant/chunk': {
      const chunk = asRecord(data.chunk);
      if (chunk === undefined) return state;
      const withPlaceholder = appendAssistantPlaceholder(state, `assistant-${event.seq}`);
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        return mapLastAssistant(withPlaceholder, (message) => ({
          ...message,
          text: message.text + chunk.text,
        }));
      }
      if (chunk.type === 'reasoning-delta' && typeof chunk.text === 'string') {
        return mapLastAssistant(withPlaceholder, (message) => ({
          ...message,
          reasoning: message.reasoning + chunk.text,
        }));
      }
      return withPlaceholder;
    }
    case 'assistant/message': {
      const message = data.message;
      const usage = asRecord(data.usage);
      const usageText =
        usage !== undefined
          ? `↑${String(usage.inputTokens ?? 0)} ↓${String(usage.outputTokens ?? 0)} tokens`
          : '';
      return mapLastAssistant(state, (existing) => ({
        ...existing,
        text: blocksText(message) || existing.text,
        reasoning: blocksReasoning(message) || existing.reasoning,
        streaming: false,
        usageText: usageText.length > 0 ? usageText : existing.usageText,
      }));
    }
    case 'session/title': {
      const title = typeof data.title === 'string' ? data.title : '';
      if (title.length === 0) return state;
      return { ...state, title };
    }
    case 'todo/write': {
      // harness 语义：每次携带完整替换列表（whole-value），折叠为 last-wins 快照。
      const todos = Array.isArray(data.todos) ? data.todos.map(toTodoItemUi).filter(nonNull) : [];
      return { ...state, todos };
    }
    case 'tool/call': {
      const withPlaceholder = appendAssistantPlaceholder(state, `assistant-${event.seq}`);
      const callId = typeof data.callId === 'string' ? data.callId : `call-${event.seq}`;
      const name = typeof data.name === 'string' ? data.name : 'unknown';
      const args = typeof data.arguments === 'string' ? data.arguments : '';
      return mapLastAssistant(withPlaceholder, (message) => ({
        ...message,
        tools: [
          ...message.tools,
          { callId, name, argumentsText: args, status: 'running', resultText: '' },
        ],
      }));
    }
    case 'tool/result': {
      // 关联 id 位于 ToolResultMessage.content[0]（tool-result 块）的 toolCallId 字段。
      const record = asRecord(data.message);
      const firstBlock = Array.isArray(record?.content)
        ? asRecord((record.content as unknown[])[0])
        : undefined;
      const callId =
        typeof firstBlock?.toolCallId === 'string'
          ? firstBlock.toolCallId
          : typeof firstBlock?.callId === 'string'
            ? firstBlock.callId
            : '';
      const error = asRecord(data.error);
      return mapLastAssistant(state, (message) => ({
        ...message,
        tools: message.tools.map((tool) =>
          tool.callId !== '' && tool.callId === callId
            ? {
                ...tool,
                status: error !== undefined ? 'error' : 'done',
                resultText:
                  error !== undefined
                    ? `${String(error.name ?? 'error')}: ${String(error.message ?? '')}\n${resultText(data.message)}`
                    : resultText(data.message),
              }
            : tool,
        ),
      }));
    }
    case 'turn/start':
      return { ...state, running: true };
    case 'turn/end': {
      // 回合级错误（如缺 API Key / 请求失败）以错误行呈现，避免“无声失败”。
      const reason = asRecord(data.reason);
      const error = asRecord(reason?.error);
      const errorText =
        reason?.kind === 'error' && error !== undefined
          ? `${typeof error.name === 'string' ? error.name : '错误'}: ${String(error.message ?? '')}`
          : '';
      const withError =
        errorText.length > 0
          ? {
              ...state,
              messages: [
                ...state.messages,
                {
                  id: `error-${event.seq}`,
                  role: 'error' as const,
                  text: errorText,
                  reasoning: '',
                  streaming: false,
                  usageText: '',
                  tools: [],
                },
              ],
            }
          : state;
      return {
        ...mapLastAssistant(withError, (message) => ({ ...message, streaming: false })),
        running: false,
      };
    }
    default:
      return state;
  }
}

export function foldEvents(state: SessionUiState, events: SessionEventDto[]): SessionUiState {
  return events.reduce(foldEvent, state);
}
