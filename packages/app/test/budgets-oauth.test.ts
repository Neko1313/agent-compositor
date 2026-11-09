import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { buildApp } from "../src/build.js";
let server: Server | undefined;
const roots: string[] = [];
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "budgets-oauth-"));
  roots.push(root);
  return root;
}
describe("budgets, pricing and OAuth", () => {
  it("stops tool execution after a provider error or exhausted token budget", async () => {
    for (const budget of [false, true]) {
      const cwd = await temp();
      const provider = new ScriptedProvider([
        {
          toolCalls: [
            {
              name: "write",
              args: { path: "unsafe.txt", content: "must not run" },
            },
          ],
          ...(budget
            ? { usage: { inputTokens: 4, outputTokens: 4 } }
            : { finish: "error" as const, error: "truncated" }),
        },
      ]);
      const core = new AgentCore({
        cwd,
        provider,
        maxTokensPerTurn: budget ? 5 : undefined,
        onApproval: async () => true,
      });
      await core.submit("go");
      expect(core.failure).toMatch(budget ? /budget/ : /truncated/);
      await expect(readFile(join(cwd, "unsafe.txt"))).rejects.toThrow();
      if (budget) expect(provider.requests).toHaveLength(0);
    }
  });
  it("prices cached usage once and preserves actual usage across a resumed session", async () => {
    const cwd = await temp();
    await mkdir(join(cwd, ".agent-compositor"));
    await writeFile(
      join(cwd, ".agent-compositor/pricing.json"),
      JSON.stringify({
        default: {
          inputPerMillion: 2,
          outputPerMillion: 4,
          cachedInputPerMillion: 0.5,
        },
      })
    );
    const provider = {
      name: "cached",
      async *complete() {
        yield { type: "text_delta" as const, text: "done" };
        yield {
          type: "usage" as const,
          inputTokens: 100,
          outputTokens: 10,
          cachedInputTokens: 40,
        };
        yield { type: "finish" as const, reason: "stop" as const };
      },
    };
    const app = await buildApp({
      cwd,
      env: { HOME: cwd },
      provider,
      pluginDirs: [join(process.cwd(), "plugins")],
    });
    const core = app.createCore(async () => true);
    await core.start();
    await core.submit("go");
    const totals = JSON.parse(
      await readFile(
        join(app.storage.paths.state, `usage-${core.sessionId}.json`),
        "utf8"
      )
    );
    expect(totals).toMatchObject({ in: 100, out: 10, cached: 40, turns: 1 });
    expect(totals.cost).toBeCloseTo(0.00018);
    await app.close();
  });
  it("performs device authorization, refreshes the token and reads provider quota", async () => {
    const cwd = await temp();
    let base = "",
      authorization = "",
      refreshes = 0,
      polls = 0;
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/device") {
          res.end(
            JSON.stringify({
              device_code: "device",
              user_code: "ABCD",
              verification_uri: base + "/verify",
              expires_in: 30,
              interval: 1,
            })
          );
          return;
        }
        if (req.url === "/token") {
          const body = new URLSearchParams(raw);
          if (body.get("grant_type") === "refresh_token") {
            refreshes++;
            res.end(
              JSON.stringify({
                access_token: "refreshed-test-token",
                expires_in: 3600,
              })
            );
          } else {
            polls++;
            res.end(
              JSON.stringify({
                access_token: "initial-test-token",
                refresh_token: "refresh-test",
                expires_in: 1,
              })
            );
          }
          return;
        }
        if (req.url === "/quota") {
          res.end(JSON.stringify({ account: { remaining: 90, limit: 100 } }));
          return;
        }
        authorization = String(req.headers.authorization);
        res.setHeader("Content-Type", "text/event-stream");
        res.end(
          'data: {"choices":[{"delta":{"content":"Authenticated response"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        );
      });
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve)
    );
    base = `http://127.0.0.1:${(server.address() as any).port}`;
    await writeFile(
      join(cwd, "agent-compositor.json"),
      JSON.stringify({
        providers: {
          default: {
            type: "openai-compat",
            baseUrl: base + "/v1",
            model: "test",
            oauth: {
              clientId: "test-client",
              deviceAuthorizationEndpoint: base + "/device",
              tokenEndpoint: base + "/token",
              allowLocalhost: true,
            },
            quota: {
              url: base + "/quota",
              remainingPath: "account.remaining",
              limitPath: "account.limit",
            },
          },
        },
      })
    );
    const app = await buildApp({ cwd, env: { HOME: cwd } });
    const core = app.createCore(async () => false);
    await core.start();
    await core.submit("/login default");
    await core.submit("hello");
    expect(polls).toBe(1);
    expect(refreshes).toBe(1);
    expect(authorization).toBe("Bearer refreshed-test-token");
    expect(core.getMessages().at(-1)?.content).toBe("Authenticated response");
    expect(JSON.stringify(core.getMessages())).not.toContain("test-token");
    const quota: any = (await core.host.emit("service.usage.quota", {})).value;
    expect(quota.value).toMatchObject({
      available: true,
      remaining: 90,
      limit: 100,
    });
    await app.close();
  });
});
