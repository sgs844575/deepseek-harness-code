import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, SessionUiState, ToolCallItem } from '../state/sessionStore';
import { renderMarkdown } from '../markdown/render';
import { buildEditDiff, isEditTool, type EditDiffView } from './editDiff';

/**
 * 对话流（Cherry Studio 风格）：助手消息 = 左头像 + 无底色正文（工具卡
 * 随正文纵向排列）；用户消息 = 右侧浅色气泡 + 右头像。消息操作按钮
 * （复制）hover 才浮现。showThinking 关闭时每轮仅展示第一次思考。
 */
export function ChatView({
  state,
  hostReady,
  showThinking,
}: {
  state: SessionUiState;
  hostReady: boolean;
  showThinking: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [state.messages, state.running]);

  /** 关闭思考时：每轮第一个含思考的消息仍展示（其余隐藏）。 */
  const firstReasoningByTurn = useMemo(() => {
    if (showThinking) return null;
    const visible = new Set<string>();
    let seenInTurn = false;
    for (const message of state.messages) {
      if (message.role === 'user') {
        seenInTurn = false;
        continue;
      }
      if (message.role === 'assistant' && message.reasoning.length > 0 && !seenInTurn) {
        visible.add(message.id);
        seenInTurn = true;
      }
    }
    return visible;
  }, [state.messages, showThinking]);

  return (
    <div className="chat">
      <div className="chat__scroll">
        {state.messages.length === 0 && (
          <div className="chat__empty">
            {hostReady ? '向 DeepSeek agent 提问，开始你的第一轮任务。' : '正在连接 harness…'}
          </div>
        )}
        {state.messages.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            showReasoning={showThinking || (firstReasoningByTurn?.has(message.id) ?? false)}
          />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function MessageRow({ message, showReasoning }: { message: ChatMessage; showReasoning: boolean }) {
  if (message.role === 'error') {
    return <div className="msg msg--error"><div className="msg__error">{message.text}</div></div>;
  }
  const isAssistant = message.role === 'assistant';
  return (
    <div className={`msg msg--${message.role}`}>
      <span className={`msg__avatar msg__avatar--${message.role}`} aria-hidden>
        {isAssistant ? <AssistantGlyph /> : '你'}
      </span>
      <div className="msg__col">
        {isAssistant && showReasoning && message.reasoning.length > 0 && (
          <details className="msg__reasoning">
            <summary>思考过程</summary>
            <pre>{message.reasoning}</pre>
          </details>
        )}
        {isAssistant ? (
          <div
            className="msg__text markdown"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
          />
        ) : (
          <div className="msg__bubble">{message.text.length > 0 ? message.text : '…'}</div>
        )}
        {message.tools.map((tool) => (
          <ToolCard key={tool.callId} tool={tool} />
        ))}
        {(message.usageText.length > 0 || message.text.length > 0) && (
          <div className="msg__footer">
            {message.usageText.length > 0 && <span className="msg__usage">{message.usageText}</span>}
            {message.text.length > 0 && <CopyButton text={message.text} />}
          </div>
        )}
      </div>
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

function ToolCard({ tool }: { tool: ToolCallItem }) {
  const statusLabel =
    tool.status === 'running' ? '运行中' : tool.status === 'error' ? '失败' : '完成';
  const diff = isEditTool(tool.name) ? buildEditDiff(tool.name, tool.argumentsText) : null;

  return (
    <details className={`toolcard toolcard--${tool.status}`}>
      <summary>
        <code>{tool.name}</code>
        {diff !== null && <span className="toolcard__path" title={diff.path}>{diff.path}</span>}
        <span className="toolcard__status">{statusLabel}</span>
      </summary>
      {diff !== null ? (
        <DiffBlock diff={diff} />
      ) : (
        tool.argumentsText.length > 0 && (
          <pre className="toolcard__section">{tool.argumentsText}</pre>
        )
      )}
      {tool.resultText.length > 0 && (
        <pre className="toolcard__section toolcard__section--result">{tool.resultText}</pre>
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
        <span className="toolcard__path" style={{ flex: 1 }} title={diff.path}>
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

function AssistantGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="4.4" stroke="currentColor" strokeWidth="2.1" />
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.4" opacity="0.45" />
    </svg>
  );
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
