/**
 * Fixed Codex one-shot subagent provider. Every accepted run starts a fresh
 * official `codex app-server --stdio` process in the delegating Session's
 * workspace and publishes only after an ephemeral thread exists.
 *
 * @module @deepseek-ai/dsh-subagent-codex
 */
import z from '@deepseek-ai/schemastery';
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout';
import { assertPositiveFinite, NO_START_CAPABILITIES, resolveChildCwd, } from '@deepseek-ai/dsh-subagent';
import { DEFAULT_DISPOSE_GRACE_MS, startCodexRun, } from "./run.js";
export const name = 'subagent-codex';
export const inject = ['subagents', 'subprocess'];
export const Config = z.object({
    env: z.dict(z.string()).default({}),
    disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
});
class CodexProvider {
    ctx;
    config;
    name = 'codex';
    capabilities = NO_START_CAPABILITIES;
    inheritsParentContext = false;
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    start(request) {
        const parentCwd = request.parent.session.header.cwd;
        if (parentCwd === undefined) {
            throw new Error('subagent-codex: no working directory for the child — delegate from a parent session that has one');
        }
        const spec = {
            cwd: resolveChildCwd('subagent-codex', undefined, parentCwd),
            env: this.config.env,
            disposeGraceMs: this.config.disposeGraceMs,
            spawn: spawnSpec => this.ctx.subprocess.spawn(spawnSpec),
            onError: (error, stopReason) => {
                this.ctx.logger.warn(`subagent-codex: child run failed (${stopReason}): ${error.message}`);
            },
        };
        return startCodexRun(request, spec);
    }
}
/**
 * Register the fixed `codex` provider.
 * @param ctx - context carrying shared subagent and subprocess services.
 * @param config - explicit child environment and disposal grace.
 */
export function apply(ctx, config) {
    const resolved = config;
    assertPositiveFinite('subagent-codex', 'disposeGraceMs', resolved.disposeGraceMs);
    if (resolved.disposeGraceMs > MAX_TIMER_DELAY_MS) {
        throw new Error(`subagent-codex: disposeGraceMs must be no greater than ${MAX_TIMER_DELAY_MS}`);
    }
    ctx.subagents.registerProvider(new CodexProvider(ctx, resolved));
}
//# sourceMappingURL=index.js.map