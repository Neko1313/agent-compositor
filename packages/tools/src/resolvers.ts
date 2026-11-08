import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Default resolvers for the service.* events our tools emit. Registered at
 * the END of the hooks chain by the loop — everything here is interceptable:
 * { deny } in any handler short-circuits before these run.
 */
export interface ResolverBus {
  on(service: string, handler: (payload: unknown) => Promise<unknown>): void;
}

export function registerDefaultResolvers(bus: ResolverBus): void {
  bus.on("service.shell.exec", runExec);
  bus.on("service.file.read", readFileRange);
  bus.on("service.file.readText", readText);
  bus.on("service.file.write", writeFile);
  bus.on("service.file.edit", editFile);
}

const MAX_OUTPUT = 512 * 1024;
const MAX_FILE_LINES = 10_000;

interface ExecPayload {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}

function runExec(payload: unknown): Promise<unknown> {
  const p = payload as ExecPayload;
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(p.command, {
      shell: "/bin/sh",
      cwd: p.cwd,
      env: { ...process.env, ...p.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`exec timed out after ${p.timeoutMs}ms: ${p.command}`));
    }, p.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT) stdout = stdout.slice(0, MAX_OUTPUT) + "\n…[truncated]";
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT) stderr = stderr.slice(0, MAX_OUTPUT) + "\n…[truncated]";
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1, durationMs: Date.now() - started });
    });
  });
}

interface ReadPayload {
  path: string;
  offset?: number;
  limit?: number;
}

async function readFileRange(payload: unknown): Promise<unknown> {
  const p = payload as ReadPayload;
  const raw = await fs.readFile(p.path, "utf8");
  const lines = raw.split("\n");
  const start = Math.max((p.offset ?? 1) - 1, 0);
  const end = p.limit !== undefined ? Math.min(start + p.limit, lines.length) : Math.min(lines.length, MAX_FILE_LINES);
  return {
    content: lines.slice(start, end).join("\n"),
    totalLines: lines.length,
    truncated: end < lines.length,
  };
}

async function readText(payload: unknown): Promise<unknown> {
  const p = payload as { path: string };
  try {
    return await fs.readFile(p.path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeFile(payload: unknown): Promise<unknown> {
  const p = payload as { path: string; content: string };
  await fs.mkdir(path.dirname(p.path), { recursive: true });
  await fs.writeFile(p.path, p.content);
  return { path: p.path, bytes: Buffer.byteLength(p.content) };
}

interface EditPayload {
  path: string;
  oldText: string;
  newText: string;
  replaceAll: boolean;
}

async function editFile(payload: unknown): Promise<unknown> {
  const p = payload as EditPayload;
  if (!p.oldText) throw new Error("edit: oldText must be non-empty");
  const content = await fs.readFile(p.path, "utf8");

  const exactCount = countOccurrences(content, p.oldText);
  if (p.replaceAll) {
    if (exactCount === 0) {
      const normalized = normalizedReplace(content, p.oldText, p.newText, true);
      if (normalized.count === 0) throw new Error(`edit: no match for oldText in ${p.path}`);
      await fs.writeFile(p.path, normalized.content);
      return { path: p.path, replacements: normalized.count, match: "normalized" };
    }
    await fs.writeFile(p.path, content.split(p.oldText).join(p.newText));
    return { path: p.path, replacements: exactCount, match: "exact" };
  }

  if (exactCount === 1) {
    await fs.writeFile(p.path, content.replace(p.oldText, p.newText));
    return { path: p.path, replacements: 1, match: "exact" };
  }
  if (exactCount > 1) throw new Error(`edit: oldText matches ${exactCount} places — set replaceAll or narrow it`);

  const normalized = normalizedReplace(content, p.oldText, p.newText, false);
  if (normalized.count === 1) {
    await fs.writeFile(p.path, normalized.content);
    return { path: p.path, replacements: 1, match: "normalized" };
  }
  if (normalized.count > 1) throw new Error(`edit: normalized oldText matches ${normalized.count} places — narrow it`);
  throw new Error(`edit: no match for oldText in ${p.path}`);
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** whitespace-normalized matching: collapse whitespace runs (with a raw-index
 *  map) so indentation drift matches, then map matches back to raw offsets. */
function normalizedReplace(content: string, oldText: string, newText: string, all: boolean): { content: string; count: number } {
  let count = 0;
  let result = content;
  for (;;) {
    const { norm, map } = normalizeWithMap(result);
    const needle = normalizeWithMap(oldText).norm;
    const idx = norm.indexOf(needle);
    if (idx === -1) break;
    const rawStart = map[idx];
    const rawEnd = map[idx + needle.length - 1] + 1;
    result = result.slice(0, rawStart) + newText + result.slice(rawEnd);
    count++;
    if (!all) break;
  }
  return { content: result, count };
}

function normalizeWithMap(s: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let inWhitespace = false;
  for (let i = 0; i < s.length; i++) {
    if (/\s/.test(s[i])) {
      if (!inWhitespace) {
        norm += " ";
        map.push(i);
        inWhitespace = true;
      }
    } else {
      norm += s[i];
      map.push(i);
      inWhitespace = false;
    }
  }
  return { norm, map };
}
