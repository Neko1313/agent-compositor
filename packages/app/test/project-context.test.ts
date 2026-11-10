import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceAccess } from "@agent-compositor/tools";
import { activeReference, expandReferences, referenceFiles } from "../src/project-context.js";

const temporary: string[] = [];
afterEach(async () => { for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "reference-boundaries-"))); temporary.push(root);
  const primary = join(root, "primary"), other = join(root, "other project");
  await mkdir(primary); await mkdir(other);
  const workspace = new WorkspaceAccess(primary, root);
  return { root, primary, other, workspace, options: { workspace, attach: (path: string) => workspace.add(path) } };
}

describe("reference parsing and context limits", () => {
  it("supports escaped quotes and single-quoted paths without reading neighboring instructions", async () => {
    const f = await fixture(), name = 'a "quoted" file.txt', file = join(f.other, name);
    await writeFile(file, "QUOTED_FILE_EVIDENCE");
    await writeFile(join(f.other, "single.txt"), "SINGLE_QUOTED_EVIDENCE");
    await writeFile(join(f.other, "AGENTS.md"), "NEIGHBOR_RULES_MUST_NOT_LOAD");
    const prompt = `Read @${JSON.stringify(`~/other project/${name}`)} and @'~/other project/single.txt'`;
    const expanded = await expandReferences(f.primary, prompt, f.options);
    expect(expanded.text).toContain("QUOTED_FILE_EVIDENCE"); expect(expanded.text).toContain("SINGLE_QUOTED_EVIDENCE");
    expect(expanded.text).not.toContain("NEIGHBOR_RULES_MUST_NOT_LOAD");
  });

  it("does not expand email addresses or references embedded in another token", async () => {
    const f = await fixture(), attach = vi.fn(f.options.attach);
    const prompt = "Send to person@example.com, literal-prefix@~/other, and no files.";
    expect((await expandReferences(f.primary, prompt, { ...f.options, attach })).text).toBe(prompt);
    expect(attach).not.toHaveBeenCalled(); expect(activeReference("person@example.com")).toBeUndefined();
  });

  it("preserves user text and bounds combined attachments instead of truncating the original prompt", async () => {
    const f = await fixture();
    await writeFile(join(f.primary, "one.txt"), "a".repeat(80_000)); await writeFile(join(f.primary, "two.txt"), "b".repeat(80_000));
    const prompt = "Compare @one.txt with @two.txt", expanded = await expandReferences(f.primary, prompt, f.options);
    expect(expanded.text.startsWith(prompt)).toBe(true); expect(expanded.text.length).toBeLessThanOrEqual(120_000);
    const longPrompt = "x".repeat(120_001) + " @one.txt", attach = vi.fn(f.options.attach);
    expect((await expandReferences(f.primary, longPrompt, { ...f.options, attach })).text).toBe(longPrompt);
    expect(attach).not.toHaveBeenCalled();
  });

  it("reports missing, oversized and binary files while continuing valid references", async () => {
    const f = await fixture();
    await writeFile(join(f.primary, "large.txt"), "x".repeat(120_001));
    await writeFile(join(f.primary, "binary.bin"), Buffer.from([0, 1, 2]));
    await writeFile(join(f.primary, "valid.txt"), "VALID_LAST_REFERENCE");
    const expanded = await expandReferences(f.primary, "Inspect @missing @large.txt @binary.bin @valid.txt", f.options);
    expect(expanded.text).toContain("Reference @missing:"); expect(expanded.text).toContain("File exceeds");
    expect(expanded.text).toContain("Binary file"); expect(expanded.text).toContain("VALID_LAST_REFERENCE");
  });

  it("keeps image bytes separate from prompt text and checks image limits", async () => {
    const f = await fixture(), bytes = Buffer.from([137, 80, 78, 71]);
    await writeFile(join(f.primary, "image.png"), bytes);
    await writeFile(join(f.primary, "large.png"), Buffer.alloc(10 * 1024 * 1024 + 1));
    const expanded = await expandReferences(f.primary, "Inspect @image.png @large.png", f.options);
    expect(expanded.images).toEqual([{ mimeType: "image/png", data: bytes.toString("base64") }]);
    expect(expanded.text).toContain("Image exceeds 10MB"); expect(expanded.text).not.toContain(bytes.toString("base64"));
  });

  it("cancels before a grant and during authorization instead of returning stale attachment data", async () => {
    const f = await fixture(); await writeFile(join(f.primary, "file.txt"), "MUST_NOT_RETURN");
    const before = new AbortController(); before.abort(new Error("cancelled before preparation"));
    const attach = vi.fn(f.options.attach);
    await expect(expandReferences(f.primary, "Read @file.txt", { ...f.options, attach, signal: before.signal })).rejects.toThrow("cancelled before");
    expect(attach).not.toHaveBeenCalled();
    const during = new AbortController();
    await expect(expandReferences(f.primary, "Read @file.txt", { ...f.options, signal: during.signal,
      authorize: async () => { during.abort(new Error("cancelled during authorization")); },
    })).rejects.toThrow("cancelled during authorization");
  });

  it("caps directory listings, respects ignored files and keeps completions free of grants", async () => {
    const f = await fixture();
    await Promise.all(Array.from({ length: 205 }, (_, i) => writeFile(join(f.other, `file-${String(i).padStart(3, "0")}.txt`), "data")));
    await writeFile(join(f.other, ".gitignore"), "hidden.txt\n"); await writeFile(join(f.other, "hidden.txt"), "hidden");
    expect(await referenceFiles(f.workspace, "~/absent/")).toEqual([]);
    const completions = await referenceFiles(f.workspace, "~/other project/file-");
    expect(completions).toHaveLength(200); expect(f.workspace.list()).toHaveLength(1);
    const expanded = await expandReferences(f.primary, 'List @"~/other project"', f.options);
    expect(expanded.text).toContain("Listing truncated at 200 files"); expect(expanded.text).not.toContain("hidden.txt");
  });

  it("locates quoted completion ranges and consumes an existing closing quote", () => {
    const text = 'Read @"~/other project/file.txt" after';
    const cursor = text.indexOf('" after');
    expect(activeReference(text, cursor)).toEqual({ prefix: "~/other project/file.txt", start: 5, end: cursor + 1 });
    expect(activeReference('Read @"~/a\\"b')).toMatchObject({ prefix: '~/a"b', start: 5 });
    expect(activeReference("Read @'~/other project/fi")).toMatchObject({ prefix: "~/other project/fi", start: 5 });
  });
});
