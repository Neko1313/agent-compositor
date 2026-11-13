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
import {mcpServerMapSchema} from '@agent-compositor/loader';
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  cwd?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface McpToolDefinition extends Record<string, unknown> {
  name: string;
  description?: string;
}
interface McpToolPage {
  tools: McpToolDefinition[];
  nextCursor?: string;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

class McpClient {
  dead?: string;
  timeoutMs: number;
  proc: ChildProcess;
  buffer = "";
  nextId = 1;
  pending = new Map<number, Pending>();
  ready: Promise<void>;

  constructor(cfg: McpServerConfig, cwd: string) {
    this.timeoutMs = Math.max(100, Math.min(cfg.timeoutMs ?? 30000, 120000));
    this.proc = spawn(cfg.command, cfg.args ?? [], {
      cwd: cfg.cwd ?? cwd,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...(cfg.env ?? {}) },
    });
    this.proc.stdout?.setEncoding('utf8');
    this.proc.stdout?.on("data", (text: string) => this.onData(text));
    this.proc.stdout?.on('end', () => this.stop('MCP output pipe closed'));
    this.proc.stdout?.on('error', error => this.stop(`MCP output pipe error: ${error.message}`));
    this.proc.stderr?.resume();
    this.proc.on("error", (error) =>
      this.stop(`MCP process error: ${error.message}`)
    );
    this.proc.stdin?.on("error", () => this.stop("MCP input pipe closed"));
    this.proc.on("exit", (code) =>
      this.failAll(`mcp server "${cfg.command}" exited (code ${code ?? "?"})`)
    );
    this.ready = this.handshake();
    void this.ready.catch(() => {});
  }

