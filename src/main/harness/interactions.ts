import { randomUUID } from 'node:crypto';
import type { AgentModeDto } from '../../shared/protocol.js';
import type { HarnessContext } from './harness-context.js';

/**
 * 人机交互桥：把 harness 的工具审批（approval/request 瀑布）与
 * ask_user_question（userQuestions provider）转发给渲染层，并把 UI 的
 * 决定写回对应的挂起 Promise。
 *
 * 审批门（tools/pre-execute）按 Agent 权限模式分派——完全复用 harness
 * 原生能力：ask = 变更类工具走 approval:ask（现状）；full = 全部放行
 * （配 approval:never）；plan = 变更类工具直接拒绝（配 harness plan-mode）。
 */

/** 变更类工具（读操作与 todo 直接放行）。 */
const ASK_TOOLS = new Set(['pwsh', 'write', 'edit', 'str_replace_editor']);

export interface QuestionItem {
  id: string;
  question: string;
  detail?: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

export type InteractionDto =
  | {
      kind: 'approval-requested';
      id: string;
      sessionId: string;
      toolName: string;
      reason?: string;
    }
  | { kind: 'approval-resolved'; id: string }
  | { kind: 'question-requested'; id: string; sessionId: string; questions: QuestionItem[] }
  | { kind: 'question-resolved'; id: string };

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

export interface QuestionAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

type Emit = (dto: InteractionDto) => void;

interface PendingApproval {
  sessionId: string;
  resolve(outcome: ApprovalOutcome): void;
}

interface PendingQuestion {
  resolve(answer: { answers: QuestionAnswer[] }): void;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

export class InteractionBridge {
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly questions = new Map<string, PendingQuestion>();
  /** 当前 Agent 权限模式（harness-service 注入的读取器）。 */
  private getMode: () => AgentModeDto = () => 'ask';

  /** 在 boot 的 prepare 阶段挂接（早于全部插件装载）：只允许注册事件监听。 */
  attach(ctx: HarnessContext, emit: Emit, getMode?: () => AgentModeDto): void {
    if (getMode !== undefined) this.getMode = getMode;
    // 审批门：按模式分派（ask → 变更类工具 ask；full → 放行；plan → 拒绝变更类）。
    ctx.on('tools/pre-execute', ((exec: { name: string }, next: () => Promise<unknown>) => {
      const mode = this.getMode();
      if (mode === 'full' || !ASK_TOOLS.has(exec.name)) return next();
      if (mode === 'plan') {
        return Promise.resolve({
          kind: 'deny',
          reason: '计划模式下禁止修改：请先完成调研并用 exit_plan_mode 提交计划，经用户确认后再执行修改。',
        });
      }
      return Promise.resolve({ kind: 'ask', reason: `工具 ${exec.name} 需要用户审批` });
    }) as never);

    // 审批应答器：挂起 Promise 等待 UI；回合取消（signal abort）自动撤单。
    // 本应答器总是认领请求（不调用 next()），因此渲染层缺席时的兜底由
    // approval 服务自身的 fail-closed 语义负责。
    ctx.on(
      'approval/request',
      (req: { agent: { id: string }; toolName: string; reason?: string; signal?: AbortSignal }, _next: () => Promise<unknown>) => {
        return new Promise<ApprovalOutcome>((resolve) => {
          const id = randomUUID();
          const settle = (outcome: ApprovalOutcome): void => {
            if (!this.approvals.delete(id)) return;
            emit({ kind: 'approval-resolved', id });
            resolve(outcome);
          };
          this.approvals.set(id, { sessionId: req.agent.id, resolve: settle });
          emit({
            kind: 'approval-requested',
            id,
            sessionId: req.agent.id,
            toolName: req.toolName,
            ...(req.reason !== undefined ? { reason: req.reason } : {}),
          });
          req.signal?.addEventListener(
            'abort',
            () => {
              settle('cancelled');
            },
            { once: true },
          );
        });
      },
    );
  }

  /**
   * boot 完成后挂接：服务面（userQuestions）此时才存在——prepare 阶段
   * 插件尚未装载，服务访问器会是 undefined。
   */
  attachLate(ctx: HarnessContext, emit: Emit): void {
    // 提问提供者：ask_user_question 工具的服务端。
    ctx.userQuestions.registerProvider({
      ask: (request: unknown): Promise<{ answers: QuestionAnswer[] }> => {
        const record = asRecord(request);
        const rawQuestions = Array.isArray(record?.questions) ? record.questions : [];
        const questions: QuestionItem[] = rawQuestions.map((raw, index) => {
          const item = asRecord(raw) ?? {};
          const options = Array.isArray(item.options)
            ? item.options.map((option) => {
                const o = asRecord(option) ?? {};
                return {
                  label: String(o.label ?? ''),
                  ...(typeof o.description === 'string' ? { description: o.description } : {}),
                };
              })
            : undefined;
          return {
            id: typeof item.id === 'string' ? item.id : `q${index}`,
            question: String(item.question ?? ''),
            ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
            ...(typeof item.header === 'string' ? { header: item.header } : {}),
            ...(options !== undefined && options.length > 0 ? { options } : {}),
            ...(item.multiSelect === true ? { multiSelect: true } : {}),
          };
        });
        const signal = record?.signal instanceof AbortSignal ? record.signal : undefined;
        const agent = asRecord(record?.agent);
        const sessionId = typeof agent?.id === 'string' ? agent.id : '';
        return new Promise((resolve, reject) => {
          const id = randomUUID();
          const finish = (fn: () => void): void => {
            if (!this.questions.delete(id)) return;
            emit({ kind: 'question-resolved', id });
            fn();
          };
          this.questions.set(id, {
            resolve: (answer) => {
              finish(() => resolve(answer));
            },
          });
          emit({ kind: 'question-requested', id, sessionId, questions });
          signal?.addEventListener(
            'abort',
            () => {
              finish(() => reject(new Error('问题已随回合取消')));
            },
            { once: true },
          );
        });
      },
    });
  }

  /** UI 应答审批。返回是否命中挂起项。 */
  respondApproval(id: string, outcome: 'allowed-once' | 'rejected'): boolean {
    const pending = this.approvals.get(id);
    if (pending === undefined) return false;
    pending.resolve(outcome);
    return true;
  }

  /** UI 应答提问。返回是否命中挂起项。 */
  respondQuestion(id: string, answers: QuestionAnswer[]): boolean {
    const pending = this.questions.get(id);
    if (pending === undefined) return false;
    pending.resolve({ answers });
    return true;
  }
}
