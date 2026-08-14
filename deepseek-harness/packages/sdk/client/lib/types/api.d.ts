/**
 * High-level run API over {@link HarnessClient}: `DeepSeekHarness` owns one
 * runtime subprocess across many sessions; `HarnessSession.run` sends a
 * prompt and settles when the whole agent next becomes idle.
 * Mirrors the Python SDK's `DeepSeekHarness`/`Session` pair.
 *
 * @module @deepseek-ai/dsh-sdk-client/api
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { HarnessClient } from './client.ts';
import type { ContentBlock, DeepSeekHarnessOptions, HarnessNotification, RunResult } from './types.ts';
/**
 * Reusable SDK for running DeepSeek Harness agent turns in a runtime
 * subprocess. The subprocess starts lazily on first use and stays owned by
 * this instance until {@link close}; always close (or `await using`) so the
 * child is reaped.
 */
export declare class DeepSeekHarness implements AsyncDisposable {
    private clientInstance;
    private readonly launch;
    private readonly cwd;
    private readonly provider;
    private readonly model;
    private readonly maxTokens;
    private initialized;
    private closed;
    /** @param options - runtime launch spec plus the session route (cwd/provider/model). */
    constructor(options: DeepSeekHarnessOptions);
    /**
     * The underlying JSON-RPC client (exposed for low-level access). A failed
     * handshake reaps its runtime and swaps in a fresh instance, so do not
     * cache this across a failed {@link start}.
     * @returns the client currently owning the runtime subprocess.
     */
    get client(): HarnessClient;
    /**
     * Start the subprocess and perform the `initialize` handshake once. On
     * failure the runtime is reaped and a fresh client replaces it
     * (`HarnessClient.close` is permanent), so a later call retries with a new
     * subprocess — unless {@link close} already ended this harness.
     * @returns settlement of the (memoized) handshake.
     */
    start(): Promise<void>;
    /**
     * Open a session handle (no wire traffic; the runtime creates the session
     * on its first prompt).
     * @param sessionId - explicit id to reuse; omitted mints a fresh one.
     * @returns the session handle.
     */
    session(sessionId?: string): HarnessSession;
    /**
     * Run one prompt on a fresh (or named) session.
     * @param input - prompt text, or content blocks sent verbatim.
     * @param options - optional session id and per-notification observer.
     * @returns the owned activity interval.
     */
    run(input: string | ContentBlock[], options?: RunOptions): Promise<RunResult>;
    /**
     * Shut down and reap the runtime subprocess. Idempotent and terminal —
     * a closed harness no longer retries a failed handshake.
     * @returns settlement of the complete teardown.
     */
    close(): Promise<void>;
    /**
     * `await using` support: {@link close}.
     * @returns settlement of the teardown.
     */
    [Symbol.asyncDispose](): Promise<void>;
}
/** Per-run options: target session and streaming observer. */
export interface RunOptions {
    /** Session id to run on; omitted mints a fresh session per call. */
    sessionId?: string;
    /** Observer invoked with every notification for this session tree, in wire order. */
    onNotification?: (notification: HarnessNotification) => void;
}
/**
 * One SDK session: a stable id plus owned activity intervals.
 */
export declare class HarnessSession {
    readonly harness: DeepSeekHarness;
    readonly id: string;
    /**
     * @param harness - the owning harness (supplies the client and handshake).
     * @param id - the wire session id this handle runs on.
     */
    constructor(harness: DeepSeekHarness, id: string);
    /**
     * Queue one prompt, then observe the whole session through its next idle.
     * @param input - prompt text, or content blocks sent verbatim.
     * @param options - optional per-notification observer.
     * @returns the owned activity interval; rejects on transport loss, timeout,
     * or a protocol error.
     */
    run(input: string | ContentBlock[], options?: Pick<RunOptions, 'onNotification'>): Promise<RunResult>;
}
/**
 * Normalize run input: a string becomes one text block; blocks pass verbatim.
 * @param input - prompt text or content blocks.
 * @returns the content blocks to send.
 */
export declare function normalizeInput(input: string | ContentBlock[]): ContentBlock[];
/**
 * Extract the concatenated text of the last assistant message.
 * @param events - the activity interval's `session.event` payloads in wire order.
 * @returns the final response text, or `''` when no assistant message exists.
 */
export declare function finalResponse(events: SessionEvent[]): string;
//# sourceMappingURL=api.d.ts.map