/**
 * Automation-only Agent Client Protocol server over JSON-RPC stdio.
 *
 * The bridge exposes fresh harness sessions to trusted programmatic clients. It
 * carries prompt text, committed assistant text, cancellation, and one-shot
 * permission decisions; presentation and human-interaction features stay with
 * the harness's UI modules.
 *
 * @module @deepseek-ai/dsh-acp
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type Stream } from '@agentclientprotocol/sdk';
export declare const name = "acp";
/** The bridge creates and owns agents; every other concern is carried by the agent composition. */
export declare const inject: string[];
/** Plugin config: the provider/model selection used for each ACP-created agent. */
export interface AcpConfig {
    /** Provider route for created agents. */
    provider?: string;
    /** Model name for created agents. */
    model?: string;
    /** Runtime-only transport override; production uses stdio. */
    stream?: Stream;
}
export declare const Config: Schema<AcpConfig>;
/**
 * Mount the automation-only ACP server.
 * @param ctx - Cordis context carrying the agent factory and session events.
 * @param config - Initial provider/model selection and optional test transport.
 */
export declare function apply(ctx: Context, config: AcpConfig): void;
//# sourceMappingURL=index.d.ts.map