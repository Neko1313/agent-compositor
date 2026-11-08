function validate(config: any) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw Error("Proxy configuration must be an object");
  for (const key of ["enabled", "models", "tools"])
    if (config[key] !== undefined && typeof config[key] !== "boolean")
      throw Error(`proxy.${key} must be boolean`);
  if (
    config.noProxy !== undefined &&
    (!Array.isArray(config.noProxy) ||
      config.noProxy.some((s: any) => typeof s !== "string"))
  )
    throw Error("proxy.noProxy must be an array of hosts");
  if (config.url !== undefined) {
    const url = new URL(config.url);
    if (!["http:", "https:"].includes(url.protocol))
      throw Error("Proxy requires an HTTP(S) endpoint");
  }
  if (config.enabled && !config.url)
    throw Error("Configure proxy.json url before enabling");
  return config;
}
async function apply($: any) {
  const config = validate(await $.storage.config("proxy.json"));
  const result: any = await $.emit("service.network.configure", { config });
  if (result?.deny) throw Error(result.deny);
  if (!result || !("value" in result))
    throw Error("Network proxy configuration was not accepted by the host");
  return result.value;
}
export default {
  "session.start": async (_: unknown, $: any) => {
    await apply($);
  },
  "session.reload": async (_: unknown, $: any) => {
    await apply($);
  },
  "service.model.stream": async (_: unknown, $: any) => {
    try {
      await apply($);
    } catch (e) {
      return { deny: `Proxy configuration: ${String(e)}` };
    }
  },
  "tool.check": async (e: any, $: any) => {
    if (!["exec", "mcp_call", "web_fetch", "web_search"].includes(e.tool))
      return;
    try {
      await apply($);
    } catch (error) {
      return {
        decision: "deny",
        reason: `Proxy configuration: ${String(error)}`,
      };
    }
  },
  "prompt.submit": async (e: { text: string }, $: any) => {
    const [command, action = "status"] = e.text.trim().split(/\s+/);
    if (command !== "/proxy") return;
    try {
      if (!["status", "on", "off"].includes(action))
        throw Error("/proxy [status|on|off]");
      const config = { ...(await $.storage.config("proxy.json")) };
      if (action !== "status") {
        config.enabled = action === "on";
        validate(config);
        await $.emit("service.network.configure", { config });
        await $.fs.write(
          ".agent-compositor/proxy.json",
          JSON.stringify(config, null, 2)
        );
      }
      const result = await apply($);
      await $.ui.surface(
        "network",
        "Network proxy",
        JSON.stringify(result, null, 2),
        { site: "inspector", focus: false }
      );
    } catch (error) {
      await $.ui.notify(String(error), "error");
    }
    return { drop: "proxy: handled" };
  },
};
