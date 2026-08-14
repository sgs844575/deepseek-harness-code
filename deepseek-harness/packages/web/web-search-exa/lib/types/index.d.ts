/**
 * `@deepseek-ai/dsh-web-search-exa`: registers an Exa-backed `WebSearchProvider`
 * with `ctx.web`. A function/namespace plugin (NOT a default-export service):
 * a search provider does not own the `ctx.web` key — it registers INTO the
 * seam's provider registry, exactly as `@deepseek-ai/dsh-llm-deepseek`
 * registers an adapter into `ctx.llm`. The key is owned by `@deepseek-ai/dsh-web`.
 *
 * @module @deepseek-ai/dsh-web-search-exa
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export { EXA_DEFAULT_BASE_URL, EXA_DEFAULT_HIGHLIGHTS_PER_RESULT, EXA_DEFAULT_SEARCH_TYPE, EXA_PROVIDER_ID, ExaSearchProvider, } from './provider.ts';
export type { ExaSearchProviderOptions } from './provider.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "web-search-exa";
/** The web seam this provider registers into. */
export declare const inject: string[];
/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
    /** Exa API key. Falls back to `$EXA_API_KEY`. Empty → provider unavailable. */
    apiKey?: string;
    /** Endpoint base; `/search` is appended. Defaults to the public API. */
    baseURL?: string;
    /** Retrieval mode sent as Exa's `type`. Defaults to `auto`. */
    searchType?: 'auto' | 'keyword' | 'neural';
    /** Default result count when a request carries no `maxResults`. Omitted = none. */
    numResults?: number;
    /** Highlight sentences requested per result. Defaults to 1. */
    highlightsPerResult?: number;
}
export declare const Config: z<Config>;
/** Register the Exa search provider with `ctx.web`. */
export declare function apply(ctx: Context, config: Config): void;
//# sourceMappingURL=index.d.ts.map