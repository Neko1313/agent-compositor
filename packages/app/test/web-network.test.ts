import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { UndoStore, type ToolContext } from "@agent-compositor/tools";
import webTools, { duckResults, fetchPage, searchWeb } from "../../../plugins/web/tools.js";

const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
const context = (fetcher: typeof fetch, config: unknown = {}): ToolContext => ({
  cwd: "/tmp", signal: new AbortController().signal, undo: new UndoStore(),
  request: async <T>() => undefined as T, fetch: fetcher, settings: async () => config,
});
const fetchMock = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) =>
  vi.fn(handler) as unknown as typeof fetch;
const result = (url: string, title = "Documentation", snippet = "Reference") =>
  `<a class="result__a" href="${url}">${title}</a><a class="result__snippet">${snippet}</a>`;

describe("bounded web transport", () => {
  it.each(["file:///etc/passwd", "ftp://example.com/file", "https://user:secret@example.com/", "not a URL"])
    ("rejects %s before making a network request", async url => {
      const fetcher = fetchMock(async () => new Response("must not fetch"));
      await expect(fetchPage(url, new AbortController().signal, fetcher)).rejects.toThrow();
      expect(fetcher).not.toHaveBeenCalled();
    });

  it("does not follow redirects and cancels their response body", async () => {
    const cancelled = vi.fn(), body = new ReadableStream({ cancel: cancelled });
    const fetcher = fetchMock(async () => new Response(body, { status: 302, headers: { location: "/new-source" } }));
    await expect(fetchPage("https://example.com/old", new AbortController().signal, fetcher))
      .rejects.toThrow("Redirect requires a new approved fetch: https://example.com/new-source");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.mocked(fetcher).mock.calls[0][1]?.redirect).toBe("manual");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("caps cumulative response bytes and cancels a body that exceeds the cap", async () => {
    const cancelled = vi.fn(); let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { reads++; controller.enqueue(new Uint8Array(600_000)); },
      cancel: cancelled,
    });
    const fetcher = fetchMock(async () => new Response(body, { headers: { "content-type": "text/plain" } }));
    await expect(fetchPage("https://example.com/large", new AbortController().signal, fetcher)).rejects.toThrow("1 MB");
    expect(cancelled).toHaveBeenCalledOnce(); expect(reads).toBeLessThanOrEqual(3);
  });

  it("bounds text and links, deduplicates links, and rejects credential-bearing targets", async () => {
    const links = Array.from({ length: 65 }, (_, i) => `<a href="/source/${i}">Source ${i}</a>`).join("");
    const fetcher = fetchMock(async () => new Response(`<title>Guide</title>${"x".repeat(60_000)}${links}<a href="/source/0">Duplicate</a><a href="https://secret@example.org">Secret</a><a href="javascript:run()">Bad</a>`,
      { headers: { "content-type": "text/html" } }));
    const page = await fetchPage("https://example.com/docs/", new AbortController().signal, fetcher);
    expect(page.text).toHaveLength(50_000); expect(page.truncated).toBe(true); expect(page.title).toBe("Guide");
    expect(page.links).toHaveLength(50); expect(new Set(page.links.map(link => link.url)).size).toBe(50);
    expect(page.links.every(link => link.url.startsWith("https://example.com/source/"))).toBe(true);
  });

  it("preserves JSON text and reports unsupported binary content", async () => {
    const fetcher = fetchMock(async () => new Response('{"value":"<text>"}', { headers: { "content-type": "application/json" } }));
    expect(await fetchPage("https://example.com/data", new AbortController().signal, fetcher))
      .toMatchObject({ text: '{"value":"<text>"}', links: [], truncated: false });
    const binary = fetchMock(async () => new Response(new Uint8Array([0, 1, 2]), { headers: { "content-type": "application/pdf" } }));
    await expect(fetchPage("https://example.com/file", new AbortController().signal, binary)).rejects.toThrow("Unsupported content type");
  });

  it("aborts a stalled body after headers and closes the actual HTTP connection", async () => {
    let wroteHeaders!: () => void, closed!: () => void;
    const headers = new Promise<void>(resolve => { wroteHeaders = resolve; });
    const connectionClosed = new Promise<void>(resolve => { closed = resolve; });
    const server = createServer((_request, response) => {
      response.on("close", closed); response.writeHead(200, { "content-type": "text/plain" });
      response.write("partial body"); wroteHeaders();
    });
    servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const controller = new AbortController(), address = server.address() as { port: number };
    const pending = fetchPage(`http://127.0.0.1:${address.port}/stalled`, controller.signal);
    const rejected = expect(pending).rejects.toThrow();
    await headers; controller.abort(new Error("cancelled by user")); await rejected; await connectionClosed;
  });
});