  onData(chunk: string): void {
    if (this.dead) return;
    this.buffer += chunk;
    if (this.buffer.length > 2000000) {
      this.stop("MCP message exceeds limit");
      return;
    }
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue; // not JSON — ignore (server logs etc.)
      }
      if (!isRecord(msg) || msg.jsonrpc !== '2.0') {
        this.stop('MCP invalid JSON-RPC message envelope');
        return;
      }
      const hasResult = Object.hasOwn(msg, 'result'), hasError = Object.hasOwn(msg, 'error');
      const validId = typeof msg.id === 'string' || typeof msg.id === 'number' && Number.isInteger(msg.id);
      if (Object.hasOwn(msg, 'method')) {
        if (typeof msg.method !== 'string' || hasResult || hasError || (msg.params !== undefined && !isRecord(msg.params)) || (Object.hasOwn(msg, 'id') && !validId)) {
          this.stop('MCP invalid JSON-RPC request or notification');
          return;
        }
        // Requests in the opposite direction have an independent ID namespace.
        // Never resolve a pending client call with a server request/notification.
        if (Object.hasOwn(msg, 'id')) this.proc.stdin?.write(JSON.stringify({
          jsonrpc: '2.0', id: msg.id,
          ...(msg.method === 'ping' ? {result: {}} : {error: {code: -32601, message: 'Method not found'}}),
        }) + '\n');
        continue;
      }
      if (!validId || hasResult === hasError || (hasError && (!isRecord(msg.error) || !Number.isInteger(msg.error.code) || typeof msg.error.message !== 'string'))) {
        this.stop('MCP invalid JSON-RPC response');
        return;
      }
      if (typeof msg.id === "number" && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        clearTimeout(p.timer);
        this.pending.delete(msg.id);
        if (hasError) p.reject(new Error((msg.error as {message: string}).message));
        else p.resolve(msg.result);
      }
    }
  }

  failAll(reason: string): void {
    this.dead = reason;
    this.buffer = '';
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  send(method: string, params: unknown): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error(this.dead));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.stop(`MCP ${method} timed out`),
        this.timeoutMs
      );
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin?.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"
      );
    });
  }

  notify(method: string, params: unknown): void {
    this.proc.stdin?.write(
      JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"
    );
  }

  async handshake(): Promise<void> {
    await this.send("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "agent-compositor", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(cursor?: string): Promise<McpToolPage> {
    await this.ready;
    const result = await this.send("tools/list", cursor === undefined ? {} : {cursor});
    if (!isRecord(result) || !Array.isArray(result.tools))
      throw Error('MCP tools/list response must contain a tools array');
    for (const [index, tool] of result.tools.entries()) {
      if (!isRecord(tool) || typeof tool.name !== 'string' || !tool.name.length)
        throw Error(`MCP tools/list tools[${index}].name must be a nonempty string`);
      for (const field of ['title', 'description'])
        if (tool[field] !== undefined && typeof tool[field] !== 'string')
          throw Error(`MCP tools/list tools[${index}].${field} must be a string`);
      for (const field of ['inputSchema', 'outputSchema'])
        if (tool[field] !== undefined && !isRecord(tool[field]))
          throw Error(`MCP tools/list tools[${index}].${field} must be an object`);
    }
    if (result.nextCursor !== undefined && typeof result.nextCursor !== 'string')
      throw Error('MCP tools/list nextCursor must be a string');
    // Preserve schemas and server metadata as data, never as permissions.
    // Fetch only the requested page rather than growing context without bounds.
    return {tools: result.tools as McpToolDefinition[], ...(result.nextCursor === undefined ? {} : {nextCursor: result.nextCursor as string})};
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    await this.ready;
    return await this.send("tools/call", { name, arguments: args ?? {} });
  }

  stop(reason = "MCP connection closed"): void {
    this.failAll(reason);
    try {
      if (process.platform !== "win32" && this.proc.pid)
        process.kill(-this.proc.pid, "SIGKILL");
      else this.proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

/** process-lifetime connection cache */
const clients = new Map<string, McpClient>();
let configCache:
  | { cwd: string; config?: McpConfig; error?: string }
  | undefined;

async function loadConfig(
  cwd: string,
  ctx?: { settings?: (name: string) => Promise<any> }
): Promise<{ config?: McpConfig; error?: string }> {
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
      const raw = ctx?.settings
        ? JSON.stringify(await ctx.settings("mcp.json"))
        : await fs.readFile(
            path.join(cwd, ".agent-compositor", "mcp.json"),
            "utf8"
          );
      config = JSON.parse(raw) as McpConfig;
    } catch {
      error =
        "no MCP config (set AGENT_MCP_CONFIG or .agent-compositor/mcp.json)";
    }
  }
  if (
    !error &&
    (!config ||
      typeof config !== "object" ||
      !config.mcpServers ||
      typeof config.mcpServers !== "object")
  ) {
    error = 'no MCP config: missing "mcpServers" object';
  }
  if(!error){const checked=mcpServerMapSchema.safeParse(config?.mcpServers);if(!checked.success)error='invalid MCP server configuration';else config={mcpServers:checked.data};}
  configCache = { cwd, config, error };
  return configCache;
}

async function getClient(
  server: string,
  servers: Record<string, McpServerConfig>,
  cwd: string
): Promise<McpClient> {
  const key = JSON.stringify([cwd, server, servers[server]]);
  let cached = clients.get(key);
  if (cached?.dead) {
    cached.stop(cached.dead);
    clients.delete(key);
    cached = undefined;
  }
  if (!cached) {
    const cfg = servers[server];
    if (!cfg || typeof cfg.command !== "string")
      throw new Error(`unknown mcp server: ${server}`);
    // Keep live handles synchronously available to the process exit handler;
    // promise callbacks cannot be relied on once the event loop is exiting.
    cached = new McpClient(cfg, cwd);
    clients.set(key, cached);
  }
  return cached;
}

/** test/exit hook: kill spawned servers */
export function __mcpShutdown(): void {
  for (const client of clients.values()) client.stop();
  clients.clear();
}
export function dispose(): void {
  process.removeListener('exit', __mcpShutdown);
  __mcpShutdown();
}
if (typeof process !== "undefined") process.on("exit", __mcpShutdown);

async function withAbort<T>(
  client: McpClient,
  signal: AbortSignal | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (signal?.aborted) {
    client.stop("MCP operation cancelled");
    signal.throwIfAborted();
  }
  const abort = () => client.stop("MCP operation cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  try {
    return await operation();
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}

export const mcpCallTool = {
  name: "mcp_call",
  description:
    'Gateway to MCP (Model Context Protocol) servers. Use action="list" to discover tools and their argument schemas ' +
    '(failures per server are reported inline). Set server to inspect only that server; follow its nextCursor with server and cursor to fetch another page. ' +
    'Use action="call" with server, tool and arguments matching the discovered inputSchema to execute. ' +
    "Config: AGENT_MCP_CONFIG env (JSON) or .agent-compositor/mcp.json.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "call"],
        description: "list servers/tools, or call a tool",
      },
      server: { type: "string", description: "required for call; optional server filter for list" },
      cursor: { type: "string", description: "opaque nextCursor from a previous list page; requires action=list and server" },
      tool: {
        type: "string",
        description: "tool name on the server (action=call)",
      },
      arguments: {
        type: "object",
        description: "arguments object for the tool (action=call)",
      },
    },
    required: ["action"],
  },
  describe: () => ({ tool: "mcp_call" }),
  async execute(
    ctx: {
      cwd: string;
      signal?: AbortSignal;
      env?: Record<string, string>;
      settings?: (name: string) => Promise<any>;
    },
    rawArgs: unknown
  ) {
    if (!isRecord(rawArgs)) return {ok: false, error: 'mcp_call: arguments must be an object'};
    const args = rawArgs as {
      action?: string;
      server?: string;
      tool?: string;
      arguments?: unknown;
      cursor?: string;
    };
    const action = args.action === undefined ? "list" : args.action;
    try {
      ctx.signal?.throwIfAborted();
      if (action !== 'list' && action !== 'call') throw Error('mcp_call: action must be list or call');
      if (args.server !== undefined && (typeof args.server !== 'string' || !args.server.length)) throw Error('mcp_call: server must be a nonempty string');
      if (args.cursor !== undefined && (action !== 'list' || !args.server || typeof args.cursor !== 'string')) throw Error('mcp_call: cursor requires action=list, a server and a string cursor');
      if (action === 'call') {
        if (!args.server || typeof args.tool !== 'string' || !args.tool.length) throw Error('mcp_call: server and tool are required for action=call');
        if (args.arguments !== undefined && !isRecord(args.arguments)) throw Error('mcp_call: arguments must be an object when supplied');
      }
      const loaded = await loadConfig(ctx.cwd, ctx);
      ctx.signal?.throwIfAborted();
      if (loaded.error || !loaded.config)
        return { ok: false, error: `mcp: ${loaded.error ?? "no config"}` };
      const servers = Object.fromEntries(
        Object.entries(loaded.config.mcpServers).map(([name, cfg]) => [
          name,
          { ...cfg, env: { ...ctx.env, ...cfg.env } },
        ])
      );
      if (args.server !== undefined && !Object.hasOwn(servers, args.server)) throw Error(`unknown mcp server: ${args.server}`);

      if (action === "list") {
        const listed: {
          name: string;
          tools?: McpToolDefinition[];
          nextCursor?: string;
          error?: string;
        }[] = [];
        for (const name of args.server === undefined ? Object.keys(servers) : [args.server]) {
          ctx.signal?.throwIfAborted();
          try {
            const client = await getClient(name, servers, ctx.cwd);
            listed.push({
              name,
              ...await withAbort(client, ctx.signal, () =>
                client.listTools(args.cursor)
              ),
            });
          } catch (err) {
            ctx.signal?.throwIfAborted();
            listed.push({
              name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return { ok: true, data: { servers: listed } };
      }

      if (action === "call") {
        if (!args.server || !args.tool)
          return {
            ok: false,
            error: "mcp_call: server and tool are required for action=call",
          };
        const client = await getClient(args.server, servers, ctx.cwd);
        const result = await withAbort(client, ctx.signal, () =>
          client.callTool(args.tool!, args.arguments)
        );
        if (!isRecord(result) || (result.isError !== undefined && typeof result.isError !== 'boolean'))
          return {ok: false, error: 'MCP tools/call returned an invalid result object or isError flag'};
        if (result.isError === true)
          return {ok: false, error: `MCP tool ${args.server}/${args.tool} failed: ${JSON.stringify(result)}`};
        return { ok: true, data: result };
      }
      return {
        ok: false,
        error: `mcp_call: unknown action "${action}" (list|call)`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

export default [mcpCallTool];
