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
import { randomUUID } from 'node:crypto';
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client';
import { SessionId } from '@deepseek-ai/dsh-session';
import { AssistantOutputFold, settleRunResult, subprocessRunHandle } from '@deepseek-ai/dsh-subagent';
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess';
/** EOF grace for child flush and nested-process teardown; wider than the signal grace below. */
export const DEFAULT_DISPOSE_EOF_GRACE_MS = 6_000;
/** Default POSIX grace between SIGTERM and SIGKILL on dispose (the `disposeGraceMs` config). */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000;
/** Default bound on the protocol `shutdown` exchange during dispose. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_000;
/**
 * Map a child turn-end reason to a harness {@link SubagentStopReason}.
 * @param reason - the owned child run's final durable turn reason, or
 * `undefined` when it settled without running a turn.
 * @returns the harness equivalent; an absent or unknown reason maps to
 * `error`, so an unclean stop is never reported as `completed`.
 */
export function sdkStopReason(reason) {
    switch (reason?.kind) {
        case 'completed':
            return 'completed';
        case 'max-tokens':
            return 'max-tokens';
        case 'aborted':
            return 'aborted';
        // error / interrupted / disposed / a future merged variant /
        // no turn at all: the task did NOT finish cleanly — surface a generic
        // failure so the consumer maps it to an isError result.
        default:
            return 'error';
    }
}
/** Normalize an unknown thrown value to an Error (the catch binding is `unknown`). */
function toError(value) {
    // The catch only sees rejections from the SDK client, which are always
    // `Error`s; the `String(value)` arm is a defensive fallback for a non-Error
    // throw that the typed surfaces cannot produce.
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
export async function startSdkRun(request, spec) {
    if (request.signal.aborted)
        throw new Error('subagent request was aborted before the SDK child started');
    // The run id lives in the parent namespace; the child runtime's session id
    // (minted below, private to the wire) exists only inside the child process.
    const id = SessionId(randomUUID());
    const harness = new DeepSeekHarness({
        launch: {
            command: spec.command,
            args: spec.args,
            cwd: spec.cwd,
            env: { ...scrubbedParentEnv(), ...spec.env },
            shutdownTimeoutMs: spec.shutdownTimeoutMs,
            disposeEofGraceMs: spec.disposeEofGraceMs,
            disposeGraceMs: spec.disposeGraceMs,
        },
        cwd: spec.cwd,
        provider: spec.provider,
        model: spec.model,
        ...spec.maxTokens === undefined ? {} : { maxTokens: spec.maxTokens },
    });
    // Cancellation settles the result without waiting for a cooperative child.
    const flags = { cancelled: false };
    let signalCancelSettled;
    const cancelSettled = new Promise((resolve) => { signalCancelSettled = resolve; });
    const requestCancel = () => {
        if (flags.cancelled)
            return;
        flags.cancelled = true;
        signalCancelSettled();
    };
    const onAbort = () => { requestCancel(); };
    request.signal.addEventListener('abort', onAbort, { once: true });
    // Establish the child handshake before publishing a handle. Any failure
    // owns the still-private process and reaps it before rejecting.
    try {
        await Promise.race([
            harness.start(),
            cancelSettled.then(() => { throw new Error('subagent cancelled before the SDK child initialized'); }),
        ]);
        // Defensive: an abort() is a macrotask and no user callback runs inside
        // the microtask drain between handshake fulfillment and this continuation,
        // so the recheck is not schedulable today; it guards future reentrancy.
        /* v8 ignore next */
        if (flags.cancelled)
            throw new Error('subagent cancelled before the SDK child initialized');
    }
    catch (error) {
        request.signal.removeEventListener('abort', onAbort);
        await harness.close();
        if (flags.cancelled)
            throw new Error('subagent request was aborted before the SDK child started');
        throw toError(error);
    }
    const childSessionId = `session-${randomUUID().replaceAll('-', '')}`;
    // The child's final answer under the seam's canonical selection rule
    // (`AssistantOutputFold`); a partial answer survives cancel and error paths.
    const fold = new AssistantOutputFold();
    const observe = (notification) => {
        if (notification.method !== 'session.event' || notification.params.sessionId !== childSessionId)
            return;
        fold.push(notification.params.event);
    };
    const collectOutput = () => fold.collect() ?? [];
    // Race the child turn against local cancellation; the shared settlement
    // flattens failures under the seam's never-reject contract.
    const result = settleRunResult({
        attempt: async () => {
            const turn = await Promise.race([
                harness.session(childSessionId).run(request.prompt, { onNotification: observe }),
                cancelSettled.then(() => 'cancelled'),
            ]);
            if (turn === 'cancelled')
                return { output: collectOutput(), stopReason: 'aborted' };
            const lastEnd = turn.events.findLast((event) => event.type === 'turn/end');
            return { output: collectOutput(), stopReason: sdkStopReason(lastEnd?.data.reason) };
        },
        collectOutput,
        cancelled: () => flags.cancelled,
        onError: spec.onError,
        signal: request.signal,
        onAbort,
    });
    // There is no wire-level prompt cancel: dispose settles the result locally,
    // then the bounded shutdown request + dispose ladder tears the child down.
    return subprocessRunHandle({
        id,
        result,
        signal: request.signal,
        onAbort,
        requestCancel,
        teardown: () => harness.close(),
    });
}
//# sourceMappingURL=run.js.map