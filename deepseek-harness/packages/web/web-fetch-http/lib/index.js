import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
import { deadline, timeoutOf } from "@deepseek-ai/dsh-timeout";
//#region lib/types/policy.js
/**
* URL validation and content-type classification for the local HTTP(S) fetch
* provider — the pure, network-free half. The provider's `fetch()` composes
* these with transport (redirect following, byte caps, decoding).
*
* @module @deepseek-ai/dsh-web-fetch-http/policy
*/
/**
* Validate a request URL against the basic transport hygiene the provider
* enforces before any network access: http(s) only, no embedded credentials,
* bounded length. Returns the parsed `URL`. Throws {@link WebError} otherwise.
* (SSRF / private-network blocking is deferred — see the package Agent Note.)
*
* @param input - the raw URL string from the fetch request.
* @param maxUrlLength - inclusive upper bound on `input`'s length.
* @returns the parsed `URL`.
*/
function validateFetchUrl(input, maxUrlLength) {
	if (input.length > maxUrlLength) throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, "WEB_INVALID_URL");
	let url;
	try {
		url = new URL(input);
	} catch (error) {
		throw new WebError(`invalid URL: ${input}`, "WEB_INVALID_URL", { cause: error });
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, "WEB_INVALID_URL");
	if (url.username.length > 0 || url.password.length > 0) throw new WebError("credentials in URLs are not allowed", "WEB_BLOCKED_URL");
	return url;
}
/**
* Two URLs are same-origin when scheme, hostname, and port match. A redirect
* that crosses origins is refused so each new origin requires a fresh tool call
* (and thus a fresh provider/permission decision).
*
* @param a - one of the two URLs to compare.
* @param b - the other URL to compare.
* @returns true when `a` and `b` share scheme, hostname, and port.
*/
function isSameOrigin(a, b) {
	return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port;
}
/**
* Classify a response `Content-Type` into a decodable body kind, or `undefined`
* for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
* are `html`; other `text/*` plus a few structured text types are `text`.
*
* @param contentType - the raw `Content-Type` header, or `null` when the
*   response carries none (unsupported).
* @returns the decodable kind, or `undefined` for an unsupported type.
*/
function classifyContentType(contentType) {
	const mime = (contentType ?? "").replace(/;.*$/s, "").trim().toLowerCase();
	if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
	if (mime.startsWith("text/")) return "text";
	if (mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml")) return "text";
}
/**
* Extract the `charset` parameter from a response `Content-Type`, lower-cased,
* or `undefined` when absent. The provider feeds this label to `TextDecoder`
* so a non-UTF-8 response is decoded with its declared encoding rather than
* silently mangled into replacement characters.
*
* @param contentType - the raw `Content-Type` header, or `null` when the
*   response carries none.
* @returns the lower-cased charset label, or `undefined` when none is declared.
*/
function parseCharset(contentType) {
	return /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? "")?.[1]?.trim().toLowerCase();
}
/**
* Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
* none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
* the label is present but not a charset `TextDecoder` recognizes — better to
* fail loudly than return mojibake.
*
* @param charset - the declared charset label (from {@link parseCharset}), or
*   `undefined` to default to UTF-8.
* @returns a decoder for the declared (or defaulted) encoding.
*/
function decoderForCharset(charset) {
	if (charset === void 0) return new TextDecoder("utf-8");
	try {
		return new TextDecoder(charset);
	} catch (error) {
		throw new WebError(`unsupported charset "${charset}"`, "WEB_UNSUPPORTED_CONTENT_TYPE", { cause: error });
	}
}
//#endregion
//#region lib/types/provider.js
/**
* Safe HTTP(S) retrieval for `ctx.web`: validates URLs, follows only same-origin redirects,
* enforces time and size limits, classifies and decodes text, and leaves presentation to
* `@deepseek-ai/dsh-tool-web`. Requests carry no browser cookies or ambient credentials.
*
* Private-network and SSRF protection is not implemented; do not enable this provider where
* it can reach sensitive internal targets.
* @module @deepseek-ai/dsh-web-fetch-http/provider
*/
var __addDisposableResource = function(env, value, async) {
	if (value !== null && value !== void 0) {
		if (typeof value !== "object" && typeof value !== "function") throw new TypeError("Object expected.");
		var dispose, inner;
		if (async) {
			if (!Symbol.asyncDispose) throw new TypeError("Symbol.asyncDispose is not defined.");
			dispose = value[Symbol.asyncDispose];
		}
		if (dispose === void 0) {
			if (!Symbol.dispose) throw new TypeError("Symbol.dispose is not defined.");
			dispose = value[Symbol.dispose];
			if (async) inner = dispose;
		}
		if (typeof dispose !== "function") throw new TypeError("Object not disposable.");
		if (inner) dispose = function() {
			try {
				inner.call(this);
			} catch (e) {
				return Promise.reject(e);
			}
		};
		env.stack.push({
			value,
			dispose,
			async
		});
	} else if (async) env.stack.push({ async: true });
	return value;
};
var __disposeResources = (function(SuppressedError) {
	return function(env) {
		function fail(e) {
			env.error = env.hasError ? new SuppressedError(e, env.error, "An error was suppressed during disposal.") : e;
			env.hasError = true;
		}
		var r, s = 0;
		function next() {
			while (r = env.stack.pop()) try {
				if (!r.async && s === 1) return s = 0, env.stack.push(r), Promise.resolve().then(next);
				if (r.dispose) {
					var result = r.dispose.call(r.value);
					if (r.async) return s |= 2, Promise.resolve(result).then(next, function(e) {
						fail(e);
						return next();
					});
				} else s |= 1;
			} catch (e) {
				fail(e);
			}
			if (s === 1) return env.hasError ? Promise.reject(env.error) : Promise.resolve();
			if (env.hasError) throw env.error;
		}
		return next();
	};
})(typeof SuppressedError === "function" ? SuppressedError : function(error, suppressed, message) {
	var e = new Error(message);
	return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
});
/** Stable id this provider registers under. */
const LOCAL_FETCH_PROVIDER_ID = "http";
/** The anonymous public HTTP(S) fetch provider. */
var HttpFetchProvider = class {
	limits;
	id = LOCAL_FETCH_PROVIDER_ID;
	constructor(limits) {
		this.limits = limits;
	}
	/** No credentials to check — an anonymous public fetcher is always usable. */
	available() {
		return true;
	}
	async fetch(request, signal) {
		const env_1 = {
			stack: [],
			error: void 0,
			hasError: false
		};
		try {
			if (signal?.aborted) throw new WebError("web fetch aborted", "WEB_ABORTED");
			const d = __addDisposableResource(env_1, deadline(signal, this.limits.timeoutMs, "WEB_FETCH_TIMEOUT"), false);
			return await this.followAndRead(request.url, d.signal);
		} catch (e_1) {
			env_1.error = e_1;
			env_1.hasError = true;
		} finally {
			__disposeResources(env_1);
		}
	}
	/** Follow same-origin redirects up to the hop cap, then read the final response. */
	async followAndRead(initialUrl, signal) {
		let currentUrl = validateFetchUrl(initialUrl, this.limits.maxUrlLength);
		let redirectsFollowed = 0;
		for (;;) {
			const response = await this.requestOnce(currentUrl, signal);
			if (isRedirectStatus(response.status)) {
				if (redirectsFollowed >= this.limits.maxRedirects) {
					await response.body?.cancel();
					throw new WebError(`exceeded the maximum of ${this.limits.maxRedirects} redirects`, "WEB_REDIRECT_BLOCKED");
				}
				const location = response.headers.get("location");
				if (location === null) {
					await response.body?.cancel();
					throw new WebError(`redirect response (HTTP ${response.status}) without a Location header`, "WEB_PROVIDER_ERROR");
				}
				const target = resolveRedirect(location, currentUrl);
				let validatedTarget;
				try {
					validatedTarget = validateFetchUrl(target.toString(), this.limits.maxUrlLength);
					if (!isSameOrigin(validatedTarget, currentUrl)) throw new WebError(`cross-origin redirect to ${validatedTarget.origin} is not followed automatically; retry against that URL directly`, "WEB_REDIRECT_BLOCKED");
				} catch (error) {
					await response.body?.cancel();
					throw error;
				}
				await response.body?.cancel();
				currentUrl = validatedTarget;
				redirectsFollowed++;
				continue;
			}
			return await this.readBody(response, currentUrl, signal);
		}
	}
	async requestOnce(url, signal) {
		try {
			return await fetch(url, {
				method: "GET",
				redirect: "manual",
				headers: {
					"user-agent": this.limits.userAgent,
					"accept": "text/html,application/xhtml+xml,text/*;q=0.9,application/json;q=0.8"
				},
				signal
			});
		} catch (error) {
			throw translateAbortOrNetwork(error, signal);
		}
	}
	/** Read, byte-cap, classify, and decode the final response body. */
	async readBody(response, finalUrl, signal) {
		const contentType = response.headers.get("content-type");
		const kind = classifyContentType(contentType);
		if (kind === void 0) {
			await response.body?.cancel();
			throw new WebError(`unsupported content type "${contentType ?? "unknown"}"`, "WEB_UNSUPPORTED_CONTENT_TYPE");
		}
		let decoder;
		try {
			decoder = decoderForCharset(parseCharset(contentType));
		} catch (error) {
			await response.body?.cancel();
			throw error;
		}
		const { bytes, truncatedByBytes } = await this.readCapped(response, signal);
		const decoded = decoder.decode(bytes);
		const truncatedByChars = decoded.length > this.limits.maxBodyChars;
		const content = truncatedByChars ? decoded.slice(0, this.limits.maxBodyChars) : decoded;
		const body = kind === "html" ? {
			kind: "html",
			content
		} : {
			kind: "text",
			content
		};
		return {
			url: finalUrl.toString(),
			statusCode: response.status,
			body,
			truncated: truncatedByBytes || truncatedByChars
		};
	}
	/**
	* Read the response stream up to `maxResponseBytes`. A `Content-Length` over
	* the cap rejects immediately with `WEB_FETCH_TOO_LARGE`; a stream that grows
	* past the cap is cut short (`truncatedByBytes`) rather than rejected, so a
	* server that under-reports still yields a bounded usable body.
	*/
	async readCapped(response, signal) {
		const declared = response.headers.get("content-length");
		if (declared !== null) {
			const length = Number(declared);
			if (Number.isFinite(length) && length > this.limits.maxResponseBytes) {
				await response.body?.cancel();
				throw new WebError(`response exceeds the maximum of ${this.limits.maxResponseBytes} bytes`, "WEB_FETCH_TOO_LARGE");
			}
		}
		/* v8 ignore next -- a 2xx Response from fetch always exposes a body stream; the null guard is defensive. */
		if (response.body === null) return {
			bytes: new Uint8Array(0),
			truncatedByBytes: false
		};
		const chunks = [];
		let total = 0;
		let truncatedByBytes = false;
		const reader = response.body.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				const remaining = this.limits.maxResponseBytes - total;
				if (value.byteLength > remaining) {
					chunks.push(value.subarray(0, remaining));
					total += remaining;
					truncatedByBytes = true;
					break;
				}
				chunks.push(value);
				total += value.byteLength;
			}
		} catch (error) {
			/* v8 ignore next -- mid-stream read fault needs a network drop after headers; translate path covered by request-phase tests. */
			throw translateAbortOrNetwork(error, signal);
		} finally {
			/* v8 ignore next 4 -- cancel() after a completed/broken read settles without rejecting; unobserved best-effort cleanup. */
			await reader.cancel().catch(() => {});
		}
		const bytes = new Uint8Array(total);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return {
			bytes,
			truncatedByBytes
		};
	}
};
/** HTTP redirect status codes that carry a `Location`. */
function isRedirectStatus(status) {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}
/** Resolve a (possibly relative) `Location` against the current URL. */
function resolveRedirect(location, base) {
	try {
		return new URL(location, base);
	} catch (error) {
		/* v8 ignore next 2 -- URL resolution against a valid absolute base effectively never throws; defensive guard. */
		throw new WebError(`invalid redirect Location "${location}"`, "WEB_PROVIDER_ERROR", { cause: error });
	}
}
/**
* Translate a thrown fetch/stream error into a `WebError`, classified by the
* deadline signal rather than the thrown value (which differs by phase: the
* request-phase `fetch` rejects with the abort reason, while the read-phase
* reader surfaces a bare `AbortError`). `timeoutOf(signal, 'WEB_FETCH_TIMEOUT')`
* recovering OUR reason means our timeout fired (`WEB_FETCH_TIMEOUT`); any other
* abort — an upstream cancel, or a foreign/outer deadline's timeout under
* nesting — is `WEB_ABORTED`; a throw with the signal NOT aborted is a
* transport/network failure (`WEB_PROVIDER_ERROR`).
*/
function translateAbortOrNetwork(error, signal) {
	const timeout = timeoutOf(signal, "WEB_FETCH_TIMEOUT");
	if (timeout !== void 0) return new WebError("web fetch timed out", "WEB_FETCH_TIMEOUT", { cause: timeout });
	if (signal.aborted) return new WebError("web fetch aborted", "WEB_ABORTED", { cause: error });
	return new WebError(`web fetch failed: ${String(error)}`, "WEB_PROVIDER_ERROR", { cause: error });
}
//#endregion
//#region lib/types/index.js
/**
* `@deepseek-ai/dsh-web-fetch-http`: registers an anonymous public HTTP(S)
* `WebFetchProvider` with `ctx.web`. A function/namespace plugin (NOT a
* default-export service): it registers INTO the seam's fetch registry, like the
* search providers register into the search registry.
*
* @module @deepseek-ai/dsh-web-fetch-http
*/
const MAX_NODE_TIMER_DELAY_MS = 2147483647;
/** Default `User-Agent`: an explicit product agent, never a browser disguise. */
const DEFAULT_USER_AGENT = "deepseek-harness/0.0.1 (+https://github.com/deepseek-ai)";
/** Cordis plugin name used by loader diagnostics. */
const name = "web-fetch-http";
/** The web seam this provider registers into. */
const inject = ["web"];
const Config = z.object({
	maxUrlLength: z.number().default(2048),
	maxResponseBytes: z.number().default(5e6),
	maxBodyChars: z.number().default(1e5),
	timeoutMs: z.number().default(3e4),
	maxRedirects: z.number().default(5),
	userAgent: z.string().default(DEFAULT_USER_AGENT)
});
/** A resource limit (byte/char/length/timeout cap) must be a positive finite number. */
function assertPositiveFinite(name, value) {
	if (!Number.isFinite(value) || value <= 0) throw new Error(`web-fetch-http: ${name} must be a positive finite number`);
}
/** Node coerces larger timer delays to 1 ms, so reject them at configuration time. */
function assertTimeoutMs(value) {
	assertPositiveFinite("timeoutMs", value);
	if (value > MAX_NODE_TIMER_DELAY_MS) throw new Error(`web-fetch-http: timeoutMs must be no greater than ${MAX_NODE_TIMER_DELAY_MS}`);
}
/** The redirect hop cap must be a non-negative integer (0 follows no redirects). */
function assertNonNegativeInteger(name, value) {
	if (!Number.isInteger(value) || value < 0) throw new Error(`web-fetch-http: ${name} must be a non-negative integer`);
}
/** Register the local HTTP(S) fetch provider with `ctx.web`. */
function apply(ctx, config) {
	const resolved = config;
	assertPositiveFinite("maxUrlLength", resolved.maxUrlLength);
	assertPositiveFinite("maxResponseBytes", resolved.maxResponseBytes);
	assertPositiveFinite("maxBodyChars", resolved.maxBodyChars);
	assertTimeoutMs(resolved.timeoutMs);
	assertNonNegativeInteger("maxRedirects", resolved.maxRedirects);
	const limits = {
		maxUrlLength: resolved.maxUrlLength,
		maxResponseBytes: resolved.maxResponseBytes,
		maxBodyChars: resolved.maxBodyChars,
		timeoutMs: resolved.timeoutMs,
		maxRedirects: resolved.maxRedirects,
		userAgent: resolved.userAgent
	};
	ctx.web.registerFetchProvider(new HttpFetchProvider(limits));
}
//#endregion
export { Config, DEFAULT_USER_AGENT, HttpFetchProvider, LOCAL_FETCH_PROVIDER_ID, apply, inject, name };
