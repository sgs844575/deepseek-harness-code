import { useEffect, useMemo, useRef, useState } from 'react';
import type { SubagentRunDto } from '../../shared/protocol.js';
import type { ChatMessage, SessionUiState, ToolCallItem } from '../state/sessionStore';
import { renderMarkdown } from '../markdown/render';
import { buildEditDiff, isEditTool, type EditDiffView } from './editDiff';
import { toolGlyphKind, toolSummary, type ToolGlyphKind } from './toolSummary';

/**
 * 对话流（回合分组式，Codex 参照）：一条用户消息 = 一轮的锚点，
 * 其后所有助手产出（思考条 / 正文 / 工具行 / 错误）都归属到该轮内连续
 * 排布——用户气泡右置，轮首一条元信息（回复数 · 工具数 · 运行态）加分隔线，
 * 轮内间距紧凑、轮间拉开。showThinking 关闭时每轮仅展示第一次思考。
 * 对话流尾部渲染父会话的子代理运行卡片（折叠展开子会话 transcript）。
 */

/** 一轮对话：锚点用户消息 + 归属其后的全部助手产出。 */
export interface ChatRound {
  key: string;
  /** 锚点用户消息；null = 首条用户消息之前的前导片段（如启动错误）。 */
  user: ChatMessage | null;
  items: ChatMessage[];
}

/** 扁平消息按用户消息切轮：每条用户消息开启新一轮，其余消息归入当前轮。 */
export function groupRounds(messages: ChatMessage[]): ChatRound[] {
  const rounds: ChatRound[] = [];
  let current: ChatRound | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      current = { key: message.id, user: message, items: [] };
      rounds.push(current);
      continue;
    }
    if (current === null) {
      current = { key: `prelude-${message.id}`, user: null, items: [] };
      rounds.push(current);
    }
    current.items.push(message);
  }
  return rounds;
}

