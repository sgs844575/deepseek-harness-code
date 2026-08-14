/**
 * TypeScript client SDK for the DeepSeek Harness runtime: spawn the
 * `dsh-jsonrpc-agent` runtime as a subprocess and drive agent turns over
 * stdio JSON-RPC. `DeepSeekHarness` is the high-level run API;
 * `HarnessClient` is the lower-level protocol client. A pure library — it
 * registers nothing on a Cordis context; the runtime process it spawns is a
 * complete harness configured by its own `cordis.yml`.
 *
 * @module @deepseek-ai/dsh-sdk-client
 */
export { DeepSeekHarness, HarnessSession } from "./api.js";
export { HarnessClient, RequestTimeoutError, SdkProtocolError, TransportClosedError, } from "./client.js";
export { JsonRpcResponseError } from '@deepseek-ai/dsh-sdk-protocol';
//# sourceMappingURL=index.js.map