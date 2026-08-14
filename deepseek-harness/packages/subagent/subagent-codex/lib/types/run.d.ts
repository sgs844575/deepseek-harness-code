/**
 * One-shot Codex child lifecycle: spawn the real app-server through the
 * subprocess seam, publish only after initialization and ephemeral thread
 * creation, flatten post-publication failures, and dispose to whole-tree
 * quiescence.
 *
 * @module @deepseek-ai/dsh-subagent-codex/run
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { type SubagentRun, type SubagentStartRequest, type SubagentStopReason } from '@deepseek-ai/dsh-subagent';
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
import { CodexAppServerWire } from './wire.ts';
/** Default POSIX grace between subprocess termination tiers. */
export declare const DEFAULT_DISPOSE_GRACE_MS = 3000;
/**
 * Resolve the fixed app-server command for a platform.
 *
 * Windows npm and pnpm installs expose `codex.cmd`, which requires `cmd.exe`;
 * the argv is constant so no task or configuration text enters the
 * shell boundary.
 * @param platform - host platform used to select the executable boundary.
 * @returns argv for the fixed Codex app-server command.
 */
export declare function codexAppServerArgv(platform?: NodeJS.Platform): string[];
/** Fully resolved inputs for one Codex app-server run. */
export interface CodexRunSpec {
    /** Parent Session workspace, also supplied to `thread/start`. */
    readonly cwd: string;
    /** Explicit deployment/test environment layered after the shared scrub. */
    readonly env: Record<string, string>;
    /** Subprocess termination grace passed to the shared process-tree owner. */
    readonly disposeGraceMs: number;
    /** Shared subprocess service spawn operation. */
    readonly spawn: (spec: SubprocessSpawnSpec) => SubprocessHandle;
    /** Diagnostic sink for a post-publication error flattened into a result. */
    readonly onError?: (error: Error, stopReason: SubagentStopReason) => void;
}
/**
 * Validate and preserve the one-shot task before crossing the process boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact non-empty text block sequence.
 */
export declare function textTask(prompt: readonly ContentBlock[]): string[];
/**
 * Close the private wire, terminate the managed process tree, and wait for the
 * subprocess owner to prove it is gone.
 * @param wire - private app-server protocol connection.
 * @param child - shared-service handle that owns the process tree.
 */
export declare function disposeCodexChild(wire: CodexAppServerWire, child: SubprocessHandle): Promise<void>;
/**
 * Start the real `codex app-server --stdio` child and publish its one-shot run.
 * @param request - resolved shared subagent request.
 * @param spec - Workspace, environment, process service, and diagnostic policy.
 * @returns the published run after initialization and ephemeral thread creation.
 */
export declare function startCodexRun(request: SubagentStartRequest, spec: CodexRunSpec): Promise<SubagentRun>;
//# sourceMappingURL=run.d.ts.map