/**
 * Out-of-process SDK subagent backend. Each child is a complete DeepSeek
 * Harness runtime in its own process — own `cordis.yml`-decided composition,
 * session, model route, and tools — driven over stdio JSON-RPC through the
 * TypeScript SDK client, so it shares no Cordis context and advertises no
 * parent-enforced start capabilities; the ONE thing it reads off
 * `request.parent` is the session's workspace cwd. This plugin uses named
 * exports only; a default would hide its loader metadata (see
 * `docs/postmortem/0001-acp-default-export-drops-inject.md`).
 * @module @deepseek-ai/dsh-subagent-dsh-sdk
 */
import z from '@deepseek-ai/schemastery';
import { assertPositiveFinite, NO_START_CAPABILITIES, resolveChildCwd, validateConfiguredCwd } from '@deepseek-ai/dsh-subagent';
import { DEFAULT_DISPOSE_EOF_GRACE_MS, DEFAULT_DISPOSE_GRACE_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS, startSdkRun, } from "./run.js";
export const name = 'subagent-dsh-sdk';
export const inject = ['subagents'];
export const Config = z.object({
    providerName: z.string().default('dsh-sdk'),
    command: z.string().required(),
    args: z.array(z.string()).default([]),
    cwd: z.string(),
    provider: z.string().default('deepseek-official'),
    model: z.string().default('deepseek-v4-flash'),
    maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
    env: z.dict(z.string()).default({}),
    shutdownTimeoutMs: z.number().default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
    disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
    disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS),
});
/**
 * The SDK provider. Advertises NO start-time capabilities: an out-of-process
 * child cannot honor `outputSchema`/`maxDepth`/`toolFilter`/`persona` (the
 * service rejects a request needing any of them before `start` runs).
 */
class SdkSubagentProvider {
    name;
    ctx;
    config;
    capabilities = NO_START_CAPABILITIES;
    // Context contract: an out-of-process SDK child starts fresh — no parent conversation crosses the process boundary.
    inheritsParentContext = false;
    constructor(name, ctx, config) {
        this.name = name;
        this.ctx = ctx;
        this.config = config;
    }
    start(request) {
        const spec = {
            command: this.config.command,
            args: this.config.args,
            cwd: resolveChildCwd('subagent-dsh-sdk', this.config.cwd, request.parent.session.header.cwd),
            provider: this.config.provider,
            model: this.config.model,
            ...this.config.maxTokens === undefined ? {} : { maxTokens: this.config.maxTokens },
            env: this.config.env,
            shutdownTimeoutMs: this.config.shutdownTimeoutMs,
            disposeEofGraceMs: this.config.disposeEofGraceMs,
            disposeGraceMs: this.config.disposeGraceMs,
            onError: (error, stopReason) => {
                // The seam forbids `result` rejecting, so a child-level failure is
                // flattened to a stop reason — preserve it here rather than losing it.
                this.ctx.logger.warn(`subagent-dsh-sdk "${this.name}": child run failed (${stopReason}): ${error.message}`);
            },
        };
        return startSdkRun(request, spec);
    }
}
export function apply(ctx, config) {
    // schemastery (Config) has already filled every defaulted field.
    const resolved = config;
    assertPositiveFinite('subagent-dsh-sdk', 'shutdownTimeoutMs', resolved.shutdownTimeoutMs);
    assertPositiveFinite('subagent-dsh-sdk', 'disposeEofGraceMs', resolved.disposeEofGraceMs);
    assertPositiveFinite('subagent-dsh-sdk', 'disposeGraceMs', resolved.disposeGraceMs);
    if (resolved.maxTokens !== undefined && (!Number.isSafeInteger(resolved.maxTokens) || resolved.maxTokens <= 0)) {
        throw new TypeError('subagent-dsh-sdk maxTokens must be a positive safe integer');
    }
    // Interpret a relative configured cwd against the harness launch directory
    // ONCE, at load, and fail a misconfigured directory here — not per start.
    const configuredCwd = validateConfiguredCwd('subagent-dsh-sdk', resolved.cwd);
    const validated = configuredCwd === undefined
        ? resolved
        : { ...resolved, cwd: configuredCwd };
    ctx.subagents.registerProvider(new SdkSubagentProvider(validated.providerName, ctx, validated));
}
//# sourceMappingURL=index.js.map