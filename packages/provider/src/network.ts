import { ProxyAgent, fetch as proxyFetch } from "undici";
export interface NetworkSettings {
  enabled?: boolean;
  url?: string;
  noProxy?: string[];
  models?: boolean;
  tools?: boolean;
}
export class NetworkClient {
  config: NetworkSettings = {};
  private agents = new Map<string, ProxyAgent>();
  configure(config: NetworkSettings) {
    if (config.url) {
      const url = new URL(config.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw Error("Proxy requires an HTTP(S) CONNECT endpoint");
    }
    if (config.enabled && !config.url)
      throw Error("Configure a proxy URL first");
    this.config = { ...config };
    return this.status();
  }
  status() {
    const { url, ...config } = this.config;
    return {
      enabled: config.enabled ?? false,
      models: config.models ?? true,
      tools: config.tools ?? true,
      ...config,
      url: url
        ? (() => {
            const u = new URL(url);
            u.username = "";
            u.password = "";
            return u.href;
          })()
        : undefined,
    };
  }
  bypass(host: string) {
    return (this.config.noProxy ?? ["localhost", "127.0.0.1", "::1"]).some(
      (pattern) =>
        pattern === "*" ||
        host === pattern ||
        (pattern.startsWith(".") && host.endsWith(pattern))
    );
  }
  fetch(scope: "models" | "tools"): typeof fetch {
    return (async (input: any, init: any = {}) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.href
          : input.url
      );
      if (
        !this.config.enabled ||
        this.config[scope] === false ||
        this.bypass(url.hostname)
      )
        return fetch(input, init);
      const endpoint = this.config.url!;
      // Bun's undici compatibility layer does not implement the full dispatcher
      // API. Its native fetch has first-class proxy support, including CONNECT.
      if (process.versions.bun)
        return fetch(input, {
          ...init,
          proxy: { url: endpoint, respectNoProxy: false },
        } as RequestInit);
      let dispatcher = this.agents.get(endpoint);
      if (!dispatcher) {
        dispatcher = new ProxyAgent(endpoint);
        this.agents.set(endpoint, dispatcher);
      }
      return proxyFetch(input, { ...init, dispatcher });
    }) as typeof fetch;
  }
  environment(): Record<string, string> {
    if (!this.config.enabled || this.config.tools === false) return {};
    const proxy = this.config.url!,
      bypass = (this.config.noProxy ?? ["localhost", "127.0.0.1", "::1"]).join(
        ","
      );
    return {
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      ALL_PROXY: proxy,
      NO_PROXY: bypass,
      http_proxy: proxy,
      https_proxy: proxy,
      all_proxy: proxy,
      no_proxy: bypass,
    };
  }
  async close() {
    await Promise.allSettled(
      [...this.agents.values()].map((agent) => agent.close())
    );
    this.agents.clear();
  }
}
