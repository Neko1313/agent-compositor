import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { buildApp } from "../../packages/app/src/build.js";
const servers: Server[] = [],
  sockets = new Set<Socket>();
let tunnels = 0,
  app: Awaited<ReturnType<typeof buildApp>> | undefined;
const temp = await mkdtemp(join(tmpdir(), "compositor-proxy-smoke-"));
const listen = async (s: Server) => {
  servers.push(s);
  s.on("connection", (c) => {
    sockets.add(c);
    c.on("close", () => sockets.delete(c));
  });
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as any).port}`;
};
try {
  const upstream = await listen(
    createServer(async (req, res) => {
      for await (const _ of req) {
      }
      if (req.url === "/page") {
        res.setHeader("content-type", "text/plain");
        res.end("web-through-proxy");
        return;
      }
      res.setHeader("content-type", "text/event-stream");
      res.end(
        "data: " +
          JSON.stringify({
            choices: [{ delta: { content: "proxy-ok" }, finish_reason: null }],
          }) +
          "\n\ndata: " +
          JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }) +
          "\n\ndata: [DONE]\n\n"
      );
    })
  );
  const proxy = createServer(async (req, res) => {
    tunnels++;
    let body = "";
    for await (const chunk of req) body += chunk;
    const response = await fetch(req.url!, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(body ? { body } : {}),
      proxy: false,
    } as RequestInit);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  proxy.on("connect", (req, socket, head) => {
    tunnels++;
    const [host, port] = req.url!.split(":");
    const target = connect(Number(port), host, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      target.write(head);
      target.pipe(socket);
      socket.pipe(target);
    });
    sockets.add(target);
    target.on("close", () => sockets.delete(target));
    target.on("error", () => socket.destroy());
    socket.on("error", () => target.destroy());
  });
  const endpoint = await listen(proxy);
  const cwd = join(temp, "project"),
    home = join(temp, "home");
  await mkdir(join(cwd, ".agent-compositor"), { recursive: true });
  await mkdir(home);
  await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({enabledPlugins:['network-proxy','web']}));
  await writeFile(
    join(cwd, ".agent-compositor/proxy.json"),
    JSON.stringify({ enabled: true, url: endpoint, noProxy: [] })
  );
  app = await buildApp({
    cwd,
    env: {
      HOME: home,
      AGENT_BASE_URL: upstream + "/v1",
      AGENT_MODEL: "fixture",
    },
    agentHub: false,
    pluginDirs: ["network-proxy", "web"].map((p) =>
      fileURLToPath(new URL(`../../plugins/${p}`, import.meta.url))
    ),
  });
  const core = app.createCore(async () => true);
  await core.start();
  await core.submit("Reply with proxy-ok");
  assert(
    core
      .getMessages()
      .some((m) => m.role === "assistant" && m.content === "proxy-ok")
  );
  const page = await core.invokeTool("web_fetch", { url: upstream + "/page" });
  assert(page.ok);
  assert(JSON.stringify(page.output).includes("web-through-proxy"));
  const env = await core.invokeTool("exec", {
    command: 'printf "%s" "$HTTPS_PROXY"',
  });
  assert(env.ok);
  assert(JSON.stringify(env.output).includes(endpoint));
  assert(tunnels > 0);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "Bun model stream through HTTP proxy",
        "web tool through same proxy",
        "shell inherits proxy environment",
      ],
      tunnels,
    })
  );
} finally {
  await app?.close();
  for (const socket of sockets) socket.destroy();
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  await rm(temp, { recursive: true, force: true });
}
