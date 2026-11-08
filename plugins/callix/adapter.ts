import { atomicJson } from "@agent-compositor/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, readFile, stat } from "node:fs/promises";
import { isAbsolute, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { projectFiles } from "@agent-compositor/tools";

export interface GraphNode {
  id: string;
  name: string;
  qualified_name: string;
  kind: string;
  file_path?: string | null;
  span?: number[] | null;
  metadata?: Record<string, unknown>;
}
export interface GraphRelation {
  source_id: string;
  target_id: string;
  kind: string;
  metadata?: Record<string, unknown>;
}
export interface Graph {
  schema_version: number;
  nodes: GraphNode[];
  relations: GraphRelation[];
  metadata: Record<string, unknown>;
}
export interface Query {
  settings?: Settings;
  cacheDir?: string;
  cwd: string;
  action: string;
  pattern?: string;
  path?: string;
  refresh?: boolean;
  limit?: number;
}
type Settings = {
  executable?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};
type Entry = {
  fingerprint: string;
  graph: Graph;
  stderr: string;
  indexedAt: string;
};
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();

/** No shell, automatic dependency installation or silent structural fallback. */
export function runBinary(
  executable: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = 120000,
  maxOutputBytes = 64 * 1024 * 1024
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((accept, reject) => {
    if (signal?.aborted) {
      reject(new Error("Callix cancelled"));
      return;
    }
    const grouped = process.platform !== "win32";
    const proc = spawn(executable, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: grouped,
    });
    const output: Buffer[] = [],
      errors: Buffer[] = [];
    let bytes = 0,
      errorBytes = 0,
      failure: Error | undefined;
    const stop = (message: string) => {
      failure ??= new Error(message);
      try {
        if (grouped && proc.pid) process.kill(-proc.pid, "SIGKILL");
        else proc.kill("SIGKILL");
      } catch {
        proc.kill("SIGKILL");
      }
    };
    const abort = () => stop("Callix cancelled");
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () => stop(`Callix exceeded ${timeoutMs}ms`),
      timeoutMs
    );
    proc.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxOutputBytes) stop("Callix graph exceeds output limit");
      else output.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      if (errorBytes < 16000)
        errors.push(chunk.subarray(0, 16000 - errorBytes));
      errorBytes += chunk.length;
    });
    proc.on("error", (error) => {
      failure = new Error(
        `Cannot run Callix (${executable}): ${error.message}. Install Callix 1.7+ or set CALLIX_BIN.`
      );
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      const stderr = Buffer.concat(errors).toString("utf8");
      if (failure || code !== 0)
        reject(failure ?? new Error(`Callix exited ${code}: ${stderr}`));
      else accept({ stdout: Buffer.concat(output).toString("utf8"), stderr });
    });
  });
}

