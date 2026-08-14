/**
 * JSON-RPC methods and notifications for out-of-process harness SDKs.
 * The surrounding context owns plugins, persistence, and configured adapters.
 *
 * @module @deepseek-ai/dsh-sdk-jsonrpc-server/server
 */
import { resolve } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { carrierKeyOf } from '@deepseek-ai/dsh-scope';
import { SessionId } from '@deepseek-ai/dsh-session';
import * as LlmDeepSeek from '@deepseek-ai/dsh-llm-deepseek';
/** Recover the delegating parent from the service-owned scoped carrier. */
function subagentParentOf(carrier) {
    return carrierKeyOf(carrier);
}
function successStatus(reason, options) {
    if (reason === 'completed')
        return 'ok';
    return reason === 'max-tokens' && options.maxTokensAsSuccess === true ? 'ok' : 'error';
}
/**
 * SDK server over one booted harness context and transport peer. Construction
 * subscribes to session, agent, and subagent lifecycle events until shutdown;
 * reinitialization is unsupported.
 */
export class HarnessSdkJsonRpcServer {
    ctx;
    transport;
    options;
    cwd = process.cwd();
    provider = 'deepseek-official';
    model = 'deepseek-official';
    maxTokens;
    llmFiber;
    sessions = new Map();
    sessionCreations = new Map();
    disposers = [];
    shutdownTask;
    shuttingDown = false;
    constructor(ctx, transport, options = {}) {
        this.ctx = ctx;
        this.transport = transport;
        this.options = options;
        const serverOptions = this.options;
        this.disposers.push(ctx.on('session/event', (session, event) => {
            const payload = { sessionId: String(session.id), event };
            this.transport.notify('session.event', payload);
        }));
        this.disposers.push(ctx.on('agent/status', ({ agent, status }) => {
            this.transport.notify('session.status', { sessionId: String(agent.session.id), status });
        }));
        this.disposers.push(ctx.on('session/created', (session) => {
            const parentSession = session.header.parentSession;
            if (parentSession === undefined)
                return;
            const payload = {
                parentSessionId: String(parentSession),
                childSessionId: String(session.id),
            };
            this.transport.notify('subagent.started', payload);
        }));
        this.disposers.push(ctx.on('subagent/end', function (info) {
            const parent = subagentParentOf(this);
            // This protocol reports only in-process child sessions. The service
            // snapshots the provider name and local flag through child disposal;
            // matching ids or parent lineage alone never establishes locality.
            if (!info.local)
                return;
            const payload = {
                provider: info.provider,
                agentId: String(info.id),
                parentSessionId: String(parent.session.id),
                childSessionId: String(info.id),
                status: successStatus(info.stopReason, serverOptions),
                stopReason: info.stopReason,
                ...(info.lastAssistantMessage === undefined ? {} : { lastAssistantMessage: info.lastAssistantMessage }),
            };
            transport.notify('subagent.finished', payload);
        }));
    }
    /**
     * Configure the SDK route, mounting the DeepSeek fallback only when unowned.
     * @param params - SDK handshake parameters.
     * @returns server identity for the handshake.
     */
    async initialize(params) {
        if (params.maxTokens !== undefined
            && (!Number.isSafeInteger(params.maxTokens) || params.maxTokens <= 0)) {
            throw new TypeError('initialize maxTokens must be a positive safe integer');
        }
        this.cwd = resolve(params.cwd);
        this.provider = params.provider;
        this.model = params.model;
        this.maxTokens = params.maxTokens;
        if (!this.hasAdapterFor(this.provider)) {
            if (this.provider !== 'deepseek-official')
                throw new Error(`no adapter registered for provider "${this.provider}"`);
            this.llmFiber = await this.ctx.plugin(LlmDeepSeek, {});
        }
        return { serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } };
    }
    /**
     * Queue one identified prompt without assigning later activity to it.
     * @param params - target session and user content.
     * @returns the durable message identity.
     */
    async prompt(params) {
        const rec = await this.getOrCreateSession(params.sessionId);
        // An agent-loop-only reload disposes the loop's agents while this record
        // survives; a retained agent accepts followup() silently, so validate the
        // record against the live registry before delivery (as the ACP bridge does).
        if (this.ctx.agents.get(rec.handle.agent.id) !== rec.handle.agent) {
            throw new Error(`session agent was disposed outside the server: ${params.sessionId}`);
        }
        const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } });
        rec.handle.agent.followup(message);
        return { messageId: message.id };
    }
    /**
     * Dispose server-owned agents, adapter, and subscriptions to quiescence.
     * The surrounding context remains running.
     * @returns empty JSON-RPC result.
     */
    shutdown() {
        this.shutdownTask ??= this.performShutdown();
        return this.shutdownTask;
    }
    async performShutdown() {
        this.shuttingDown = true;
        const pendingCreations = [...this.sessionCreations.values()];
        await Promise.allSettled(pendingCreations);
        this.sessionCreations.clear();
        const records = [...this.sessions.values()];
        this.sessions.clear();
        const failures = [];
        while (this.disposers.length > 0) {
            try {
                this.disposers.pop()?.();
            }
            catch (error) {
                failures.push(error);
            }
        }
        const teardownResults = await Promise.allSettled([
            ...records.map(rec => Promise.resolve().then(() => rec.handle.dispose())),
            ...(this.llmFiber === undefined ? [] : [Promise.resolve().then(() => this.llmFiber?.dispose())]),
        ]);
        this.llmFiber = undefined;
        failures.push(...teardownResults
            .filter((result) => result.status === 'rejected')
            .map(result => result.reason));
        if (failures.length === 1)
            throw failures[0];
        if (failures.length > 1)
            throw new AggregateError(failures, 'SDK server teardown failed');
        return {};
    }
    /**
     * Dispatch one incoming JSON-RPC request to its typed handler. Throws (→ a
     * JSON-RPC error response) on an unknown method.
     * @param method - the JSON-RPC method name.
     * @param params - the raw params object from the wire.
     * @returns the handler's result, to be serialized as the response.
     */
    async handleRequest(method, params) {
        switch (method) {
            case 'initialize':
                return this.initialize(params);
            case 'session/prompt':
                return this.prompt(params);
            case 'shutdown':
                return this.shutdown();
            default:
                throw new Error(`unknown DeepSeek Harness SDK runtime method: ${method}`);
        }
    }
    async getOrCreateSession(sessionId) {
        if (this.shuttingDown)
            throw new Error('SDK server is shutting down');
        const existing = this.sessions.get(sessionId);
        if (existing)
            return existing;
        const pending = this.sessionCreations.get(sessionId);
        if (pending)
            return pending;
        const creation = this.createSession(sessionId);
        this.sessionCreations.set(sessionId, creation);
        void creation.then(() => { this.sessionCreations.delete(sessionId); }, () => { this.sessionCreations.delete(sessionId); });
        return creation;
    }
    async createSession(sessionId) {
        // No preset composition: this server's compositions keep the model-facing
        // rows in the host plane, so this agent reads them from the global layer. A
        // deployment that configures a roster has to join one here first
        // (@deepseek-ai/dsh-agent-presets README, "Composing a child agent").
        const handle = await this.ctx.agents.create({
            sessionId: SessionId(sessionId),
            meta: { cwd: this.cwd },
            agentOptions: {
                provider: this.provider,
                model: this.model,
                ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
            },
        });
        const rec = { handle };
        this.sessions.set(sessionId, rec);
        return rec;
    }
    hasAdapterFor(provider) {
        return this.ctx.get('llm')?.listProviders().some(entry => entry.id === provider) ?? false;
    }
}
//# sourceMappingURL=server.js.map