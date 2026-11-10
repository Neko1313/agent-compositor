import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  unlink,
  stat,
  rename,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { confinedPath, projectFiles } from "@agent-compositor/tools";
type File = { data: string; hash: string; mode: number };
type Snapshot = {
  id: string;
  at: number;
  messages: unknown[];
  before: Record<string, File>;
  after?: Record<string, string>;
  afterContent?: Record<string, string>;
};
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const stateRoots = new Map<string, string>();
export function checkpointStorage(session: string, dir: string, cwd?: string) {
  stateRoots.set(cwd ? JSON.stringify([cwd, session]) : session, dir);
}
const root = (cwd: string, session: string) => {
  if (!/^[\w-]+$/.test(session)) throw new Error("Invalid session");
  return join(
    stateRoots.get(JSON.stringify([cwd,session])) ?? stateRoots.get(session) ?? join(cwd, ".agent-compositor"),
    "turn-checkpoints",
    session
  );
};
const file = (cwd: string, session: string, id: string) => {
  if (!/^[\w-]+$/.test(id)) throw new Error("Invalid checkpoint");
  return join(root(cwd, session), id + ".json");
};
async function files(cwd: string): Promise<Record<string, File>> {
  const result: Record<string, File> = Object.create(null);
  let total = 0;
  const paths = await projectFiles(cwd, 10001);
  if (paths.length > 10000) throw new Error("Checkpoint exceeds 10000 files");
  for (const path of paths) {
    const info = await stat(join(cwd, path)).catch(() => undefined);
    if (!info?.isFile()) continue;
    if (info.size > 8000000 || (total += info.size) > 64000000)
      throw new Error("Checkpoint exceeds file/total size limits");
    const data = await readFile(await confinedPath(cwd, path));
    result[path] = {
      data: data.toString("base64"),
      hash: hash(data),
      mode: info.mode & 0o777,
    };
  }
  return result;
}
export async function capture(
  cwd: string,
  session: string,
  id: string,
  messages: unknown[]
) {
  const snapshot: Snapshot = {
    id,
    at: Date.now(),
    messages,
    before: await files(cwd),
  };
  await mkdir(root(cwd, session), { recursive: true });
  await save(cwd, session, snapshot);
}
async function save(cwd: string, session: string, value: Snapshot) {
  const path = file(cwd, session, value.id);
  await writeFile(path + ".tmp", JSON.stringify(value), { mode: 0o600 });
  await rename(path + ".tmp", path);
  const metadata = {
    ...value,
    messages: [],
    afterContent: undefined,
    before: Object.fromEntries(
      Object.entries(value.before).map(([path, f]) => [
        path,
        { ...f, data: "" },
      ])
    ),
  };
  await writeFile(
    path.replace(/\.json$/, ".meta.json") + ".tmp",
    JSON.stringify(metadata),
    { mode: 0o600 }
  );
  await rename(
    path.replace(/\.json$/, ".meta.json") + ".tmp",
    path.replace(/\.json$/, ".meta.json")
  );
}
export async function load(
  cwd: string,
  session: string,
  id: string
): Promise<Snapshot> {
  return JSON.parse(await readFile(file(cwd, session, id), "utf8"));
}
export async function finish(cwd: string, session: string, id: string) {
  const path = file(cwd, session, id);
  const value: Snapshot = JSON.parse(await readFile(path, "utf8"));
  const after = await files(cwd);
  value.after = Object.fromEntries(
    Object.entries(after).map(([name, f]) => [name, f.hash])
  );
  value.afterContent = Object.fromEntries(
    Object.entries(after)
      .filter(([name, f]) => f.hash !== value.before[name]?.hash)
      .map(([name, f]) => [name, f.data])
  );
  await save(cwd, session, value);
}
export async function list(cwd: string, session: string): Promise<Snapshot[]> {
  const all = await readdir(root(cwd, session)).catch(() => []);
  const result: Snapshot[] = [];
  for (const name of all
    .filter((n) => /^[\w-]+\.meta\.json$/.test(n))
    .slice(-100)) {
    try {
      result.push(
        JSON.parse(await readFile(join(root(cwd, session), name), "utf8"))
      );
    } catch {
      /* preserve damaged checkpoints */
    }
  }
  return result.sort((a, b) => b.at - a.at);
}
export function changes(value: Snapshot) {
  if (!value.after) return [];
  return [
    ...new Set([...Object.keys(value.before), ...Object.keys(value.after)]),
  ]
    .filter((path) => value.before[path]?.hash !== value.after![path])
    .map((path) => ({
      path,
      kind: !value.before[path]
        ? "added"
        : !value.after![path]
        ? "deleted"
        : "modified",
      before: value.before[path]?.data,
      afterHash: value.after![path],
    }));
}
export async function restoreCode(
  cwd: string,
  value: Snapshot,
  paths?: string[]
) {
  if (!value.after)
    throw new Error("Checkpoint has no completed code snapshot");
  const all = changes(value);
  if (paths?.some((path) => !all.some((row) => row.path === path)))
    throw new Error("Selected file is not part of this checkpoint");
  const rows = paths ? all.filter((row) => paths.includes(row.path)) : all;
  for (const row of rows) {
    const path = await confinedPath(cwd, row.path, true),
      current = await readFile(path).catch((e: any) => {
        if (e.code !== "ENOENT") throw e;
        return undefined;
      });
    const currentHash = current ? hash(current) : undefined;
    if (
      currentHash !== row.afterHash &&
      currentHash !== value.before[row.path]?.hash
    )
      throw new Error(`File changed after checkpoint: ${row.path}`);
    if (
      row.before &&
      hash(Buffer.from(row.before, "base64")) !== value.before[row.path].hash
    )
      throw new Error("Corrupted checkpoint content");
  }
  for (const row of rows) {
    const path = await confinedPath(cwd, row.path, true);
    if (row.before !== undefined) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, Buffer.from(row.before, "base64"), {
        mode: value.before[row.path].mode,
      });
    } else
      await unlink(path).catch((e: any) => {
        if (e.code !== "ENOENT") throw e;
      });
  }
  return rows.length;
}
