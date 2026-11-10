import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink, unlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceAccess } from "../src/workspace.js";

const temporary: string[] = [];
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "workspace-boundaries-")));
  temporary.push(root);
  const primary = join(root, "primary"), extra = join(root, "extra"), neighbor = join(root, "extra-neighbor");
  await Promise.all([primary, extra, neighbor].map(path => mkdir(path)));
  const file = join(extra, "selected.txt");
  await writeFile(file, "selected");
  return { root, primary, extra, neighbor, file, workspace: new WorkspaceAccess(primary, root) };
}

describe("workspace filesystem boundaries", () => {
  it("allows creation beneath an attached directory while rejecting adjacent prefixes", async () => {
    const f = await fixture();
    await f.workspace.add("~/extra");
    expect(await f.workspace.resolve("~/extra/new/deep/file.txt", { missing: true }))
      .toBe(join(f.extra, "new/deep/file.txt"));
    await expect(f.workspace.resolve(join(f.neighbor, "new.txt"), { missing: true })).rejects.toThrow("escapes");
    await expect(f.workspace.resolve("~/extra/missing.txt")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(f.workspace.resolve(f.file, { directory: true })).rejects.toThrow("Not a workspace directory");
  });

  it("revokes nested file grants through a directory alias without revoking neighbors", async () => {
    const f = await fixture(), alias = join(f.root, "extra-alias");
    await symlink(f.extra, alias, "dir");
    await f.workspace.add(f.file);
    await f.workspace.add(alias);
    await f.workspace.add(f.neighbor);
    expect(await f.workspace.remove(alias)).toBe(true);
    await expect(f.workspace.resolve(f.file)).rejects.toThrow("escapes");
    expect(await f.workspace.resolve(f.neighbor, { directory: true })).toBe(f.neighbor);
    await expect(f.workspace.remove(f.primary)).rejects.toThrow("primary workspace");
  });

  it("does not follow a retargeted symlink into an unselected directory for a new write", async () => {
    const f = await fixture(), alias = join(f.primary, "link");
    await f.workspace.add(f.extra);
    await symlink(f.extra, alias, "dir");
    expect(await f.workspace.resolve(join(alias, "selected.txt"))).toBe(f.file);
    await unlink(alias);
    await symlink(f.neighbor, alias, "dir");
    await expect(f.workspace.resolve(join(alias, "new/nested.txt"), { missing: true })).rejects.toThrow("escapes");
  });

  it("restores valid records while ignoring missing paths and mismatched file kinds", async () => {
    const f = await fixture();
    f.workspace.restore([null, {}, { path: f.file, kind: "directory" }, { path: f.extra, kind: "file" },
      { path: join(f.root, "deleted"), kind: "directory" }, { path: f.file, kind: "file" }]);
    expect(f.workspace.list()).toEqual([{ path: f.primary, kind: "directory" }, { path: f.file, kind: "file" }]);
    expect(await f.workspace.resolve(f.file)).toBe(f.file);
    await expect(f.workspace.resolve(f.extra, { directory: true })).rejects.toThrow("escapes");
  });

  it("does not turn relative or malformed saved paths into grants from the process cwd", async () => {
    const f = await fixture();
    f.workspace.restore([{ path: ".", kind: "directory" }, { path: 42, kind: "file" }, { path: f.extra, kind: "socket" }]);
    expect(f.workspace.list()).toEqual([{ path: f.primary, kind: "directory" }]);
  });

  it("returns independent scope snapshots and deduplicates aliases", async () => {
    const f = await fixture(), alias = join(f.root, "alias");
    await symlink(f.extra, alias, "dir");
    await f.workspace.add(f.extra); await f.workspace.add(alias); await f.workspace.add(f.file);
    const snapshot = f.workspace.list();
    snapshot[1].path = f.neighbor;
    snapshot.push({ path: f.root, kind: "directory" });
    expect(f.workspace.list()).toHaveLength(2);
    await expect(f.workspace.resolve(f.neighbor)).rejects.toThrow("escapes");
    expect(await f.workspace.resolve(f.file)).toBe(f.file);
  });

  it("requires startup extra roots to exist and be directories", async () => {
    const f = await fixture();
    expect(() => new WorkspaceAccess(f.primary, f.root, [f.file])).toThrow("must be a directory");
    expect(() => new WorkspaceAccess(f.primary, f.root, [join(f.root, "missing")])).toThrow();
  });
});