export function ChatView({
  state,
  hostReady,
  showThinking,
  subagents = [],
  childStates = {},
}: {
  state: SessionUiState;
  hostReady: boolean;
  showThinking: boolean;
  /** 本会话的子代理运行（实时事件 + 冷目录合并）。 */
  subagents?: SubagentRunDto[];
  /** 全部会话状态桶（子代理 transcript 以 childSessionId 读取）。 */
  childStates?: Record<string, SessionUiState>;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [state.messages, state.running]);

  const rounds = useMemo(() => groupRounds(state.messages), [state.messages]);

  return (
    <div className="chat">
      <div className="chat__scroll">
        {state.messages.length === 0 && (
          <div className="chat__empty">
            {hostReady ? '向 DeepSeek agent 提问，开始你的第一轮任务。' : '正在连接 harness…'}
          </div>
        )}
        {rounds.map((round, index) => (
          <RoundView
            key={round.key}
            round={round}
            running={state.running && index === rounds.length - 1}
            showThinking={showThinking}
          />
        ))}
        {subagents.length > 0 &&
          subagents.map((run) => (
            <SubagentCard key={run.childSessionId} run={run} state={childStates[run.childSessionId]} />
          ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

/* ─────────────────────────── 回合 ─────────────────────────── */

function RoundView({
  round,
  running,
  showThinking,
}: {
  round: ChatRound;
  /** 本轮是最新一轮且回合运行中（元信息行显示运行态）。 */
  running: boolean;
  showThinking: boolean;
}) {
  /* 关闭思考时：本轮第一个含思考的消息仍展示（其余隐藏）。 */
  const firstReasoningId = useMemo(() => {
    if (showThinking) return null;
    const first = round.items.find(
      (message) => message.role === 'assistant' && message.reasoning.length > 0,
    );
    return first?.id ?? null;
  }, [round.items, showThinking]);

  const replyCount = round.items.filter((message) => message.role === 'assistant').length;
  const toolCount = round.items.reduce((count, message) => count + message.tools.length, 0);
  const userText = round.user?.text ?? '';

  return (
    <section className={`round${running ? ' round--running' : ''}`}>
      {round.user !== null && (
        <div className="round__user-row">
          <div className="round__user">{userText}</div>
        </div>
      )}
      <div className="round__thread">
        <div className="round__meta">
          <span>
            {replyCount > 0 ? `${replyCount} 段回复` : '等待回复'}
            {toolCount > 0 && ` · ${toolCount} 次工具`}
          </span>
          {running && (
            <span className="round__running">
              运行中
              <span className="msg__reasoning-dots" aria-hidden>
                <i /><i /><i />
              </span>
            </span>
          )}
          {userText.length > 0 && (
            <span className="round__meta-copy">
              <CopyButton text={userText} />
            </span>
          )}
        </div>
        <div className="round__body">
          {round.items.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              showReasoning={showThinking || firstReasoningId === message.id}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── 子代理卡片 ─────────────────────────── */

/** 结束原因 → 中文短语。 */
const END_REASON_LABELS: Record<string, string> = {
  completed: '已完成',
  aborted: '已中止',
  error: '出错',
  'max-tokens': '达到 token 上限',
  refusal: '拒绝执行',
};

function SubagentCard({ run, state }: { run: SubagentRunDto; state?: SessionUiState }) {
  const running = run.status === 'running';
  const reason =
    run.endReason !== undefined ? (END_REASON_LABELS[run.endReason] ?? run.endReason) : undefined;
  const label = run.label.length > 0 ? run.label : '子代理';
  const transcript = state?.messages ?? [];
  const toolCount = transcript.reduce((count, message) => count + message.tools.length, 0);
  return (
    <details className={`subagent${running ? ' subagent--running' : ''}`} open={running}>
      <summary>
        <span className="subagent__badge" aria-hidden>
          {transcript.length > 0 ? '🤖' : '⏳'}
        </span>
        <span className="subagent__label" title={label}>
          {label}
        </span>
        <span className="subagent__status">
          {running ? '运行中' : (reason ?? '已结束')}
          {toolCount > 0 && ` · ${toolCount} 次工具`}
        </span>
      </summary>
      <div className="subagent__body">
        {transcript.length === 0 ? (
          <div className="subagent__empty">
            {running ? '子代理已启动，等待事件流入…' : '（无可见输出）'}
          </div>
        ) : (
          transcript.map((message) =>
            message.role === 'user' ? (
              <div key={message.id} className="subagent__line subagent__line--user">
                <span className="subagent__who">任务</span>
                <span>{message.text}</span>
              </div>
            ) : message.role === 'error' ? (
              <div key={message.id} className="subagent__line subagent__line--error">
                {message.text}
              </div>
            ) : (
              <div key={message.id} className="subagent__line">
                <span className="subagent__who">
                  {message.tools.length > 0 ? `⚙ ${message.tools[message.tools.length - 1]?.name}` : '回复'}
                </span>
                <span>{message.text.length > 0 ? message.text : message.tools.map((tool) => tool.name).join(' · ')}</span>
              </div>
            ),
          )
        )}
        {run.summary !== undefined && run.summary.length > 0 && (
          <div className="subagent__summary" title={run.summary}>
            {run.summary}
          </div>
        )}
      </div>
    </details>
  );
}

/** 助手 / 错误消息行（用户消息由 RoundView 的气泡渲染）。 */
function MessageRow({ message, showReasoning }: { message: ChatMessage; showReasoning: boolean }) {
  if (message.role === 'error') {
    return <div className="msg msg--error"><div className="msg__error">{message.text}</div></div>;
  }
  const thinking = message.streaming && message.reasoning.length > 0;
  const durationSeconds =
    !thinking && message.reasoningDurationMs !== undefined && message.reasoningDurationMs > 0
      ? Math.max(1, Math.round(message.reasoningDurationMs / 1000))
      : null;
  return (
    <div className="msg">
      {showReasoning && message.reasoning.length > 0 && (
        <details className="msg__reasoning" open={message.streaming ? true : undefined}>
          <summary>
            <BrainIcon />
            <span className="msg__reasoning-label">{thinking ? '思考中' : '思考过程'}</span>
            {durationSeconds !== null && (
              <span className="msg__reasoning-time">持续了 {durationSeconds} 秒</span>
            )}
            {thinking && (
              <span className="msg__reasoning-dots" aria-hidden>
                <i /><i /><i />
              </span>
            )}
            <span className="msg__reasoning-chevron" aria-hidden>
              <ChevronRightSmallIcon />
            </span>
          </summary>
          <pre>{message.reasoning}</pre>
        </details>
      )}
      <div
        className="msg__text markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
      />
      {message.tools.map((tool) => (
        <ToolRow key={tool.callId} tool={tool} />
      ))}
      {(message.usageText.length > 0 || message.text.length > 0) && (
        <div className="msg__footer">
          {message.usageText.length > 0 && <span className="msg__usage">{message.usageText}</span>}
          {message.text.length > 0 && <CopyButton text={message.text} />}
        </div>
      )}
    </div>
  );
}

/** 复制按钮：hover 浮现；点击后短暂切换为对勾反馈。 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="msg__copy"
      title={copied ? '已复制' : '复制'}
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          })
          .catch(() => undefined);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? '已复制' : '复制'}
    </button>
  );
}

/** 工具行（zcode / Claude Code 式单行日志）：图标 + 动作摘要（单行截断）+
 * 运行/失败状态 + hover 显现的展开箭头；详情（diff / 参数 / 结果）在
 * 展开后的浅底圆角块中。 */
function ToolRow({ tool }: { tool: ToolCallItem }) {
  const summary = toolSummary(tool.name, tool.argumentsText);
  const diff = isEditTool(tool.name) ? buildEditDiff(tool.name, tool.argumentsText) : null;
  return (
    <details className={`toollow toollow--${tool.status}`}>
      <summary>
        <span className="toollow__icon" aria-hidden>
          <ToolGlyph kind={toolGlyphKind(tool.name)} />
        </span>
        <span className="toollow__text" title={`${tool.name} · ${summary}`}>{summary}</span>
        {tool.status === 'running' && (
          <span className="toollow__state toollow__state--running">运行中</span>
        )}
        {tool.status === 'error' && (
          <span className="toollow__state toollow__state--error">失败</span>
        )}
        <span className="toollow__chev" aria-hidden>
          <ChevronRightSmallIcon />
        </span>
      </summary>
      {(diff !== null || tool.argumentsText.length > 0 || tool.resultText.length > 0) && (
        <div className="toollow__body">
          {diff !== null ? (
            <DiffBlock diff={diff} />
          ) : (
            tool.argumentsText.length > 0 && (
              <pre className="toollow__args">{tool.argumentsText}</pre>
            )
          )}
          {tool.resultText.length > 0 && (
            <pre className="toollow__result">{tool.resultText}</pre>
          )}
        </div>
      )}
    </details>
  );
}

/** 增删行双色块：meta 行显示路径与 +n/−m 统计。 */
function DiffBlock({ diff }: { diff: EditDiffView }) {
  return (
    <div className="diff">
      <div className="diff__meta">
        <span>{diff.command}</span>
        <span className="diff__path" style={{ flex: 1 }} title={diff.path}>
          {diff.path}
        </span>
        {diff.add.length > 0 && <span className="diff__meta-add">+{diff.add.length}</span>}
        {diff.del.length > 0 && <span className="diff__meta-del">−{diff.del.length}</span>}
      </div>
      <div className="diff__body">
        {diff.del.map((line, index) => (
          <div key={`d${index}`} className="diff__line diff__line--del">
            <span className="diff__line-sign">−</span>
            <span>{line}</span>
          </div>
        ))}
        {diff.add.map((line, index) => (
          <div key={`a${index}`} className="diff__line diff__line--add">
            <span className="diff__line-sign">+</span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- 内联 SVG 图标 ---- */

/** 思考图标（大脑轮廓，Cherry Studio 同款意象）。 */
function BrainIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9.5 4A2.5 2.5 0 0 0 7 6.5v.55A3 3 0 0 0 4.6 9.2 2.5 2.5 0 0 0 5.9 13a3 3 0 0 0 .83 4.6A2.5 2.5 0 0 0 9.5 20a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 9.5 4Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M14.5 4A2.5 2.5 0 0 1 17 6.5v.55a3 3 0 0 1 2.4 2.15A2.5 2.5 0 0 1 18.1 13a3 3 0 0 1-.83 4.6A2.5 2.5 0 0 1 14.5 20a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 14.5 4Z"
        stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/** 思考条右侧小箭头（hover 显现，展开时旋转向下）。 */
function ChevronRightSmallIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9.5 6l6 6-6 6"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

/** 工具行图标（线性，颜色随行文字）。 */
function ToolGlyph({ kind }: { kind: ToolGlyphKind }) {
  switch (kind) {
    case 'terminal':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'search':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="6.2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M15.6 15.6L20.5 20.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'edit':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4.5 19.5l4-1L19.8 7.2a2 2 0 0 0-3-3L5.5 15.5l-1 4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
    case 'file':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 3.5h7.5L18.5 8.5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M13 3.5v5.5h5.5" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        </svg>
      );
    case 'agent':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
        </svg>
      );
    case 'mcp':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M9 3.5v4M15 3.5v4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M7.5 7.5h9a2 2 0 0 1 2 2v3.5a6.5 6.5 0 0 1-13 0V9.5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M12 19.5v1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'todo':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4.5 6.5l1.8 1.8 3.2-3.3M4.5 16.5l1.8 1.8 3.2-3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 7h6.5M13 17h6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
    case 'question':
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="8.8" stroke="currentColor" strokeWidth="1.7" />
          <path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path d="M12 16.8h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="7.5" cy="7.5" r="3.4" stroke="currentColor" strokeWidth="1.7" />
          <path d="M10 10.1L20.5 20.5M15.4 15.6l2.3-2.3M18.6 18.8L21 16.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      );
  }
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9" width="11" height="11" rx="2.4" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.5 14.6A2 2 0 0 1 4 12.7V6.4A2.4 2.4 0 0 1 6.4 4h6.3a2 2 0 0 1 1.9 1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.8 9.6 17.4 19 7.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
