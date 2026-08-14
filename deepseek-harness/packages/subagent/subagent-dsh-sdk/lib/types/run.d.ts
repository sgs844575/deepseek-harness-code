/**
 * Fresh-process SDK subagent client. Drives one child DeepSeek Harness
 * runtime over stdio JSON-RPC through `@deepseek-ai/dsh-sdk-client` and owns
 * cancellation and quiescent disposal. Structure mirrors the ACP backend
 * (`@deepseek-ai/dsh-subagent-acp`): publish after the child handshake,
 * flatten child failures into stop reasons, tear down to quiescence. The
 * child is spawned BY the SDK client rather than through `ctx.subprocess` —
 * the subprocess seam's documented exception for SDK-managed transports —
 * so this driver applies the seam's shared env scrub itself.
 *
 * @module @deepseek-ai/dsh-subagent-dsh-sdk/run
 */
import { type TurnEndReason } from '@deepseek-ai/dsh-session';
import type { SubagentRun, SubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent';
/** Resolved spawn spec for an SDK runtime child process (no defaults — see Config). */
export interface SdkRunSpec {
    /** The executable to spawn (the child runtime — a `dsh-jsonrpc-agent` bin or packaged exe). */
    command: string;
    /** Arguments passed to {@link command} (typically the child's `cordis.yml` path). */
    args: string[];
    /**
     * Absolute working directory for the child process AND the workspace cwd
     * of its SDK session. The provider resolves it before this spec exists:
     * config override, else the delegating parent session's workspace.
     */
    cwd: string;
    /** Provider route the child runtime initializes with. */
    provider: string;
    /** Model the child runtime initializes with. */
    model: string;
    /** Optional per-request output-token cap sent in the child runtime's initialize handshake. */
    maxTokens?: number;
    /**
     * Extra environment variables to ADD for the child (e.g. the child
     * runtime's own `DEEPSEEK_API_KEY`, or `DSH_CORDIS_CONFIG`). Merged after
     * the seam's `scrubbedParentEnv()` base, so an explicit credential or
     * current `DSH_*` fact survives while ambient namesakes never leak.
     */
    env: Record<string, string>;
    /** Bound (ms) on the protocol `shutdown` exchange during dispose. */
    shutdownTimeoutMs: number;
    /** Grace period (ms) for the child's EOF-driven quiesce on dispose. */
    disposeEofGraceMs: number;
    /** Termination confirmation window (ms), including forced exit on every platform. */
    disposeGraceMs: number;
    /**
     * Sink for a child-level failure that the run flattened into a stop reason
     * (the seam contract forbids `result` rejecting). A throw from the sink
     * itself is contained. Optional — omitted in unit tests that assert the
     * stop reason directly.
     */
    onError?: (error: Error, stopReason: SubagentStopReason) => void;
}
/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
export declare const DEFAULT_DISPOSE_EOF_GRACE_MS = 6000;
/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
export declare const DEFAULT_DISPOSE_GRACE_MS = 3000;
/** Default bound on the protocol `shutdown` exchange during dispose. */
export declare const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1000;
/**
 * Map a child turn-end reason to a harness {@link SubagentStopReason}.
 * @param reason - the owned child run's final durable turn reason, or
 * `undefined` when it settled without running a turn.
 * @returns the harness equivalent; an absent or unknown reason maps to
 * `error`, so an unclean stop is never reported as `completed`.
 */
export declare function sdkStopReason(reason: TurnEndReason | undefined): SubagentStopReason;
/**
 * Start and publish one SDK runtime child after its `initialize` handshake.
 * Child failures resolve through the run result; startup failures reject
 * after process reap. Disposal shuts the runtime down and reaps it.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn spec: command/args/cwd, the child's
 * provider/model route, env, timeouts, and the optional error sink.
 * @returns the ready run handle for the child subprocess.
 */
export declare function startSdkRun(request: SubagentStartRequest, spec: SdkRunSpec): Promise<SubagentRun>;
//# sourceMappingURL=run.d.ts.map