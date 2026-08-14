/**
 * Minimal Codex app-server 0.147.0 protocol adapter. The shared JSON-RPC
 * transport owns framing and request correlation; this module owns only the
 * product methods, current thread/turn association, unattended approval
 * responses, and terminal-answer selection.
 *
 * @module @deepseek-ai/dsh-subagent-codex/wire
 */
import type { Readable, Writable } from 'node:stream';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SubagentResult } from '@deepseek-ai/dsh-subagent';
/**
 * One app-server connection and its single ephemeral thread/turn.
 *
 * The class deliberately exposes no generic request surface. Supporting
 * another product method must first become part of the provider contract.
 */
export declare class CodexAppServerWire {
    private readonly input;
    private readonly transport;
    private readonly fatal;
    private threadId;
    private turnId;
    private pendingTurnId;
    private turnCompleted;
    private readonly earlyTurnNotifications;
    private lastFinalAnswer;
    private lastUnphasedAnswer;
    private closed;
    constructor(input: Readable, output: Writable);
    /** Start reading app-server frames. */
    start(): void;
    /**
     * Perform the required app-server initialize/initialized handshake.
     * @param signal - unpublished-start cancellation.
     */
    initialize(signal: AbortSignal): Promise<void>;
    /**
     * Create the run's private ephemeral thread and retain its identity.
     * @param cwd - parent Session workspace.
     * @param signal - unpublished-start cancellation.
     */
    startThread(cwd: string, signal: AbortSignal): Promise<void>;
    /**
     * Submit the one text-only task and wait for this thread/turn's authoritative
     * terminal notification.
     * @param texts - already validated task text blocks.
     * @param signal - local cancellation for the published run.
     * @returns the shared subagent result.
     */
    runTurn(texts: readonly string[], signal: AbortSignal): Promise<SubagentResult>;
    /**
     * Best-effort remote cancellation. Local settlement and process teardown
     * remain authoritative when the child no longer accepts protocol requests.
     */
    interrupt(): void;
    /**
     * The best non-commentary answer observed so far, preserving exact bytes.
     * @returns the selected final or nullable-phase text block, if any.
     */
    collectOutput(): ContentBlock[];
    /** Detach JSON-RPC listeners and reject outstanding requests. Idempotent. */
    close(): void;
    private guarded;
    private fail;
    private readonly onInputError;
    private readonly onOutputError;
    private readonly onInputEnd;
    private observePendingTurnId;
    private commitTurnId;
    private validateRunIds;
    private handleServerRequest;
    private handleNotification;
}
//# sourceMappingURL=wire.d.ts.map