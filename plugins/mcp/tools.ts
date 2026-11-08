/**
 * MCP (Model Context Protocol) client as a model-facing plugin tool.
 *
 * Transport: stdio, newline-delimited JSON-RPC 2.0 — no external deps.
 * Lifecycle: connections are lazy (first use) and cached for the process.
 * Fail-operational: a dead server is an error VALUE, never a crash; each
 * server in a list call fails independently.
 *
 * Config (first hit wins):
 *   1. env AGENT_MCP_CONFIG — JSON string, Claude style:
 *        {"mcpServers": {"fs": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]}}}
 *   2. <cwd>/.agent-compositor/mcp.json — same shape on disk.
 *
 * Erasable-syntax TS only (Node 24 type stripping): no parameter
 * properties, no enums — plain fields and `#`-free privates aren't used
 * either; everything is module-scoped or closure-based.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

class McpClient {
  proc: ChildProcess;
  buffer = "";
  nextId = 1;
  pending = new Map<number, Pending>();
  ready: Promise<void>;

  constructor(cfg: McpServerConfig) {
    this.proc = spawn(cfg.command, cfg.args ?? [], {
      stdio: ["pipe", "pipe", "inherit"],
      env: { ...process.env, ...(cfg.env ?? {}) },
    });
    this.proc.stdout?.on("data", (d: Buffer | string) => this.onData(d.toString()));
    this.proc.on("exit", (code) => this.failAll(`mcp server "${cfg.command}" exited (code ${code ?? "?"})`));
    this.ready = this.handshake();
  }

  onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: { id?: number; error?: { message?: string }; result?: unknown };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        continue; // not JSON — ignore (server logs etc.)
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? "mcp error"));
        else p.resolve(msg.result);
      }
    }
  }

  failAll(reason: string): void {
    for (const p of this.pending.values()) p.reject(new Error(reason));
    this.pending.clear();
  }

  send(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params: unknown): void {
    this.proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async handshake(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-compositor", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<{ name: string; description?: string }[]> {
    await this.ready;
    const result = (await this.send("tools/list", {})) as { tools?: { name: string; description?: string }[] };
    return (result.tools ?? []).map((t) => ({ name: t.name, description: t.description }));
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    await this.ready;
    return await this.send("tools/call", { name, arguments: args ?? {} });
  }

  stop(): void {
    try {
      this.proc.kill();
    } catch {
      /* already gone */
    }
  }
}

/** process-lifetime connection cache */
const clients = new Map<string, Promise<McpClient>>();
let configCache: { cwd: string; config?: McpConfig; error?: string } | undefined;

async function loadConfig(cwd: string): Promise<{ config?: McpConfig; error?: string }> {
  if (configCache && configCache.cwd === cwd) return configCache;
  let config: McpConfig | undefined;
  let error: string | undefined;
  const envJson = process.env.AGENT_MCP_CONFIG;
  if (envJson && envJson.trim()) {
    try {
      config = JSON.parse(envJson) as McpConfig;
    } catch {
      error = "AGENT_MCP_CONFIG is not valid JSON";
    }
  } else {
    try {
      const raw = await fs.readFile(path.join(cwd, ".agent-compositor", "mcp.json"), "utf8");
      config = JSON.parse(raw) as McpConfig;
    } catch {
      error = "no MCP config (set AGENT_MCP_CONFIG or .agent-compositor/mcp.json)";
    }
  }
  if (!error && (!config || typeof config !== "object" || !config.mcpServers || typeof config.mcpServers !== "object")) {
    error = "MCP config missing \"mcpServers\" object";
  }
  configCache = { cwd, config, error };
  return configCache;
}

function getClient(server: string, servers: Record<string, McpServerConfig>): Promise<McpClient> {
  let cached = clients.get(server);
  if (!cached) {
    cached = Promise.resolve()
      .then(() => {
        const cfg = servers[server];
        if (!cfg || typeof cfg.command !== "string") throw new Error(`unknown mcp server: ${server}`);
        return new McpClient(cfg);
      })
      .catch((err) => {
        clients.delete(server); // don't cache a failed connection
        throw err;
      });
    clients.set(server, cached);
  }
  return cached;
}

/** test/exit hook: kill spawned servers */
export function __mcpShutdown(): void {
  for (const p of clients.values()) p.then((c) => c.stop()).catch(() => undefined);
  clients.clear();
}
if (typeof process !== "undefined") process.on("exit", () => __mcpShutdown());

export const mcpCallTool = {
  name: "mcp_call",
  description:
    "Gateway to MCP (Model Context Protocol) servers. Use action=\"list\" to discover configured servers and their tools " +
    "(failures per server are reported inline), then action=\"call\" with server, tool and arguments to execute. " +
    "Config: AGENT_MCP_CONFIG env (JSON) or .agent-compositor/mcp.json.",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["list", "call"], description: "list servers/tools, or call a tool" },
      server: { type: "string", description: "server name (action=call)" },
      tool: { type: "string", description: "tool name on the server (action=call)" },
      arguments: { type: "object", description: "arguments object for the tool (action=call)" },
    },
    required: ["action"],
  },
  describe: () => ({ tool: "mcp_call" }),
  async execute(ctx: { cwd: string }, rawArgs: unknown) {
    const args = rawArgs as { action?: string; server?: string; tool?: string; arguments?: unknown };
    const action = args.action ?? "list";
    try {
      const loaded = await loadConfig(ctx.cwd);
      if (loaded.error || !loaded.config) return { ok: false, error: `mcp: ${loaded.error ?? "no config"}` };
      const servers = loaded.config.mcpServers;

      if (action === "list") {
        const listed: { name: string; tools?: { name: string; description?: string }[]; error?: string }[] = [];
        for (const name of Object.keys(servers)) {
          try {
            const client = await getClient(name, servers);
            listed.push({ name, tools: await client.listTools() });
          } catch (err) {
            listed.push({ name, error: err instanceof Error ? err.message : String(err) });
          }
        }
        return { ok: true, data: { servers: listed } };
      }

      if (action === "call") {
        if (!args.server || !args.tool) return { ok: false, error: "mcp_call: server and tool are required for action=call" };
        const client = await getClient(args.server, servers);
        const result = await client.callTool(args.tool, args.arguments);
        return { ok: true, data: result };
      }
      return { ok: false, error: `mcp_call: unknown action "${action}" (list|call)` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export default [mcpCallTool];