describe("search provider failures and source normalization", () => {
  it("keeps an explicit Brave selection on Brave and sends its key only to that endpoint", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "fixture-brave-key");
    const fetcher = fetchMock(async () => Response.json({ web: { results: [{ title: "Docs", url: "https://example.com/docs", description: "Source" }] } }));
    const response = await searchWeb(context(fetcher, { provider: "brave", searchUrl: "https://unrelated.example/search" }), { query: "a & b", count: 2 });
    expect(response.provider).toBe("brave");
    const [input, init] = vi.mocked(fetcher).mock.calls[0], url = new URL(String(input));
    expect(url.hostname).toBe("api.search.brave.com"); expect(url.searchParams.get("q")).toBe("a & b");
    expect(url.searchParams.get("count")).toBe("2");
    expect(new Headers(init?.headers).get("X-Subscription-Token")).toBe("fixture-brave-key");
  });

  it("reports provider authentication failure without silently fetching another provider", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "fixture-brave-key"); const cancelled = vi.fn();
    const fetcher = fetchMock(async () => new Response(new ReadableStream({ cancel: cancelled }), { status: 401 }));
    await expect(searchWeb(context(fetcher, { provider: "brave" }), { query: "docs" })).rejects.toThrow("HTTP 401");
    expect(fetcher).toHaveBeenCalledOnce(); expect(cancelled).toHaveBeenCalledOnce();
  });

  it("uses SearXNG JSON parameters without disclosing an available Brave key", async () => {
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "unused-brave-key");
    const fetcher = fetchMock(async () => Response.json({ results: [{ title: "Docs", url: "https://example.com/docs" }] }));
    await searchWeb(context(fetcher, { searchUrl: "https://search.example/search?language=en" }), { query: "a/b & c" });
    const [input, init] = vi.mocked(fetcher).mock.calls[0], url = new URL(String(input));
    expect(url.searchParams.get("q")).toBe("a/b & c"); expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("language")).toBe("en");
    expect(new Headers(init?.headers).has("X-Subscription-Token")).toBe(false);
  });

  it.each([0, 11, 1.5, NaN])("rejects result count %s before provider I/O", async count => {
    const fetcher = fetchMock(async () => new Response("must not fetch"));
    await expect(searchWeb(context(fetcher), { query: "docs", count })).rejects.toThrow("count must");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unknown providers, missing SearXNG configuration and malformed JSON responses", async () => {
    const fetcher = fetchMock(async () => new Response("{bad JSON", { headers: { "content-type": "application/json" } }));
    await expect(searchWeb(context(fetcher, { provider: "invented" }), { query: "docs" })).rejects.toThrow("Unknown");
    await expect(searchWeb(context(fetcher, { provider: "searxng" }), { query: "docs" })).rejects.toThrow("requires web.json");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(searchWeb(context(fetcher, { searchUrl: "https://search.example/search" }), { query: "docs" })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("normalizes and bounds results while filtering unsafe or malformed URLs", async () => {
    const fetcher = fetchMock(async () => Response.json({ results: [null, { url: "javascript:bad()" }, { url: "https://user:secret@example.com" },
      { title: "x".repeat(600), url: "https://example.com/1", content: "y".repeat(3000) }, { title: "Second", url: "https://example.com/2" }] }));
    const response = await searchWeb(context(fetcher, { searchUrl: "https://search.example/search" }), { query: "docs", count: 1 });
    expect(response.results).toHaveLength(1); expect(response.results[0].url).toBe("https://example.com/1");
    expect(response.results[0].title).toHaveLength(500); expect(response.results[0].snippet).toHaveLength(2000);
  });

  it("does not confuse search results about CAPTCHA with a human challenge", () => {
    expect(duckResults(result("https://example.com/captcha", "CAPTCHA documentation", "How CAPTCHA works"), 5))
      .toEqual([{ url: "https://example.com/captcha", title: "CAPTCHA documentation", snippet: "How CAPTCHA works" }]);
  });

  it.each(['<form id="challenge-form">Verify</form>', '<div class="anomaly-modal__modal">Verify</div>', '<section class="captcha-container">Verify</section>'])
    ("reports a human challenge for its actual markup: %s", html => {
      expect(() => duckResults(html, 5)).toThrow("human challenge");
    });

  it("decodes redirects, filters unsafe links and deduplicates before applying the count", () => {
    const html = result("javascript:bad()") + result("https://user:secret@example.com") +
      result("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fguide&amp;rut=fixture", "Guide &amp; reference", "&#x2713; Available") +
      result("https://example.com/guide", "Duplicate") + result("https://example.com/other", "Other");
    expect(duckResults(html, 2)).toEqual([{ url: "https://example.com/guide", title: "Guide & reference", snippet: "✓ Available" },
      { url: "https://example.com/other", title: "Other", snippet: "Reference" }]);
  });

  it("exposes transport failures as tool error results", async () => {
    const fetcher = fetchMock(async () => { throw new Error("connection unavailable"); });
    expect(await webTools.find(tool => tool.name === "web_fetch")!.execute(context(fetcher), { url: "https://example.com" }))
      .toMatchObject({ ok: false, error: expect.stringContaining("connection unavailable") });
  });
});
