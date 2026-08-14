/**
 * Fresh-process ACP subagent client. Drives one child session and owns cancellation and
 * quiescent disposal.
 *
 * TODO(acp-subagent-replay): add snapshot-tier coverage with a separate replay fixture and
 * sessions root inside each child process. Current keyless coverage uses a scripted ACP child;
 * with-key coverage drives the real ACP example.
 * @module @deepseek-ai/dsh-subagent-acp/run
 */
import { type ContentBlock as AcpContentBlock, type StopReason } from '@agentclientprotocol/sdk';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { SubagentRun, SubagentStartRequest, SubagentStopReason } from '@deepseek-ai/dsh-subagent';
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
/** Fixed response to child permission requests: reject by default, or select the first allow option. */
export type PermissionPolicy = 'allow' | 'reject';
/** Resolved spawn spec for an ACP child process (no defaults — see Config). */
export interface AcpRunSpec {
    /** The executable to spawn (the child ACP agent). */
    command: string;
    /** Arguments passed to {@link command}. */
    args: string[];
    /**
     * Absolute working directory for the child process AND its ACP session
     * `cwd`. The provider resolves it before this spec exists: config override,
     * else the delegating parent session's workspace.
     */
    cwd: string;
    /** How to auto-answer the child's permission prompts. */
    permission: PermissionPolicy;
    /**
     * Extra environment variables to ADD for the child (e.g. the child harness's
     * `DEEPSEEK_API_KEY`). Merged on top of the subprocess seam's scrubbed
     * parent env. A value here is forwarded even if its name matches the
     * credential-scrub pattern (an explicit opt-in for the child's own creds).
     * Explicit `DSH_*` entries are deployment-owned facts for the child harness
     * (e.g. `DSH_PERMISSION_MODE`); they simply merge after the scrub that
     * dropped their stale ambient namesakes.
     */
    env: Record<string, string>;
    /**
     * Grace period (ms) for the child's EOF-driven quiesce in
     * {@link SubagentRun.dispose} — the window to flush persistence and tear down
     * its OWN nested subprocesses before the parent escalates to a signal. The
     * plugin fills this from its `disposeEofGraceMs` config.
     */
    disposeEofGraceMs: number;
    /**
     * Termination-escalation grace (ms) in {@link SubagentRun.dispose}; POSIX
     * waits this long after `SIGTERM` before `SIGKILL`, while Windows
     * force-terminates directly. The plugin fills it from `disposeGraceMs`.
     */
    disposeGraceMs: number;
    /**
     * Spawn function from the subprocess seam (`ctx.subprocess.spawn`), so the
     * child rides the shared scrub, tree-scoped teardown, and service-owned
     * lifetime instead of a package-local child_process path.
     */
    spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle;
    /**
     * Sink for a child-level failure that the run flattened into a stop reason
     * (the seam contract forbids `result` rejecting). The driver calls this with
     * the original error and the chosen stop reason so the fault is preserved
     * rather than silently lost; the provider wires it to `ctx.logger.warn`.
     * A throw from the sink itself is contained — it cannot reject `result`.
     * Optional — omitted in a unit test that asserts the stop reason directly.
     */
    onError?: (error: Error, stopReason: SubagentStopReason) => void;
}
/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
export declare const DEFAULT_DISPOSE_EOF_GRACE_MS = 6000;
/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
export declare const DEFAULT_DISPOSE_GRACE_MS = 3000;
/**
 * Cooperative teardown ladder for an out-of-process agent, over the seam's
 * public verbs; resolves only at whole-tree quiescence: stdin EOF (the child's
 * window to flush persistence and reap its own descendants), then the
 * terminate() escalation (SIGTERM → spec grace → SIGKILL) and its
 * whole-tree exit proof.
 * @param child - the spawned ACP child's handle.
 * @param eofGraceMs - tier-1 window after stdin EOF.
 */
export declare function disposeAcpChild(child: SubprocessHandle, eofGraceMs: number): Promise<void>;
/**
 * Map an ACP {@link StopReason} to a harness {@link SubagentStopReason}.
 * @param reason - the terminal reason from the child's `session/prompt` response.
 * @returns the harness equivalent; `max_turn_requests` and any unknown future
 * variant map to `error`, so an unclean stop is never reported as `completed`.
 */
export declare function acpStopReason(reason: StopReason): SubagentStopReason;
/**
 * Collect the text of an ACP content block (non-text blocks contribute nothing).
 * @param content - the content block off a streamed `agent_message_chunk`.
 * @returns the block's text, or `''` for a non-text block.
 */
export declare function acpContentText(content: AcpContentBlock): string;
/**
 * Translate the harness prompt blocks into ACP prompt blocks (text only).
 * @param prompt - the harness prompt; non-text blocks are dropped.
 * @returns the ACP text blocks, in order.
 */
export declare function toAcpPrompt(prompt: ContentBlock[]): AcpContentBlock[];
/**
 * Start and publish one ACP child after initialization and session creation.
 * Child failures resolve through the run result; startup failures reject after
 * process reap. Disposal cancels, kills, and reaps the child.
 * @param request - the start request; its signal is the cancellation channel.
 * @param spec - the resolved spawn spec: command/args/cwd, env, permission
 * policy, dispose graces, and the optional error sink.
 * @returns the ready run handle for the child subprocess.
 */
export declare function startAcpRun(request: SubagentStartRequest, spec: AcpRunSpec): Promise<SubagentRun>;
//# sourceMappingURL=run.d.ts.map