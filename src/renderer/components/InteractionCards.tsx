import { useState } from 'react';
import type { QuestionItemDto } from '../../shared/protocol.js';

export interface PendingApproval {
  id: string;
  toolName: string;
  reason?: string;
}

export interface ApprovalCardProps {
  approval: PendingApproval;
  onRespond(id: string, outcome: 'allowed-once' | 'rejected'): void;
}

/** 工具审批卡：允许一次 / 拒绝。 */
export function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  return (
    <div className="approval">
      <div className="approval__head">
        <span className="approval__title">工具审批请求</span>
        <code className="approval__tool">{approval.toolName}</code>
      </div>
      {approval.reason !== undefined && <div className="approval__reason">{approval.reason}</div>}
      <div className="approval__actions">
        <button
          type="button"
          className="approval__allow"
          onClick={() => onRespond(approval.id, 'allowed-once')}
        >
          允许一次
        </button>
        <button
          type="button"
          className="approval__reject"
          onClick={() => onRespond(approval.id, 'rejected')}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

export interface PendingQuestion {
  id: string;
  questions: QuestionItemDto[];
}

export interface QuestionCardProps {
  question: PendingQuestion;
  onRespond(id: string, answers: { id: string; selected: string[]; custom?: string }[]): void;
}

/** ask_user_question 卡片：选项（单/多选）或自由输入。 */
export function QuestionCard({ question, onRespond }: QuestionCardProps) {
  return <QuestionForm key={question.id} question={question} onRespond={onRespond} />;
}

function QuestionForm({ question, onRespond }: QuestionCardProps) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});

  const toggle = (questionId: string, label: string, multi: boolean): void => {
    setSelected((previous) => {
      const current = previous[questionId] ?? [];
      if (multi) {
        return {
          ...previous,
          [questionId]: current.includes(label)
            ? current.filter((item) => item !== label)
            : [...current, label],
        };
      }
      return { ...previous, [questionId]: current.includes(label) ? [] : [label] };
    });
  };

  const submit = (): void => {
    const answers = question.questions.map((item) => ({
      id: item.id,
      selected: selected[item.id] ?? [],
      ...(custom[item.id] !== undefined && custom[item.id].length > 0
        ? { custom: custom[item.id] }
        : {}),
    }));
    onRespond(question.id, answers);
  };

  return (
    <div className="approval approval--question">
      <div className="approval__head">
        <span className="approval__title">Agent 提问</span>
      </div>
      {question.questions.map((item) => (
        <div key={item.id} className="question">
          <div className="question__text">
            {item.header !== undefined && <span className="question__header">{item.header}</span>}
            {item.question}
          </div>
          {item.detail !== undefined && <div className="question__detail">{item.detail}</div>}
          {item.options !== undefined && item.options.length > 0 ? (
            <div className="question__options">
              {item.options.map((option) => {
                const active = (selected[item.id] ?? []).includes(option.label);
                return (
                  <button
                    type="button"
                    key={option.label}
                    className={`question__option${active ? ' question__option--active' : ''}`}
                    onClick={() => toggle(item.id, option.label, item.multiSelect === true)}
                    title={option.description}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              type="text"
              className="question__input"
              placeholder="输入回答…"
              value={custom[item.id] ?? ''}
              onChange={(event) =>
                setCustom((previous) => ({ ...previous, [item.id]: event.target.value }))
              }
            />
          )}
        </div>
      ))}
      <div className="approval__actions">
        <button type="button" className="approval__allow" onClick={submit}>
          提交回答
        </button>
      </div>
    </div>
  );
}
