/**
 * Fixed Claude Code one-shot subagent provider. Every accepted run invokes
 * the official Agent SDK in the delegating Session's workspace and places
 * the SDK-spawned real CLI under the shared subprocess owner.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "subagent-claude-code";
export declare const inject: string[];
/** Deployment-owned environment and process-release bound. */
export interface Config {
    /**
     * Explicit environment entries layered over the subprocess seam's
     * credential-scrubbed parent environment.
     */
    env?: Record<string, string>;
    /** Grace in milliseconds for Claude Code process-tree termination. */
    disposeGraceMs?: number;
}
export declare const Config: z<Config>;
/**
 * Register the fixed `claude-code` provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - explicit child environment and disposal grace.
 */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map