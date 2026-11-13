import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceAccess } from "@agent-compositor/tools";
import { activeReference, expandReferences, projectInstructions, referenceFiles } from "../src/project-context.js";

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
  it('frames and marks bounded previews instead of silently cutting file blocks',async()=>{
    const f=await fixture();await writeFile(join(f.primary,'one.txt'),'a'.repeat(80000));await writeFile(join(f.primary,'two.txt'),'b'.repeat(80000));
    const prompt='Compare @one.txt with @two.txt',result=await expandReferences(f.primary,prompt,f.options);
    expect(Buffer.byteLength(result.text.slice(prompt.length),'utf8')).toBeLessThanOrEqual(16000);
    expect(result.text.match(/<file path=/g)).toHaveLength(2);expect(result.text.match(/<\/file>/g)).toHaveLength(2);
    expect(result.text).toContain('Preview truncated');expect(result.text).toContain('Native read arguments');expect(result.text.startsWith(prompt)).toBe(true);
  });
  it('keeps preview Unicode intact under a smaller byte budget',async()=>{
    const f=await fixture();await writeFile(join(f.primary,'unicode.txt'),'👻中'.repeat(10000));
    const prompt='Inspect @unicode.txt',result=await expandReferences(f.primary,prompt,{...f.options,maxBytes:1024});
    expect(Buffer.byteLength(result.text.slice(prompt.length),'utf8')).toBeLessThanOrEqual(1024);expect(Buffer.from(result.text).toString('utf8')).toBe(result.text);
    expect(result.text).toContain('</file>');expect(result.text).toContain('Preview truncated');
  });
  it('rejects oversized combined instructions rather than dropping their tail',async()=>{
    const f=await fixture();await writeFile(join(f.primary,'AGENTS.md'),'A'.repeat(70000));await writeFile(join(f.primary,'CLAUDE.md'),'B'.repeat(70000)+'\nDO_NOT_RUN_CI');
    await expect(projectInstructions(f.primary)).rejects.toThrow(/instruction.*limit/i);
  });
  it.each([Buffer.from([0,1]),Buffer.from([0xff,0xfe])])('rejects invalid instruction text %j',async bytes=>{
    const f=await fixture();await writeFile(join(f.primary,'AGENTS.md'),bytes);
    await expect(projectInstructions(f.primary)).rejects.toThrow(/instruction.*UTF-8/i);
  });
  it("defers references after the 64th before granting access", async () => {
    const f = await fixture();
    const first = join(f.primary, "small.txt"), deferred = join(f.other, "separate.txt");
    await writeFile(first, "one");
    await writeFile(deferred, "outside");
    const attach = vi.fn(f.options.attach);
    const prompt = "@small.txt ".repeat(64) + "@" + JSON.stringify(deferred);
    const result = await expandReferences(f.primary, prompt, { ...f.options, attach });
    expect(attach).toHaveBeenCalledTimes(64);
    expect(result.text).toContain("Only the first 64 references were processed");
    expect(result.text).not.toContain("outside");
    await expect(f.workspace.resolve(deferred)).rejects.toThrow();
  });

  it("bounds combined raw image bytes and still processes later text", async () => {
    const f = await fixture();
    await writeFile(join(f.primary, "image.png"), Buffer.alloc(9 * 1024 * 1024));
    await writeFile(join(f.primary, "tail.txt"), "TEXT_AFTER_IMAGES");
    const result = await expandReferences(f.primary, "@image.png ".repeat(4) + "@tail.txt", f.options);
    expect(result.images).toHaveLength(3);
    expect(result.text).toContain("Attached images exceed 32 MiB combined");
    expect(result.text).toContain("TEXT_AFTER_IMAGES");
  });

  it("loads all applicable rules even for images and unpreviewed data", async () => {
    const f = await fixture();
    const parent = join(f.primary, "nested"), child = join(parent, "deeper");
    await mkdir(child, { recursive: true });
    const rules = "x".repeat(17_000) + "\nKEEP_THE_FINAL_RULE";
    await writeFile(join(parent, "AGENTS.md"), rules);
    await writeFile(join(child, "photo.png"), "image");
    await writeFile(join(child, "large.txt"), "x".repeat(120_001));
    for (const path of ["photo.png", "large.txt", "."]) {
      const result = await expandReferences(f.primary, "@nested/deeper/" + path, f.options);
      expect(result.text).toContain(rules);
    }
    await writeFile(join(child, "CLAUDE.md"), "y".repeat(105_000));
    await expect(expandReferences(f.primary, "@nested/deeper/photo.png", f.options)).rejects.toThrow(/instruction.*limit/i);
  });

  it("stops preparation when scoped instructions disappear, escape or are denied", async () => {
    const f = await fixture(), path = join(f.primary, "AGENTS.md");
    await symlink(join(f.other, "rules.md"), path);
    await expect(expandReferences(f.primary, "@.", f.options)).rejects.toThrow(/project instructions/i);
    await writeFile(join(f.other, "rules.md"), "EXTERNAL_RULE");
    await expect(expandReferences(f.primary, "@.", f.options)).rejects.toThrow(/escapes/i);
    await rm(path);
    await writeFile(path, "PRIVATE_RULE");
    await expect(expandReferences(f.primary, "@.", { ...f.options, authorize: async target => {
      if (target === path) throw new Error("denied");
    } })).rejects.toThrow(/denied/);
  });
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
