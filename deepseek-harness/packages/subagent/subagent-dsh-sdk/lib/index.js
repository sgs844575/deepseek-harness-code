import z from "@deepseek-ai/schemastery";
import { AssistantOutputFold, NO_START_CAPABILITIES, assertPositiveFinite, resolveChildCwd, settleRunResult, subprocessRunHandle, validateConfiguredCwd } from "@deepseek-ai/dsh-subagent";
import { randomUUID } from "node:crypto";
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { SessionId } from "@deepseek-ai/dsh-session";
import { scrubbedParentEnv } from "@deepseek-ai/dsh-subprocess";
//#region lib/types/run.js
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
/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
const DEFAULT_DISPOSE_EOF_GRACE_MS = 6e3;
/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
const DEFAULT_DISPOSE_GRACE_MS = 3e3;
/** Default bound on the protocol `shutdown` exchange during dispose. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1e3;
/**
* Map a child turn-end reason to a harness {@link SubagentStopReason}.
* @param reason - the owned child run's final durable turn reason, or
* `undefined` when it settled without running a turn.
* @returns the harness equivalent; an absent or unknown reason maps to
* `error`, so an unclean stop is never reported as `completed`.
*/
function sdkStopReason(reason) {
	switch (reason?.kind) {
		case "completed": return "completed";
		case "max-tokens": return "max-tokens";
		case "aborted": return "aborted";
		default: return "error";
	}
}
/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
	/* v8 ignore next */
	return value instanceof Error ? value : new Error(String(value));
}
/**
* Start and publish one SDK runtime child after its `initialize` handshake.
* Child failures resolve through the run result; startup failures reject
* after process reap. Disposal shuts the runtime down and reaps it.
* @param request - the start request; its signal is the cancellation channel.
* @param spec - the resolved spawn spec: command/args/cwd, the child's
* provider/model route, env, timeouts, and the optional error sink.
* @returns the ready run handle for the child subprocess.
*/
async function startSdkRun(request, spec) {
	if (request.signal.aborted) throw new Error("subagent request was aborted before the SDK child started");
	const id = SessionId(randomUUID());
	const harness = new DeepSeekHarness({
		launch: {
			command: spec.command,
			args: spec.args,
			cwd: spec.cwd,
			env: {
				...scrubbedParentEnv(),
				...spec.env
			},
			shutdownTimeoutMs: spec.shutdownTimeoutMs,
			disposeEofGraceMs: spec.disposeEofGraceMs,
			disposeGraceMs: spec.disposeGraceMs
		},
		cwd: spec.cwd,
		provider: spec.provider,
		model: spec.model,
		...spec.maxTokens === void 0 ? {} : { maxTokens: spec.maxTokens }
	});
	const flags = { cancelled: false };
	let signalCancelSettled;
	const cancelSettled = new Promise((resolve) => {
		signalCancelSettled = resolve;
	});
	const requestCancel = () => {
		if (flags.cancelled) return;
		flags.cancelled = true;
		signalCancelSettled();
	};
	const onAbort = () => {
		requestCancel();
	};
	request.signal.addEventListener("abort", onAbort, { once: true });
	try {
		await Promise.race([harness.start(), cancelSettled.then(() => {
			throw new Error("subagent cancelled before the SDK child initialized");
		})]);
		/* v8 ignore next */
		if (flags.cancelled) throw new Error("subagent cancelled before the SDK child initialized");
	} catch (error) {
		request.signal.removeEventListener("abort", onAbort);
		await harness.close();
		if (flags.cancelled) throw new Error("subagent request was aborted before the SDK child started");
		throw toError(error);
	}
	const childSessionId = `session-${randomUUID().replaceAll("-", "")}`;
	const fold = new AssistantOutputFold();
	const observe = (notification) => {
		if (notification.method !== "session.event" || notification.params.sessionId !== childSessionId) return;
		fold.push(notification.params.event);
	};
	const collectOutput = () => fold.collect() ?? [];
	return subprocessRunHandle({
		id,
		result: settleRunResult({
			attempt: async () => {
				const turn = await Promise.race([harness.session(childSessionId).run(request.prompt, { onNotification: observe }), cancelSettled.then(() => "cancelled")]);
				if (turn === "cancelled") return {
					output: collectOutput(),
					stopReason: "aborted"
				};
				const lastEnd = turn.events.findLast((event) => event.type === "turn/end");
				return {
					output: collectOutput(),
					stopReason: sdkStopReason(lastEnd?.data.reason)
				};
			},
			collectOutput,
			cancelled: () => flags.cancelled,
			onError: spec.onError,
			signal: request.signal,
			onAbort
		}),
		signal: request.signal,
		onAbort,
		requestCancel,
		teardown: () => harness.close()
	});
}
//#endregion
//#region lib/types/index.js
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
const name = "subagent-dsh-sdk";
const inject = ["subagents"];
const Config = z.object({
	providerName: z.string().default("dsh-sdk"),
	command: z.string().required(),
	args: z.array(z.string()).default([]),
	cwd: z.string(),
	provider: z.string().default("deepseek-official"),
	model: z.string().default("deepseek-v4-flash"),
	maxTokens: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
	env: z.dict(z.string()).default({}),
	shutdownTimeoutMs: z.number().default(DEFAULT_SHUTDOWN_TIMEOUT_MS),
	disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
	disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS)
});
/**
* The SDK provider. Advertises NO start-time capabilities: an out-of-process
* child cannot honor `outputSchema`/`maxDepth`/`toolFilter`/`persona` (the
* service rejects a request needing any of them before `start` runs).
*/
var SdkSubagentProvider = class {
	name;
	ctx;
	config;
	capabilities = NO_START_CAPABILITIES;
	inheritsParentContext = false;
	constructor(name, ctx, config) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
	}
	start(request) {
		return startSdkRun(request, {
			command: this.config.command,
			args: this.config.args,
			cwd: resolveChildCwd("subagent-dsh-sdk", this.config.cwd, request.parent.session.header.cwd),
			provider: this.config.provider,
			model: this.config.model,
			...this.config.maxTokens === void 0 ? {} : { maxTokens: this.config.maxTokens },
			env: this.config.env,
			shutdownTimeoutMs: this.config.shutdownTimeoutMs,
			disposeEofGraceMs: this.config.disposeEofGraceMs,
			disposeGraceMs: this.config.disposeGraceMs,
			onError: (error, stopReason) => {
				this.ctx.logger.warn(`subagent-dsh-sdk "${this.name}": child run failed (${stopReason}): ${error.message}`);
			}
		});
	}
};
function apply(ctx, config) {
	const resolved = config;
	assertPositiveFinite("subagent-dsh-sdk", "shutdownTimeoutMs", resolved.shutdownTimeoutMs);
	assertPositiveFinite("subagent-dsh-sdk", "disposeEofGraceMs", resolved.disposeEofGraceMs);
	assertPositiveFinite("subagent-dsh-sdk", "disposeGraceMs", resolved.disposeGraceMs);
	if (resolved.maxTokens !== void 0 && (!Number.isSafeInteger(resolved.maxTokens) || resolved.maxTokens <= 0)) throw new TypeError("subagent-dsh-sdk maxTokens must be a positive safe integer");
	const configuredCwd = validateConfiguredCwd("subagent-dsh-sdk", resolved.cwd);
	const validated = configuredCwd === void 0 ? resolved : {
		...resolved,
		cwd: configuredCwd
	};
	ctx.subagents.registerProvider(new SdkSubagentProvider(validated.providerName, ctx, validated));
}
//#endregion
export { Config, apply, inject, name };
