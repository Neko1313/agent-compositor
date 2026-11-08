import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { NetworkClient } from "../src/network.js";
import { postJson } from "../src/transport.js";
const clients: NetworkClient[] = [],
  servers: Server[] = [],
  sockets = new Set<Socket>();
afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((c) => c.close()));
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
async function listen(server: Server) {
  servers.push(server);
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
async function fixture() {
  let tunnels = 0;
  const target = await listen(
    createServer(async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          url: req.url,
          body,
          authorization: req.headers.authorization,
        })
      );
    })
  );
  const proxy = createServer();
  proxy.on("connect", (req, socket, head) => {
    tunnels++;
    const [host, port] = req.url!.split(":");
    const remote = connect(Number(port), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) remote.write(head);
      socket.pipe(remote);
      remote.pipe(socket);
    });
    sockets.add(remote);
    remote.on("close", () => sockets.delete(remote));
    remote.on("error", () => socket.destroy());
    socket.on("error", () => remote.destroy());
  });
  const proxyUrl = await listen(proxy);
  const client = new NetworkClient();
  clients.push(client);
  return { target, proxyUrl, client, tunnels: () => tunnels };
}
describe("optional proxy transport", () => {
  it("uses HTTP CONNECT for model and tool traffic without changing headers, URL or body", async () => {
    const { client, target, proxyUrl, tunnels } = await fixture();
    client.configure({ enabled: true, url: proxyUrl, noProxy: [] });
    const reply = await postJson(
      target + "/v1/messages",
      { model: "fixture" },
      { Authorization: "Bearer fixture-key" },
      new AbortController().signal,
      { fetch: client.fetch("models"), retries: 0 }
    );
    expect(await reply.json()).toEqual({
      url: "/v1/messages",
      body: '{"model":"fixture"}',
      authorization: "Bearer fixture-key",
    });
    await (await client.fetch("tools")(target + "/page")).text();
    expect(tunnels()).toBeGreaterThan(0);
    expect(client.environment().HTTPS_PROXY).toBe(proxyUrl);
  });
  it("supports bypass, per-scope switch, disabling and redacted status", async () => {
    const { client, target, proxyUrl, tunnels } = await fixture();
    client.configure({ enabled: true, url: proxyUrl, noProxy: ["127.0.0.1"] });
    await (await client.fetch("models")(target)).text();
    expect(tunnels()).toBe(0);
    client.configure({
      enabled: true,
      url: proxyUrl,
      noProxy: [],
      tools: false,
    });
    await (await client.fetch("tools")(target)).text();
    expect(tunnels()).toBe(0);
    client.configure({ enabled: false, url: proxyUrl });
    expect(client.environment()).toEqual({});
    const url = new URL(proxyUrl);
    url.username = "private";
    url.password = "secret";
    client.configure({ url: url.href });
    expect(JSON.stringify(client.status())).not.toContain("secret");
    expect(() =>
      client.configure({ enabled: true, url: "socks5://localhost:1" })
    ).toThrow("CONNECT");
    expect(() => client.configure({ enabled: true })).toThrow(
      "Configure a proxy URL"
    );
  });
  it("preserves cancellation through the proxy", async () => {
    const { client, proxyUrl } = await fixture();
    const endpoint = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: first\n\n");
      })
    );
    client.configure({ enabled: true, url: proxyUrl, noProxy: [] });
    const controller = new AbortController();
    const response = await client.fetch("models")(endpoint, {
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    controller.abort();
    await expect(reader.read()).rejects.toThrow();
  });
});
