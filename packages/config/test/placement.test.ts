import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { savePlacementRule, loadConfig } from "../src/index.js";
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "ac-placement-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const rule = { match: { plugin: "cost", surface: "usage" }, site: "sidebar" as const, workspace: 2, size: .25, focus: false };
describe("placement persistence", () => {
  it("preserves JSONC comments, unrelated settings and inherited rules across restart", async () => {
    await writeFile(join(root, "agent-compositor.json"), JSON.stringify({ ui: { rules: [{ match: { plugin: "other" }, site: "inspector" }] } }));
    await mkdir(join(root, ".agent-compositor"));
    await writeFile(join(root, ".agent-compositor/agent-compositor.jsonc"), '{\n// keep this comment\n"model": "{env:MY_MODEL}"\n}\n');
    const loaded = await loadConfig({ cwd: root, global: false, system: false });
    const saved = await savePlacementRule(root, rule, loaded.config.ui?.rules);
    const text = await readFile(saved.path, "utf8");
    expect(text).toContain("// keep this comment"); expect(text).toContain("{env:MY_MODEL}");
    const reloaded = await loadConfig({ cwd: root, global: false, system: false });
    expect(reloaded.config.ui?.rules).toHaveLength(2);
    expect(reloaded.config.ui?.rules?.at(-1)).toEqual(rule);
    await savePlacementRule(root, { ...rule, workspace: 3 });
    expect((await loadConfig({ cwd: root, global: false, system: false })).config.ui?.rules).toHaveLength(2);
  });
  it("refuses malformed overrides without changing them", async () => {
    await mkdir(join(root, ".agent-compositor"));
    const file = join(root, ".agent-compositor/agent-compositor.jsonc");
    await writeFile(file, "{broken");
    await expect(savePlacementRule(root, rule)).rejects.toThrow("invalid JSONC");
    expect(await readFile(file, "utf8")).toBe("{broken");
  });
});