async function settings(
  cwd: string,
  override?: Settings
): Promise<Required<Settings>> {
  let config: Settings = override ?? {};
  try {
    if (!override)
      config = JSON.parse(
        await readFile(join(cwd, ".agent-compositor/callix.json"), "utf8")
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (config.executable !== undefined && typeof config.executable !== "string")
    throw new Error("callix.executable must be a string");
  const bundled = fileURLToPath(new URL("./bin/callix", import.meta.url));
  const executable =
    process.env.CALLIX_BIN ||
    config.executable ||
    (await stat(bundled).then(
      () => bundled,
      () => "callix"
    ));
  const bounded = (
    value: number | undefined,
    fallback: number,
    min: number,
    max: number
  ) =>
    value === undefined
      ? fallback
      : Number.isFinite(value) && value >= min && value <= max
      ? value
      : (() => {
          throw new Error("Invalid Callix resource limit");
        })();
  return {
    executable:
      executable.includes("/") && !isAbsolute(executable)
        ? resolve(cwd, executable)
        : executable,
    timeoutMs: bounded(config.timeoutMs, 120000, 100, 600000),
    maxOutputBytes: bounded(
      config.maxOutputBytes,
      64 * 1024 * 1024,
      1024,
      256 * 1024 * 1024
    ),
  };
}

async function fingerprint(cwd: string): Promise<string> {
  const hash = createHash("sha256");
  // Include resolver configuration/lockfiles as well as source paths and file times.
  for (const path of await projectFiles(cwd)) {
    const info = await stat(join(cwd, path)).catch(() => undefined);
    if (info?.isFile())
      hash.update(`${path}\0${info.size}\0${info.mtimeMs}\0${info.ctimeMs}\n`);
  }
  return hash.digest("hex");
}

export function parseGraph(text: string): Graph {
  const graph = JSON.parse(text) as Graph;
  if (
    graph.schema_version !== 1 ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.relations) ||
    !graph.nodes.every(
      (n) =>
        n &&
        typeof n.id === "string" &&
        typeof n.name === "string" &&
        typeof n.qualified_name === "string" &&
        typeof n.kind === "string"
    ) ||
    !graph.relations.every(
      (r) =>
        r &&
        typeof r.source_id === "string" &&
        typeof r.target_id === "string" &&
        typeof r.kind === "string"
    )
  )
    throw new Error("Unsupported Callix JSON graph");
  graph.metadata ??= {};
  return graph;
}

export async function indexProject(
  cwd: string,
  refresh = false,
  signal?: AbortSignal,
  options?: { settings?: Settings; cacheDir?: string }
): Promise<Entry> {
  const root = await realpath(cwd),
    config = await settings(root, options?.settings);
  const key = `${root}\0${JSON.stringify(config)}`,
    mark = await fingerprint(root);
  const cacheFile = options?.cacheDir
    ? join(options.cacheDir, "index.json")
    : undefined;
  if (!refresh && !cache.has(key) && cacheFile) {
    try {
      const stored = JSON.parse(await readFile(cacheFile, "utf8")) as Entry;
      if (stored.fingerprint === mark) {
        parseGraph(JSON.stringify(stored.graph));
        cache.set(key, stored);
      }
    } catch {}
  }
  const existing = cache.get(key);
  if (!refresh && existing?.fingerprint === mark) return existing;
  // Share a running index only when its lifetime is not tied to another request's cancellation.
  if (!signal && pending.has(key)) return pending.get(key)!;
  const work = (async () => {
    const { stdout, stderr } = await runBinary(
      config.executable,
      ["analyze", root, "--quiet"],
      root,
      signal,
      config.timeoutMs,
      config.maxOutputBytes
    );
    const entry = {
      graph: parseGraph(stdout),
      fingerprint: mark,
      stderr,
      indexedAt: new Date().toISOString(),
    };
    if (cache.size >= 4) cache.delete(cache.keys().next().value!);
    cache.set(key, entry);
    if (cacheFile) await atomicJson(cacheFile, entry);
    return entry;
  })();
  if (!signal) pending.set(key, work);
  try {
    return await work;
  } finally {
    if (pending.get(key) === work) pending.delete(key);
  }
}

/** Return bounded graph slices; retain edge spans and resolver quality information. */
export function queryGraph(graph: Graph, args: Query): Record<string, unknown> {
  const limit = Math.max(1, Math.min(args.limit ?? 100, 1000)),
    pattern = args.pattern ?? "";
  const location = (n: GraphNode) =>
    !args.path ||
    n.file_path
      ?.replaceAll("\\", "/")
      .endsWith(args.path.replaceAll("\\", "/"));
  const exact = graph.nodes.filter(
    (n) =>
      location(n) &&
      (n.id === pattern || n.qualified_name === pattern || n.name === pattern)
  );
  const symbols = exact.length
    ? exact
    : graph.nodes.filter(
        (n) =>
          location(n) &&
          `${n.name} ${n.qualified_name}`
            .toLowerCase()
            .includes(pattern.toLowerCase())
      );
  if (args.action === "status")
    return {
      nodes: graph.nodes.length,
      relations: graph.relations.length,
      metadata: graph.metadata,
    };
  if (args.action === "symbols" || args.action === "definition")
    return {
      symbols: symbols.slice(0, limit),
      truncated: symbols.length > limit,
      metadata: graph.metadata,
    };
  const ids = new Set(symbols.map((n) => n.id));
  const relations = graph.relations.filter((r) => {
    if (args.action === "callers")
      return r.kind === "calls" && ids.has(r.target_id);
    if (args.action === "callees")
      return r.kind === "calls" && ids.has(r.source_id);
    if (args.action === "references")
      return r.kind === "references" && ids.has(r.target_id);
    if (args.action === "dependencies")
      return (
        ["imports", "depends_on"].includes(r.kind) &&
        (pattern === "" || ids.has(r.source_id))
      );
    throw new Error(`Unknown graph action: ${args.action}`);
  });
  const slice = relations.slice(0, limit),
    adjacent = new Set(slice.flatMap((r) => [r.source_id, r.target_id]));
  return {
    symbols: symbols.slice(0, limit),
    relations: slice,
    nodes: graph.nodes.filter((n) => adjacent.has(n.id)).slice(0, limit * 2),
    truncated: relations.length > limit,
    metadata: graph.metadata,
  };
}

export async function query(
  args: Query,
  signal?: AbortSignal
): Promise<unknown> {
  const entry = await indexProject(args.cwd, args.refresh, signal, args);
  return {
    provider: "callix",
    indexedAt: entry.indexedAt,
    warnings: entry.stderr || undefined,
    ...queryGraph(entry.graph, args),
  };
}
