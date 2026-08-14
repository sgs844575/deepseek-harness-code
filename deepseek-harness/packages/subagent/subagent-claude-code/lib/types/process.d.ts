/**
 * Projection from the shared managed-process handle to the official Claude
 * Agent SDK's custom-spawn process interface.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code/process
 */
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk';
import { type SubprocessHandle, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess';
/**
 * Encode the SDK's complete child environment as a subprocess overlay.
 * @param env - SDK-composed child environment after its removals and replacements.
 * @returns explicit values plus tombstones for surviving ambient names the SDK removed.
 */
export declare function sdkEnvironmentOverlay(env: SpawnOptions['env']): NodeJS.ProcessEnv;
/**
 * Translate one official SDK spawn request to the shared process owner.
 * @param options - command, arguments, workspace, environment, and forwarded signal from the SDK.
 * @param graceMs - process-tree termination grace.
 * @param platform - host platform selecting the Windows batch-shim boundary.
 * @returns the fully explicit shared subprocess request.
 * @remarks The batch-shim path quotes only the resolved executable. The pinned SDK
 * supplies fixed flag arguments without cmd metacharacters; cmd reparses that tail.
 */
export declare function claudeSpawnSpec(options: SpawnOptions, graceMs: number, platform?: NodeJS.Platform): SubprocessSpawnSpec;
/**
 * SDK-facing view of one shared managed process. Protocol transport remains
 * in the official SDK; this adapter only projects streams and exit events.
 */
export declare class ManagedClaudeCodeProcess implements SpawnedProcess {
    private readonly child;
    readonly stdin: import("stream").Writable;
    readonly stdout: import("stream").Readable;
    private readonly events;
    private exitCodeValue;
    private signalCodeValue;
    private killRequested;
    /**
     * Project a managed process with piped stdin and stdout.
     * @param child - shared handle that remains the process-tree authority.
     */
    constructor(child: SubprocessHandle);
    /** Whether the SDK has requested managed tree termination. */
    get killed(): boolean;
    /** Direct-child exit code, or null while running or after signal exit. */
    get exitCode(): number | null;
    /** Direct-child terminating signal, if any. */
    get signalCode(): NodeJS.Signals | null;
    /**
     * Route the SDK's termination request to the tree-scoped process owner.
     * @param _signal - SDK-selected signal; the shared seam owns its escalation ladder.
     * @returns false only after exit or a previous termination request.
     */
    kill(_signal: NodeJS.Signals): boolean;
    /** Register a persistent process lifecycle listener. */
    on(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void;
    /** Register a one-shot process lifecycle listener. */
    once(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void;
    /** Remove a process lifecycle listener. */
    off(event: 'exit' | 'error', listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void)): void;
}
//# sourceMappingURL=process.d.ts.map