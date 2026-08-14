/**
 * Safe HTTP(S) retrieval for `ctx.web`: validates URLs, follows only same-origin redirects,
 * enforces time and size limits, classifies and decodes text, and leaves presentation to
 * `@deepseek-ai/dsh-tool-web`. Requests carry no browser cookies or ambient credentials.
 *
 * Private-network and SSRF protection is not implemented; do not enable this provider where
 * it can reach sensitive internal targets.
 * @module @deepseek-ai/dsh-web-fetch-http/provider
 */
import type { WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web';
/** Resolved provider limits (the plugin's schemastery Config supplies defaults). */
export interface HttpFetchLimits {
    /** Maximum accepted request URL length. */
    maxUrlLength: number;
    /** Maximum response body size in bytes (read is aborted past this). */
    maxResponseBytes: number;
    /** Maximum decoded body length in characters (truncated past this). */
    maxBodyChars: number;
    /** Default fetch timeout in milliseconds. */
    timeoutMs: number;
    /** Maximum number of (same-origin) redirect hops to follow. */
    maxRedirects: number;
    /** `User-Agent` header sent on every request. */
    userAgent: string;
}
/** Stable id this provider registers under. */
export declare const LOCAL_FETCH_PROVIDER_ID = "http";
/** The anonymous public HTTP(S) fetch provider. */
export declare class HttpFetchProvider implements WebFetchProvider {
    private readonly limits;
    readonly id = "http";
    constructor(limits: HttpFetchLimits);
    /** No credentials to check — an anonymous public fetcher is always usable. */
    available(): boolean;
    fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult>;
    /** Follow same-origin redirects up to the hop cap, then read the final response. */
    private followAndRead;
    private requestOnce;
    /** Read, byte-cap, classify, and decode the final response body. */
    private readBody;
    /**
     * Read the response stream up to `maxResponseBytes`. A `Content-Length` over
     * the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
     * past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
     * server that under-reports still yields a bounded usable body.
     */
    private readCapped;
}
//# sourceMappingURL=provider.d.ts.map