import type { ProviderRouter } from "@agent-compositor/provider";
export function quotaReader(router: ProviderRouter) {
  let cached: { profile: string; at: number; value: unknown } | undefined;
  return async () => {
    const name = router.credentialProfile,
      p = router.profiles[name] as any,
      config = p?.quota;
    if (!config?.url)
      return {
        value: { available: false, reason: "No quota endpoint configured" },
      };
    if (cached?.profile === name && Date.now() - cached.at < 30000)
      return { value: cached.value };
    const url = new URL(config.url),
      base = new URL(p.baseUrl);
    if (url.origin !== base.origin)
      throw new Error("Quota endpoint must share the provider origin");
    const headers: Record<string, string> =
      p.type === "anthropic"
        ? { "x-api-key": p.apiKey }
        : p.type === "gemini"
        ? { "x-goog-api-key": p.apiKey }
        : { Authorization: `Bearer ${p.apiKey}` };
    const result = await (p.fetch ?? fetch)(url, {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
      headers,
    });
    if (!result.ok) throw new Error(`Quota HTTP ${result.status}`);
    const text = await result.text();
    if (text.length > 100000) throw new Error("Quota response exceeds limit");
    const body = JSON.parse(text);
    const field = (path: string) =>
      String(path)
        .split(".")
        .reduce((value, key) => value?.[key], body);
    const remaining = field(config.remainingPath ?? "remaining"),
      limit = field(config.limitPath ?? "limit"),
      reset = field(config.resetPath ?? "reset");
    if (
      !Number.isFinite(remaining) ||
      !Number.isFinite(limit) ||
      remaining < 0 ||
      limit < 0
    )
      throw new Error("Quota fields must be non-negative numbers");
    const value = {
      available: true,
      remaining,
      limit,
      reset: typeof reset === "string" ? reset : undefined,
      unit: String(config.unit ?? "tokens"),
      profile: name,
    };
    cached = { profile: name, at: Date.now(), value };
    return { value };
  };
}
