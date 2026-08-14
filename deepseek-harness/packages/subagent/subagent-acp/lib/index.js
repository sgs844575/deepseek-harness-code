import { accessSync, constants, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import z from "@deepseek-ai/schemastery";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import { randomUUID } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";
import { SessionId } from "@deepseek-ai/dsh-session";
import { AssistantOutputFold } from "@deepseek-ai/dsh-subagent";
//#region lib/types/run.js
/**
* Fresh-process ACP subagent client. Drives one child session and owns cancellation and
* quiescent disposal.
*
* TODO(acp-subagent-replay): add snapshot-tier coverage with a separate replay fixture and
* sessions root inside each child process. Current keyless coverage uses a scripted ACP child;
* with-key coverage drives the real ACP example.
* @module @deepseek-ai/dsh-subagent-acp/run
*/
/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
const DEFAULT_DISPOSE_EOF_GRACE_MS = 6e3;
/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
const DEFAULT_DISPOSE_GRACE_MS = 3e3;
/** Bounded whole-tree exit wait: polls the handle's tree liveness until it exits or `ms` elapses. */
async function treeExitsWithin(child, ms) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, ms);
	try {
		return await child.waitForExit(controller.signal);
	} finally {
		clearTimeout(timer);
	}
}
/**
* Cooperative teardown ladder for an out-of-process agent, over the seam's
* public verbs; resolves only at whole-tree quiescence: stdin EOF (the child's
* window to flush persistence and reap its own descendants), then the
* terminate() escalation (SIGTERM → spec grace → SIGKILL) and its
* whole-tree exit proof.
* @param child - the spawned ACP child's handle.
* @param eofGraceMs - tier-1 window after stdin EOF.
*/
async function disposeAcpChild(child, eofGraceMs) {
	if (child.pid <= 0) {
		await child.done.catch(() => {});
		return;
	}
	child.stdin?.end();
	if (await treeExitsWithin(child, eofGraceMs)) return;
	child.terminate();
	await child.waitForExit();
}
/**
* Map an ACP {@link StopReason} to a harness {@link SubagentStopReason}.
* @param reason - the terminal reason from the child's `session/prompt` response.
* @returns the harness equivalent; `max_turn_requests` and any unknown future
* variant map to `error`, so an unclean stop is never reported as `completed`.
*/
function acpStopReason(reason) {
	switch (reason) {
		case "end_turn": return "completed";
		case "max_tokens": return "max-tokens";
		case "refusal": return "refusal";
		case "cancelled": return "aborted";
		case "max_turn_requests": return "error";
		default: return "error";
	}
}
/**
* Collect the text of an ACP content block (non-text blocks contribute nothing).
* @param content - the content block off a streamed `agent_message_chunk`.
* @returns the block's text, or `''` for a non-text block.
*/
function acpContentText(content) {
	return content.type === "text" ? content.text : "";
}
/**
* Translate the harness prompt blocks into ACP prompt blocks (text only).
* @param prompt - the harness prompt; non-text blocks are dropped.
* @returns the ACP text blocks, in order.
*/
function toAcpPrompt(prompt) {
	const blocks = [];
	for (const block of prompt) if (block.type === "text") blocks.push({
		type: "text",
		text: block.text
	});
	return blocks;
}
/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
	/* v8 ignore next */
	return value instanceof Error ? value : new Error(String(value));
}
/**
* Start and publish one ACP child after initialization and session creation.
* Child failures resolve through the run result; startup failures reject after
* process reap. Disposal cancels, kills, and reaps the child.
* @param request - the start request; its signal is the cancellation channel.
* @param spec - the resolved spawn spec: command/args/cwd, env, permission
* policy, dispose graces, and the optional error sink.
* @returns the ready run handle for the child subprocess.
*/
async function startAcpRun(request, spec) {
	if (request.signal.aborted) throw new Error("subagent request was aborted before the ACP child started");
	const id = SessionId(randomUUID());
	const child = spec.spawn({
		argv: [spec.command, ...spec.args],
		cwd: spec.cwd,
		stdio: {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "inherit"
		},
		graceMs: spec.disposeGraceMs,
		env: spec.env
	});
	/* v8 ignore start -- 'pipe' dispositions expose both streams by the seam contract; defensive. */
	if (child.stdin === void 0 || child.stdout === void 0) throw new Error("subagent-acp: subprocess implementation dropped a piped protocol stream");
	/* v8 ignore stop */
	const spawnFailed = child.done.then(
		/* v8 ignore next -- the success arm's never-settling executor is intentionally empty. */
		() => new Promise(() => {}),
		(err) => Promise.reject(toError(err))
	);
	spawnFailed.catch(() => {});
	let processDisposal;
	const disposeProcess = () => processDisposal ??= disposeAcpChild(child, spec.disposeEofGraceMs);
	const fold = new AssistantOutputFold();
	const flags = { cancelled: false };
	const makeClient = (_agent) => ({
		sessionUpdate(params) {
			const update = params.update;
			if (update.sessionUpdate === "agent_message_chunk") fold.pushText(acpContentText(update.content));
			return Promise.resolve();
		},
		requestPermission(params) {
			if (spec.permission === "allow") {
				const allow = params.options.find((o) => o.kind === "allow_once" || o.kind === "allow_always");
				if (allow !== void 0) return Promise.resolve({ outcome: {
					outcome: "selected",
					optionId: allow.optionId
				} });
			}
			return Promise.resolve({ outcome: { outcome: "cancelled" } });
		}
	});
	const conn = new ClientSideConnection(makeClient, ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
	let sessionId;
	let signalCancelSettled;
	const cancelSettled = new Promise((resolve) => {
		signalCancelSettled = resolve;
	});
	const requestCancel = () => {
		if (flags.cancelled) return;
		flags.cancelled = true;
		signalCancelSettled();
		/* v8 ignore next */
		if (sessionId !== void 0) conn.cancel({ sessionId }).catch(() => {});
	};
	const onAbort = () => {
		requestCancel();
	};
	request.signal.addEventListener("abort", onAbort, { once: true });
	const collectOutput = () => fold.collect() ?? [];
	try {
		await Promise.race([
			(async () => {
				await conn.initialize({
					protocolVersion: PROTOCOL_VERSION,
					clientCapabilities: {}
				});
				const session = await conn.newSession({
					cwd: spec.cwd,
					mcpServers: []
				});
				const returnedSessionId = Reflect.get(session, "sessionId");
				if (typeof returnedSessionId !== "string") throw new Error("ACP child published without a session id");
				sessionId = returnedSessionId;
				if (flags.cancelled) throw new Error("subagent cancelled before the ACP session started");
			})(),
			spawnFailed,
			cancelSettled.then(() => {
				throw new Error("subagent cancelled before the ACP session started");
			})
		]);
	} catch (error) {
		request.signal.removeEventListener("abort", onAbort);
		await disposeProcess();
		if (flags.cancelled) throw new Error("subagent request was aborted before the ACP child started");
		throw toError(error);
	}
	/* v8 ignore next */
	if (sessionId === void 0) throw new Error("unreachable: ACP startup fulfilled without a session id");
	const remoteSessionId = sessionId;
	const result = (async () => {
		try {
			const prompt = async () => {
				const promptResult = await conn.prompt({
					sessionId: remoteSessionId,
					prompt: toAcpPrompt(request.prompt)
				});
				return {
					output: collectOutput(),
					stopReason: acpStopReason(promptResult.stopReason)
				};
			};
			return await Promise.race([prompt(), cancelSettled.then(() => ({
				output: collectOutput(),
				stopReason: "aborted"
			}))]);
		} catch (error) {
			/* v8 ignore next */
			if (flags.cancelled) return {
				output: collectOutput(),
				stopReason: "aborted"
			};
			try {
				spec.onError?.(toError(error), "error");
			} catch {}
			return {
				output: collectOutput(),
				stopReason: "error"
			};
		} finally {
			request.signal.removeEventListener("abort", onAbort);
		}
	})();
	let disposal;
	return {
		id,
		localAgent: void 0,
		result,
		dispose() {
			if (disposal !== void 0) return disposal;
			request.signal.removeEventListener("abort", onAbort);
			requestCancel();
			disposal = disposeProcess();
			return disposal;
		}
	};
}
//#endregion
//#region lib/types/index.js
/**
* Out-of-process ACP subagent backend. Each child has its own process, session, model, and
* tools, so it shares no Cordis context and advertises no parent-enforced start capabilities;
* the ONE thing it reads off `request.parent` is the session's workspace cwd (see
* {@link resolveCwd}). This plugin uses named exports only; a default would hide its
* loader metadata (see `docs/postmortem/0001-acp-default-export-drops-inject.md`).
* @module @deepseek-ai/dsh-subagent-acp
*/
const name = "subagent-acp";
const inject = ["subagents", "subprocess"];
const Config = z.object({
	providerName: z.string().default("acp"),
	command: z.string().required(),
	args: z.array(z.string()).default([]),
	cwd: z.string(),
	permission: z.union(["allow", "reject"]).default("reject"),
	env: z.dict(z.string()).default({}),
	disposeEofGraceMs: z.number().default(DEFAULT_DISPOSE_EOF_GRACE_MS),
	disposeGraceMs: z.number().default(DEFAULT_DISPOSE_GRACE_MS)
});
/** A dispose grace must fit the single Node timer that owns its teardown tier. */
function assertPositiveFinite(name, value) {
	if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) throw new Error(`subagent-acp: ${name} must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`);
}
/**
* Whether `path` names an existing directory the harness can ENTER. The
* search-permission probe matters: `statSync().isDirectory()` is true for a
* mode-600 directory, but a subprocess cwd needs `X_OK` or spawn fails EACCES.
*/
function isDirectory(path) {
	try {
		if (!statSync(path).isDirectory()) return false;
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
/**
* Assert `cwd` can actually host the child: absolute (it doubles as the ACP
* session workspace, and a relative path would be re-anchored to the server
* process's launch directory) and an existing directory (fail here, before the
* process boundary, instead of as an ambiguous spawn ENOENT).
* @param label - which source supplied the value, for the diagnostic.
* @param cwd - the candidate working directory.
* @returns `cwd`, validated.
*/
function assertUsableCwd(label, cwd) {
	if (!isAbsolute(cwd)) throw new Error(`subagent-acp: ${label} must be an absolute path: ${cwd}`);
	if (!isDirectory(cwd)) throw new Error(`subagent-acp: ${label} is not an accessible directory: ${cwd}`);
	return cwd;
}
/**
* Resolve the child's working directory: the deployment `cwd` override when
* configured (already validated at load), else the parent session's workspace
* cwd (validated here, its earliest resolvable point). Fails loud when neither
* exists — falling back to the harness process cwd would silently bind the
* child to the server's launch directory instead of the delegating session's
* workspace (one server process serves many sessions, each with its own cwd).
*/
function resolveCwd(configured, request) {
	if (configured !== void 0) return configured;
	const parentCwd = request.parent.session.header.cwd;
	if (parentCwd === void 0) throw new Error("subagent-acp: no working directory for the child — configure `cwd` or delegate from a parent session that has one");
	return assertUsableCwd("parent session cwd", parentCwd);
}
/**
* The ACP provider. Advertises NO start-time capabilities: an out-of-process
* child cannot honor `outputSchema`/`maxDepth`/`toolFilter` (the service rejects
* a request needing any of them before `start` runs).
*/
var AcpProvider = class {
	name;
	ctx;
	config;
	capabilities = {
		outputSchema: false,
		depthLimit: false,
		toolFilter: false,
		persona: false
	};
	inheritsParentContext = false;
	constructor(name, ctx, config) {
		this.name = name;
		this.ctx = ctx;
		this.config = config;
	}
	start(request) {
		return startAcpRun(request, {
			command: this.config.command,
			args: this.config.args,
			cwd: resolveCwd(this.config.cwd, request),
			permission: this.config.permission,
			env: this.config.env,
			disposeEofGraceMs: this.config.disposeEofGraceMs,
			disposeGraceMs: this.config.disposeGraceMs,
			spawn: (spec) => this.ctx.subprocess.spawn(spec),
			onError: (error, stopReason) => {
				this.ctx.logger.warn(`subagent-acp "${this.name}": child run failed (${stopReason}): ${error.message}`);
			}
		});
	}
};
function apply(ctx, config) {
	const resolved = config;
	assertPositiveFinite("disposeEofGraceMs", resolved.disposeEofGraceMs);
	assertPositiveFinite("disposeGraceMs", resolved.disposeGraceMs);
	if (resolved.cwd === "") throw new Error("subagent-acp: config cwd must not be empty — omit the key to inherit the parent session cwd");
	const validated = resolved.cwd === void 0 ? resolved : {
		...resolved,
		cwd: assertUsableCwd("config cwd", resolve(resolved.cwd))
	};
	ctx.subagents.registerProvider(new AcpProvider(validated.providerName, ctx, validated));
}
//#endregion
export { Config, apply, inject, name };
