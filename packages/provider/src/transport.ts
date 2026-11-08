export interface TransportConfig {
  fetch?: typeof fetch;
  retries?: number;
  retryDelayMs?: number;
}
/** Retry only before a response body is consumed: no replay of streamed tool calls. */
export async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal: AbortSignal,
  options: TransportConfig = {}
): Promise<Response> {
  const max = options.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await (options.fetch ?? fetch)(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (attempt >= max || signal.aborted) throw error;
      await pause((options.retryDelayMs ?? 200) * 2 ** attempt, signal);
      continue;
    }
    if (
      attempt >= max ||
      ![408, 429, 500, 502, 503, 504].includes(response.status)
    )
      return response;
    const delay = Math.min(
      5000,
      Number(response.headers.get("retry-after")) * 1000 ||
        (options.retryDelayMs ?? 200) * 2 ** attempt
    );
    await response.body?.cancel();
    await pause(delay, signal);
  }
}
async function pause(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(done, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
