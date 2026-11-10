import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { CorePlugin } from "@agent-compositor/core";
import type {
  ProviderProfile,
  ProviderRouter,
} from "@agent-compositor/provider";
type Credential = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};
const credentialWrites = new Map<string, Promise<void>>();
const refreshRequests = new Map<string, Promise<void>>();
export async function authentication(
  home: string,
  env: NodeJS.ProcessEnv,
  profiles: Record<string, ProviderProfile>,
  router: ProviderRouter,
  fetcher: typeof fetch = fetch,
  globalRoot?: string
) {
  const root = globalRoot ?? join(home, ".agent-compositor"),
    file = join(root, "credentials.json");
  const credentials: Record<string, Credential> = await readFile(file, "utf8")
    .then(JSON.parse)
    .catch((e: any) => {
      if (e.code !== "ENOENT") throw e;
      return {};
    });
  const original = Object.fromEntries(
    Object.entries(profiles).map(([name, p]) => [name, p.apiKey])
  );
  const save = async (name: string) => {
    const credential = credentials[name];
    const operation = (credentialWrites.get(file) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const latest = await readFile(file, "utf8")
          .then(JSON.parse)
          .catch((e: any) => {
            if (e.code !== "ENOENT") throw e;
            return {};
          });
        if (credential) latest[name] = credential;
        else delete latest[name];
        await mkdir(root, { recursive: true, mode: 0o700 });
        await writeFile(file + ".tmp", JSON.stringify(latest), { mode: 0o600 });
        await chmod(file + ".tmp", 0o600);
        await rename(file + ".tmp", file);
      });
    credentialWrites.set(file, operation);
    await operation;
  };
  const apply = (name: string) => {
    if (!profiles[name]) throw new Error("Unknown provider profile");
    profiles[name].apiKey = credentials[name]?.accessToken ?? original[name];
    if (router.credentialProfile === name) router.select(router.active);
  };
  for (const name of Object.keys(profiles))
    if (credentials[name]?.accessToken) apply(name);
  const oauth = (name: string) => {
    const value = (profiles[name] as any)?.oauth;
    if (!value?.clientId || !value.tokenEndpoint)
      throw new Error(
        "Configure oauth clientId, deviceAuthorizationEndpoint and tokenEndpoint for this profile"
      );
    return value;
  };
  const post = async (
    url: string,
    body: Record<string, string>,
    signal: AbortSignal,
    allowLocal = false
  ) => {
    const target = new URL(url);
    if (
      target.protocol !== "https:" &&
      !(
        allowLocal &&
        target.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
      )
    )
      throw new Error("OAuth endpoints require HTTPS");
    const r = await fetcher(target, {
      method: "POST",
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      headers: { Accept: "application/json" },
    });
    const text = await r.text();
    if (text.length > 64000) throw new Error("OAuth response exceeds limit");
    const result = JSON.parse(text);
    if (!r.ok && !result.error) throw new Error(`OAuth HTTP ${r.status}`);
    return result;
  };
  const store = async (name: string, value: any) => {
    if (typeof value.access_token !== "string" || !value.access_token)
      throw new Error("OAuth response has no access token");
    credentials[name] = {
      accessToken: value.access_token,
      refreshToken: value.refresh_token ?? credentials[name]?.refreshToken,
      expiresAt: value.expires_in
        ? Date.now() + Number(value.expires_in) * 1000
        : undefined,
    };
    await save(name);
    apply(name);
  };
  const reload = async (name: string) => {
    const latest = await readFile(file, "utf8")
      .then(JSON.parse)
      .catch((e: any) => {
        if (e.code !== "ENOENT") throw e;
        return {};
      });
    if (latest[name]) credentials[name] = latest[name];
    else delete credentials[name];
    apply(name);
  };
  const refresh = async (name: string, signal: AbortSignal) => {
    await reload(name);
    const value = credentials[name];
    if (!value?.expiresAt || value.expiresAt > Date.now() + 30000) return;
    if (!value.refreshToken)
      throw new Error(`Login expired for ${name}; use /login`);
    const key = file + "\0" + name;
    if (refreshRequests.has(key)) {
      await refreshRequests.get(key);
      await reload(name);
      return;
    }
    const pending = (async () => {
      const o = oauth(name);
      const result = await post(
        o.tokenEndpoint,
        {
          grant_type: "refresh_token",
          refresh_token: value.refreshToken!,
          client_id: o.clientId,
        },
        signal,
        o.allowLocalhost
      );
      if (result.error)
        throw new Error(`OAuth refresh failed: ${result.error}`);
      await store(name, result);
    })();
    refreshRequests.set(key, pending);
    try {
      await pending;
    } finally {
      refreshRequests.delete(key);
    }
  };
  const login = async (
    name: string,
    notify: (message: string) => Promise<void>,
    signal: AbortSignal
  ) => {
    const o = oauth(name);
    if (!o.deviceAuthorizationEndpoint)
      throw new Error(
        "This profile does not configure device authorization; use /login <profile> <ENV_VAR> for API keys"
      );
    const first = await post(
      o.deviceAuthorizationEndpoint,
      { client_id: o.clientId, ...(o.scope ? { scope: o.scope } : {}) },
      signal,
      o.allowLocalhost
    );
    if (!first.device_code || !first.user_code || !first.verification_uri)
      throw new Error("Invalid device authorization response");
    await notify(
      `Open ${
        first.verification_uri_complete ?? first.verification_uri
      } and enter code ${first.user_code}`
    );
    const deadline =
      Date.now() + Math.min(Number(first.expires_in) || 300, 300) * 1000;
    let interval = Math.max(1, Number(first.interval) || 5);
    while (Date.now() < deadline) {
      await delay(Math.min(interval * 1000, 30000), undefined, { signal });
      const result = await post(
        o.tokenEndpoint,
        {
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: first.device_code,
          client_id: o.clientId,
        },
        signal,
        o.allowLocalhost
      );
      if (!result.error) {
        await store(name, result);
        return { status: "logged-in", provider: name };
      }
      if (result.error === "slow_down") {
        interval += 5;
        continue;
      }
      if (result.error !== "authorization_pending")
        throw new Error(`OAuth login failed: ${result.error}`);
    }
    throw new Error("Device authorization expired");
  };
  const show = async ($: any) =>
    $.ui.view(
      "auth",
      "Provider access",
      {
        lines: Object.keys(profiles).map((name) => ({
          text: `${name} · ${
            credentials[name]
              ? "saved credentials"
              : original[name]
              ? "configured key"
              : "not configured"
          }`,
          action: `login:${name}`,
        })),
      },
      { site: "inspector", focus: false }
    );
  const keyForm = async (name: string, $: any) => {
    if (!profiles[name]) throw new Error('Unknown provider profile');
    const result = await $.ui.form({title:`API key · ${name}`,description:'Stored privately in your user credentials file. The key is never sent as a chat message.',fields:[{id:'key',label:'API key',type:'password',required:true}],actions:[{id:'save',label:'Save API key'},{id:'cancel',label:'Cancel'}]});
    if (!result) return;
    if (!Object.hasOwn(original,name)) original[name] = profiles[name].apiKey;
    credentials[name] = {accessToken:String(result.values.key)};
    await save(name); apply(name);
  };
  const plugin: CorePlugin = {
    manifest: {
      name: "provider-auth",
      version: "1.0.0",
      trust: "trusted",
      hookTimeouts: {
        "prompt.submit": 300000,
        "service.auth.login": 300000,
        "ui.press": 300000,
      },
    },
    hooks: {
      "service.auth.login": async (e, $) => {
        try {
          const name=e.provider ?? router.credentialProfile;
          if (!(profiles[name] as any)?.oauth?.deviceAuthorizationEndpoint) {
            await keyForm(name,$); return {value:{status:credentials[name]?"logged-in":"cancelled",provider:name}};
          }
          return {
            value: await login(
              name,
              (message) => $.ui.notify(message),
              $.signal
            ),
          };
        } catch (error) {
          return { deny: String(error) };
        }
      },
      "prompt.submit": async (e, $) => {
        const [command, name = router.credentialProfile, variable] = e.text
          .trim()
          .split(/\s+/);
        if (!["/auth", "/login", "/logout"].includes(command)) return;
        try {
          if (command === "/login") {
            if (variable) {
              if (!/^[A-Z_][A-Z0-9_]*$/i.test(variable) || !env[variable])
                throw new Error("Environment variable is empty or invalid");
              if (!profiles[name]) throw new Error("Unknown profile");
              credentials[name] = { accessToken: env[variable]! };
              await save(name);
              apply(name);
            } else await $.auth.login(name);
          } else if (command === "/logout") {
            if (!profiles[name]) throw new Error("Unknown profile");
            delete credentials[name];
            await save(name);
            apply(name);
          }
          await show($);
        } catch (error) {
          await $.ui.notify(String(error), "error");
        }
        return { drop: "provider-auth: handled" };
      },
      "ui.press": async (e, $) => {
        if (
          e.site === "plugin-provider-auth-auth" &&
          e.key.startsWith("login:")
        ) {
          try {
            const name = e.key.slice(6);
            await $.auth.login(name);
            await show($);
          } catch (error) {
            await $.ui.notify(String(error), "error");
          }
        }
      },
    },
  };
  return {
    plugin,
    setKey: async (name: string, key: string) => {
      if (!profiles[name]) throw new Error('Unknown provider profile');
      if (!Object.hasOwn(original, name)) original[name] = profiles[name].apiKey;
      if (key) credentials[name] = { accessToken: key };
      else delete credentials[name];
      await save(name); apply(name);
    },
    refresh,
    provider: {
      login: async () => {
        throw new Error("Use the interactive /login command");
      },
      status: () => ({
        loggedIn: !!profiles[router.credentialProfile]?.apiKey,
        provider: router.active,
      }),
    },
  };
}
