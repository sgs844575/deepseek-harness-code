/**
 * One-shot Codex child lifecycle: spawn the real app-server through the
 * subprocess seam, publish only after initialization and ephemeral thread
 * creation, flatten post-publication failures, and dispose to whole-tree
 * quiescence.
 *
 * @module @deepseek-ai/dsh-subagent-codex/run
 */
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { settleRunResult, subprocessRunHandle, } from '@deepseek-ai/dsh-subagent';
import { CodexAppServerWire } from "./wire.js";
/** Default POSIX grace between subprocess termination tiers. */
export const DEFAULT_DISPOSE_GRACE_MS = 3_000;
/**
 * Resolve the fixed app-server command for a platform.
 *
 * Windows npm and pnpm installs expose `codex.cmd`, which requires `cmd.exe`;
 * the argv is constant so no task or configuration text enters the
 * shell boundary.
 * @param platform - host platform used to select the executable boundary.
 * @returns argv for the fixed Codex app-server command.
 */
export function codexAppServerArgv(platform = process.platform) {
    return platform === 'win32'
        ? ['cmd.exe', '/d', '/s', '/c', 'codex', 'app-server', '--stdio']
        : ['codex', 'app-server', '--stdio'];
}
function thrown(value) {
    /* v8 ignore next -- typed subprocess/wire failures reject with Error. */
    return value instanceof Error ? value : new Error(String(value));
}
/**
 * Validate and preserve the one-shot task before crossing the process boundary.
 * @param prompt - task content accepted from the shared subagent service.
 * @returns the exact non-empty text block sequence.
 */
export function textTask(prompt) {
    if (prompt.length === 0) {
        throw new Error('subagent-codex: the one-shot task must contain only text blocks');
    }
    const texts = [];
    for (const block of prompt) {
        if (block.type !== 'text') {
            throw new Error('subagent-codex: the one-shot task must contain only text blocks');
        }
        texts.push(block.text);
    }
    if (texts.every(text => text.trim().length === 0)) {
        throw new Error('subagent-codex: the one-shot task must not be empty');
    }
    return texts;
}
/**
 * Close the private wire, terminate the managed process tree, and wait for the
 * subprocess owner to prove it is gone.
 * @param wire - private app-server protocol connection.
 * @param child - shared-service handle that owns the process tree.
 */
export async function disposeCodexChild(wire, child) {
    wire.close();
    if (child.pid <= 0) {
        await child.done.catch(() => { });
        return;
    }
    try {
        child.stdin?.end();
    }
    catch {
        // A concurrently closed stdin does not change tree ownership below.
    }
    child.terminate();
    await child.waitForExit();
    await child.done;
}
/**
 * Start the real `codex app-server --stdio` child and publish its one-shot run.
 * @param request - resolved shared subagent request.
 * @param spec - Workspace, environment, process service, and diagnostic policy.
 * @returns the published run after initialization and ephemeral thread creation.
 */
export async function startCodexRun(request, spec) {
    const texts = textTask(request.prompt);
    if (request.signal.aborted) {
        throw new Error('subagent-codex: request was aborted before app-server startup');
    }
    const child = spec.spawn({
        argv: codexAppServerArgv(),
        cwd: spec.cwd,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'inherit' },
        graceMs: spec.disposeGraceMs,
        env: spec.env,
    });
    const wire = new CodexAppServerWire(child.stdout, child.stdin);
    const disposeProcess = () => disposeCodexChild(wire, child);
    const processFailure = child.done.then(outcome => Promise.reject(new Error('subagent-codex: app-server exited before the run settled '
        + `(code ${String(outcome.exitCode)}, signal ${String(outcome.signal)})`)), (error) => Promise.reject(thrown(error)));
    // A normal post-result dispose also closes the process. Keep that expected
    // late rejection observed after the result race has already settled.
    processFailure.catch(() => { });
    const runAbort = new AbortController();
    const requestCancel = () => {
        if (runAbort.signal.aborted)
            return;
        runAbort.abort(new Error('subagent-codex: run cancelled locally'));
        wire.interrupt();
    };
    const onAbort = () => { requestCancel(); };
    request.signal.addEventListener('abort', onAbort, { once: true });
    try {
        wire.start();
        await Promise.race([wire.initialize(request.signal), processFailure]);
        await Promise.race([wire.startThread(spec.cwd, request.signal), processFailure]);
    }
    catch (error) {
        request.signal.removeEventListener('abort', onAbort);
        try {
            await disposeProcess();
        }
        catch (disposeError) {
            throw new AggregateError([thrown(error), thrown(disposeError)], 'subagent-codex: startup failed and app-server cleanup also failed');
        }
        if (runAbort.signal.aborted) {
            throw new Error('subagent-codex: request was aborted before run publication');
        }
        throw thrown(error);
    }
    const collectOutput = () => wire.collectOutput();
    const result = settleRunResult({
        attempt: () => Promise.race([
            wire.runTurn(texts, runAbort.signal),
            processFailure,
        ]),
        collectOutput,
        cancelled: () => runAbort.signal.aborted,
        onError: spec.onError,
        signal: request.signal,
        onAbort,
    });
    return subprocessRunHandle({
        id: SessionId(randomUUID()),
        result,
        signal: request.signal,
        onAbort,
        requestCancel,
        teardown: disposeProcess,
    });
}
//# sourceMappingURL=run.js.map