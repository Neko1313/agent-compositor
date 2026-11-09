import { atomicJson } from "@agent-compositor/config";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, readFile, stat, access } from "node:fs/promises";
import { isAbsolute, resolve, join, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { graphIndex, selectSymbols, compactNode, quality, filePath, readSymbol, budgetResult } from "./navigation.js";
import { estimateTokens } from "@agent-compositor/context";
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
    offset?: number;
    cursor?: string;
    maxTokens?: number;
    detail?: "compact" | "raw";
    kinds?: string[];
    depth?: number;
}
type Settings = {
    executable?: string;
    timeoutMs?: number;
    maxOutputBytes?: number;
};
export type Entry = {
    cacheKey: string;
    buildMs: number;
    fingerprint: string;
    graph: Graph;
    stderr: string;
    indexedAt: string;
};
const cache = new Map<string, Entry>();
const pending = new Map<string, {
    promise: Promise<Entry>;
    controller: AbortController;
    users: number;
}>();
/** No shell, automatic dependency installation or silent structural fallback. */
export function runBinary(executable: string, args: string[], cwd: string, signal?: AbortSignal, timeoutMs = 120000, maxOutputBytes = 64 * 1024 * 1024): Promise<{
    stdout: string;
    stderr: string;
}> {
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
        const output: Buffer[] = [], errors: Buffer[] = [];
        let bytes = 0, errorBytes = 0, failure: Error | undefined;
        const stop = (message: string) => {
            failure ??= new Error(message);
            try {
                if (grouped && proc.pid)
                    process.kill(-proc.pid, "SIGKILL");
                else
                    proc.kill("SIGKILL");
            }
            catch {
                proc.kill("SIGKILL");
            }
        };
        const abort = () => stop("Callix cancelled");
        signal?.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => stop(`Callix exceeded ${timeoutMs}ms`), timeoutMs);
        proc.stdout.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > maxOutputBytes)
                stop("Callix graph exceeds output limit");
            else
                output.push(chunk);
        });
        proc.stderr.on("data", (chunk: Buffer) => {
            if (errorBytes < 16000)
                errors.push(chunk.subarray(0, 16000 - errorBytes));
            errorBytes += chunk.length;
        });
        proc.on("error", (error) => {
            failure = new Error(`Cannot run Callix (${executable}): ${error.message}. Install Callix 1.7+ or set CALLIX_BIN.`);
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
            const stderr = Buffer.concat(errors).toString("utf8");
            if (failure || code !== 0)
                reject(failure ?? new Error(`Callix exited ${code}: ${stderr}`));
            else
                accept({ stdout: Buffer.concat(output).toString("utf8"), stderr });
        });
    });
}
async function settings(cwd: string, override?: Settings): Promise<Required<Settings>> {
    let config: Settings = override ?? {};
    try {
        if (!override)
            config = JSON.parse(await readFile(join(cwd, ".agent-compositor/callix.json"), "utf8"));
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT")
            throw error;
    }
    if (config.executable !== undefined && typeof config.executable !== "string")
        throw new Error("callix.executable must be a string");
    const bundled = fileURLToPath(new URL("./bin/callix", import.meta.url));
    let executable = process.env.CALLIX_BIN ||
        config.executable ||
        (await stat(bundled).then(() => bundled, () => "callix"));
    if(!executable.includes('/'))for(const dir of (process.env.PATH??'').split(delimiter).filter(Boolean)){const candidate=resolve(dir,executable);if(await access(candidate,1).then(()=>true,()=>false)){executable=candidate;break;}}
  const bounded = (value: number | undefined, fallback: number, min: number, max: number) => value === undefined
        ? fallback
        : Number.isFinite(value) && value >= min && value <= max
            ? value
            : (() => {
                throw new Error("Invalid Callix resource limit");
            })();
    return {
        executable: executable.includes("/") && !isAbsolute(executable)
            ? resolve(cwd, executable)
            : executable,
        timeoutMs: bounded(config.timeoutMs, 120000, 100, 600000),
        maxOutputBytes: bounded(config.maxOutputBytes, 64 * 1024 * 1024, 1024, 256 * 1024 * 1024),
    };
}
export async function fingerprint(cwd: string): Promise<{
    mark: string;
    files: string[];
}> {
    const files = await projectFiles(cwd), hash = createHash('sha256');
    for (let i = 0; i < files.length; i += 64) {
        const values = await Promise.all(files.slice(i, i + 64).map(async (path) => { const info = await stat(join(cwd, path), { bigint: true }).catch(() => null); return info?.isFile() ? `${path}\0${info.size}\0${info.mtimeNs}\0${info.ctimeNs}\n` : ''; }));
        for (const v of values)
            hash.update(v);
    }
    for (const name of ['.agentignore', '.geminiignore', '.gitignore'])
        hash.update(await readFile(join(cwd, name)).catch(() => Buffer.alloc(0)));
    return { mark: hash.digest('hex'), files };
}
function visibleGraph(graph: Graph, cwd: string, files: string[]): Graph {
    const allowed = new Set(files), nodes = graph.nodes.filter(n => !n.file_path || allowed.has(filePath(cwd, n.file_path) ?? ''));
    const ids = new Set(nodes.map(n => n.id));
    return { ...graph, nodes: nodes.map(n => n.file_path ? { ...n, file_path: filePath(cwd, n.file_path) } : n), relations: graph.relations.filter(r => ids.has(r.source_id) && ids.has(r.target_id)) };
}
export function parseGraph(text: string): Graph {
    const graph = JSON.parse(text) as Graph;
    if (graph.schema_version !== 1 ||
        !Array.isArray(graph.nodes) ||
        !Array.isArray(graph.relations) ||
        !graph.nodes.every((n) => n &&
            typeof n.id === "string" &&
            typeof n.name === "string" &&
            typeof n.qualified_name === "string" &&
            typeof n.kind === "string") ||
        !graph.relations.every((r) => r &&
            typeof r.source_id === "string" &&
            typeof r.target_id === "string" &&
            typeof r.kind === "string"))
        throw new Error("Unsupported Callix JSON graph");
    if(new Set(graph.nodes.map(n=>n.id)).size!==graph.nodes.length)throw Error("Duplicate Callix symbol IDs");
  const ids=new Set(graph.nodes.map(n=>n.id));if(graph.relations.some(r=>!ids.has(r.source_id)||!ids.has(r.target_id)))throw Error("Dangling Callix graph relation");
  graph.metadata ??= {};
    return graph;
}
export async function indexProject(cwd: string, refresh = false, signal?: AbortSignal, options?: {
    settings?: Settings;
    cacheDir?: string;
}): Promise<Entry> {
    signal?.throwIfAborted();
    const root = await realpath(cwd), config = await settings(root, options?.settings);
    const binary = await stat(config.executable).catch(() => null), key = `callix-index-v2\0${root}\0${JSON.stringify(config)}\0${binary?.size ?? ''}:${binary?.mtimeMs ?? ''}:${binary?.ctimeMs??''}`, snapshot = await fingerprint(root);
    signal?.throwIfAborted();
    const cacheFile = options?.cacheDir ? join(options.cacheDir, 'index.json') : undefined;
    if (!refresh && !cache.has(key) && cacheFile) {
        try {
            const stored = JSON.parse(await readFile(cacheFile, 'utf8')) as Entry;
            if (stored.cacheKey === key && stored.fingerprint === snapshot.mark) {
                parseGraph(JSON.stringify(stored.graph));
                cache.set(key, stored);
            }
        }
        catch { }
    }
    const existing = cache.get(key);
    if (!refresh && existing?.fingerprint === snapshot.mark)
        return existing;
    let job = pending.get(key);
    if (!job) {
        const controller = new AbortController();
        const promise = (async () => {
            const started = performance.now();
            let before = snapshot;
            for (let attempt = 0; attempt < 3; attempt++) {
                controller.signal.throwIfAborted();
                const { stdout, stderr } = await runBinary(config.executable, ['analyze', root, '--quiet'], root, controller.signal, config.timeoutMs, config.maxOutputBytes);
                const graph = parseGraph(stdout), after = await fingerprint(root);
                if (before.mark !== after.mark) {
                    before = after;
                    continue;
                }
                const entry: Entry = { graph: visibleGraph(graph, root, after.files), cacheKey: key, fingerprint: after.mark, stderr, indexedAt: new Date().toISOString(), buildMs: Math.round(performance.now() - started) };
                if (cache.size >= 4)
                    cache.delete(cache.keys().next().value!);
                cache.set(key, entry);
                if (cacheFile)
                    await atomicJson(cacheFile, entry);
                return entry;
            }
            throw Error('Callix sources changed repeatedly during analysis; retry on a stable project');
        })();
        job = { promise, controller, users: 0 };
        pending.set(key, job);
        const current = job;
        void promise.finally(() => { if (pending.get(key) === current)
            pending.delete(key); }).catch(() => { });
    }
    job.users++;
    const current = job;
    return new Promise<Entry>((accept, reject) => {
        let settled = false;
        const done = (error?: unknown, value?: Entry) => { if (settled)
            return; settled = true; signal?.removeEventListener('abort', abort); current.users--; if (!current.users && pending.get(key) === current)
            current.controller.abort(); error ? reject(error) : accept(value!); };
        const abort = () => done(Error('Callix cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
            abort();
            return;
        }
        current.promise.then(value => done(undefined, value), error => done(error));
    });
}
/** Indexed adjacency lookups keep warm graph navigation proportional to results. */
export function queryGraph(graph: Graph, args: Query): Record<string, any> {
    const limit = Math.max(1, Math.min(args.limit ?? 40, 1000)), offset = args.offset ?? 0, symbols = selectSymbols(graph, args), index = graphIndex(graph);
    if(args.pattern&&symbols.length>1&&['callers','callees','references','impact'].includes(args.action))return{symbols:symbols.slice(offset,offset+limit),total:symbols.length,offset,truncated:symbols.length>offset+limit,ambiguous:true,hint:'Choose one exact symbol ID before traversing relationships.',metadata:graph.metadata};
    if (args.action === 'status')
        return { nodes: graph.nodes.length, relations: graph.relations.length, metadata: graph.metadata };
    if (['symbols', 'definition', 'outline'].includes(args.action)) {
        const selected = args.action === 'outline' ? symbols.filter(n => !['parameter', 'import', 'external_symbol', 'file', 'project', 'module'].includes(n.kind)) : symbols;
        return { symbols: selected.slice(offset, offset + limit), total: selected.length, offset, truncated: selected.length > offset + limit, metadata: graph.metadata };
    }
    const ids = new Set(symbols.map(n => n.id));
    let relations: GraphRelation[] = [];let traversalTruncated=false;
    if (args.action === 'callers' || args.action === 'references')
        relations = [...ids].flatMap(id => index.incoming.get(id) ?? []).filter(r => args.action === 'callers' ? r.kind === 'calls' : ['references', 'calls', 'resolves_to'].includes(r.kind));
    else if (args.action === 'callees')
        relations = [...ids].flatMap(id => index.outgoing.get(id) ?? []).filter(r => r.kind === 'calls');
    else if (args.action === 'dependencies')
        relations = (args.pattern ? [...ids].flatMap(id => index.outgoing.get(id) ?? []) : graph.relations).filter(r => ['imports', 'depends_on'].includes(r.kind));
    else if (args.action === 'impact') {
        let frontier = [...ids];
        const visited = new Set(frontier), depth = Math.min(args.depth ?? 2, 4);
        for (let d = 0; d < depth; d++) {
            const next: string[] = [];
            for (const id of frontier)
                for (const r of index.incoming.get(id) ?? []) {
                    if (!['calls', 'references', 'imports', 'depends_on'].includes(r.kind))
                        continue;
                    if(relations.length>=4000){traversalTruncated=true;break;}
                    relations.push(r);
                    if (!visited.has(r.source_id)) {
                        visited.add(r.source_id);
                        next.push(r.source_id);
                    }
                }
            frontier = next;
            if (traversalTruncated || visited.size > 4000 || !frontier.length)
                break;
        }
    }
    else
        throw Error(`Unknown graph action: ${args.action}`);
    relations = [...new Set(relations)];
    const slice = relations.slice(offset, offset + limit), adjacent = new Set(slice.flatMap(r => [r.source_id, r.target_id]));
    return { symbols: symbols.slice(0, limit), relations: slice, nodes: [...adjacent].map(id => index.ids.get(id)).filter(Boolean), total: relations.length, offset, ...(traversalTruncated?{traversalTruncated:true}:{}),truncated: relations.length > offset + limit, metadata: graph.metadata };
}
const returned = new WeakSet<Entry>();
export async function query(args: Query, signal?: AbortSignal): Promise<any> {
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 1000) || args.depth !== undefined && (!Number.isInteger(args.depth) || args.depth < 1 || args.depth > 4))
        throw Error("Invalid navigation limits");
    if (args.maxTokens !== undefined && (!Number.isInteger(args.maxTokens) || args.maxTokens < 256 || args.maxTokens > 16000))
        throw Error("maxTokens must be 256..16000");
    const started = performance.now(), entry = await indexProject(args.cwd, args.refresh, signal, args), warm = returned.has(entry);
    returned.add(entry);
    const signature = createHash('sha256').update(JSON.stringify([args.action, args.pattern ?? '', args.path ?? '', args.kinds ?? [], args.detail ?? 'compact', args.depth ?? 2])).digest('hex').slice(0, 16);
    let offset = 0;
    if (args.cursor) {
        try {
            const c = JSON.parse(Buffer.from(args.cursor, 'base64url').toString());
            if (c.f !== entry.fingerprint || c.q !== signature || !Number.isInteger(c.o) || c.o < 0)
                throw Error();
            offset = c.o;
        }
        catch {
            throw Error('Stale or incompatible navigation cursor; repeat the query without cursor');
        }
    }
    let result: any;
    if (args.action === 'read_symbol') {
        result = await readSymbol(entry.graph, args);
        if ((await fingerprint(args.cwd)).mark !== entry.fingerprint)
            throw Error('Source changed while reading symbol; repeat read_symbol');
    }
    else
        result = queryGraph(entry.graph, { ...args, offset });
    if (args.detail !== 'raw') {
        if (Array.isArray(result.symbols))
            result.symbols = result.symbols.map(compactNode);
        if (Array.isArray(result.nodes))
            result.nodes = result.nodes.map(compactNode);
        result.metadata = quality(entry.graph);
    }
    const primary = Array.isArray(result.relations) ? 'relations' : Array.isArray(result.symbols) ? 'symbols' : undefined;
    const cursor = (n: number) => Buffer.from(JSON.stringify({ f: entry.fingerprint, q: signature, o: n })).toString('base64url');
    const base = { provider: 'callix', indexedAt: entry.indexedAt, revision: entry.fingerprint, ...result, ...(primary ? { nextCursor: cursor(offset + result[primary].length) } : {}), warnings: entry.stderr.slice(0, 500) || undefined, metrics: { cache: warm ? 'warm' : 'cold-or-disk', indexMs: entry.buildMs, queryMs: Math.round(performance.now() - started) } };
    let out = budgetResult(base, args.maxTokens ?? 2000, 32);
    if (primary) {
        const count = out[primary].length;
        if (!count && result[primary].length)
            throw Error('One result exceeds maxTokens; use compact detail or increase the budget');
        out.truncated = out.truncated || offset + count < result.total;
        if (out.truncated)
            out.nextCursor = cursor(offset + count);
        else
            delete out.nextCursor;
        if (out.relations) {
            const needed = new Set(out.relations.flatMap((r: GraphRelation) => [r.source_id, r.target_id]));
            out.nodes = out.nodes.filter((n: GraphNode) => needed.has(n.id));
        }
        out = budgetResult(out, args.maxTokens ?? 2000);
    }
    return out;
}
