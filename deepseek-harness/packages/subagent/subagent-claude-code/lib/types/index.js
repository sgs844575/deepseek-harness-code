/**
 * Fixed Claude Code one-shot subagent provider. Every accepted run invokes
 * the official Agent SDK in the delegating Session's workspace and places
 * the SDK-spawned real CLI under the shared subprocess owner.
 *
 * @module @deepseek-ai/dsh-subagent-claude-code
 */
import z from '@deepseek-ai/schemastery';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import { assertPositiveFinite, NO_START_CAPABILITIES, resolveChildCwd, } from '@deepseek-ai/dsh-subagent';
import { DEFAULT_DISPOSE_GRACE_MS, startClaudeCodeRun, } from "./run.js";
export const name = 'subagent-claude-code';
export const inject = ['subagents', 'subprocess'];
export const Config = z.object({
    env: z.dict(z.string()).default({}),
    disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
});
/* jscpd:ignore-end */
/* jscpd:ignore-start -- Cordis registration and shared-seam plumbing mirror
 * the Codex sibling; each product's lifecycle remains package-private. */
class ClaudeCodeProvider {
    ctx;
    config;
    name = 'claude-code';
    capabilities = NO_START_CAPABILITIES;
    inheritsParentContext = false;
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    async start(request) {
        const parentCwd = request.parent.session.header.cwd;
        if (parentCwd === undefined) {
            throw new Error('subagent-claude-code: no working directory for the child — delegate from a parent session that has one');
        }
        const executable = await this.ctx.subprocess.resolveExecutable('claude', this.config.env, request.signal);
        const spec = {
            cwd: resolveChildCwd('subagent-claude-code', undefined, parentCwd),
            executable,
            env: this.config.env,
            disposeGraceMs: this.config.disposeGraceMs,
            spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
            onError: (error, stopReason) => {
                this.ctx.logger.warn(`subagent-claude-code: child run failed (${stopReason}): ${error.message}`);
            },
        };
        return startClaudeCodeRun(request, spec);
    }
}
/**
 * Register the fixed `claude-code` provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - explicit child environment and disposal grace.
 */
export function apply(ctx, config) {
    const resolved = config;
    assertPositiveFinite('subagent-claude-code', 'disposeGraceMs', resolved.disposeGraceMs);
    if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
        throw new Error(`subagent-claude-code: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
    }
    ctx.subagents.registerProvider(new ClaudeCodeProvider(ctx, resolved));
}
/* jscpd:ignore-end */
//# sourceMappingURL=index.js.map