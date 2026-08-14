/**
 * Fixed Codex one-shot subagent provider. Every accepted run starts a fresh
 * official `codex app-server --stdio` process in the delegating Session's
 * workspace and publishes only after an ephemeral thread exists.
 *
 * @module @deepseek-ai/dsh-subagent-codex
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "subagent-codex";
export declare const inject: string[];
/** Deployment-owned environment and process-release bound. */
export interface Config {
    /**
     * Explicit environment entries layered over the subprocess seam's
     * credential-scrubbed parent environment.
     */
    env?: Record<string, string>;
    /** Grace in milliseconds for app-server process-tree termination. */
    disposeGraceMs?: number;
}
export declare const Config: z<Config>;
/**
 * Register the fixed `codex` provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - explicit child environment and disposal grace.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map