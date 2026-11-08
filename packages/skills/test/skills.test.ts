import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillRegistry, splitFrontmatter } from "../src/index.js";

let tmp: string;
let workspaceSkills: string;
let globalSkills: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-skills-"));
  workspaceSkills = path.join(tmp, "ws", "skills");
  globalSkills = path.join(tmp, "global", "skills");
  await fs.mkdir(path.join(workspaceSkills, "deploy"), { recursive: true });
  await fs.mkdir(path.join(globalSkills, "review-pr"), { recursive: true });
  await fs.mkdir(path.join(globalSkills, "deploy"), { recursive: true });

  await fs.writeFile(
    path.join(workspaceSkills, "deploy", "SKILL.md"),
    `---
name: deploy
description: Deploy the service to staging with canary checks
---
# Deploy

Run the deploy playbook step by step.
`,
  );
  await fs.writeFile(
    path.join(globalSkills, "review-pr", "SKILL.md"),
    `---
name: review-pr
description: Review a pull request for correctness and style
---
# Review

Check the diff, comment inline.
`,
  );
  // same name in a lower-priority source — must be shadowed by workspace
  await fs.writeFile(
    path.join(globalSkills, "deploy", "SKILL.md"),
    `---
name: deploy
description: GLOBAL deploy (shadowed)
---
# Global deploy
`,
  );
  // no description → invisible
  await fs.writeFile(path.join(globalSkills, "orphan.md"), "# no frontmatter here\n");
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const registry = () =>
  new SkillRegistry({
    sources: [
      { name: "workspace", dir: workspaceSkills },
      { name: "global", dir: globalSkills },
    ],
  });

describe("SkillRegistry", () => {
  it("lists compact descriptors from all sources; workspace shadows global by name", async () => {
    const all = await registry().list();
    const names = all.map((s) => s.name);
    expect(names).toEqual(["deploy", "review-pr"]); // orphan.md invisible
    const deploy = all.find((s) => s.name === "deploy")!;
    expect(deploy.description).toContain("canary"); // workspace won
    expect(deploy.source).toBe("workspace");
  });

  it("load() returns the full body on demand (progressive disclosure)", async () => {
    const detail = await registry().load("review-pr");
    expect(detail.body).toContain("# Review");
    expect(detail.frontmatter.description).toContain("Review a pull request");
    expect(detail.location.endsWith("SKILL.md")).toBe(true);
  });

  it("load() throws for unknown skills", async () => {
    await expect(registry().load("nope")).rejects.toThrow("skill not found");
  });

  it("search() scores name matches above description matches", async () => {
    const hits = await registry().search("deploy canary");
    expect(hits[0].name).toBe("deploy");
    const review = await registry().search("pull request");
    expect(review[0].name).toBe("review-pr");
  });

  it("renderIndex() produces a compact system-prompt block", async () => {
    const index = await registry().renderIndex();
    expect(index).toContain("Available skills");
    expect(index).toContain("- deploy:");
    expect(index).not.toContain("Run the deploy playbook"); // bodies stay off the index
  });

  it("missing directories are not an error", async () => {
    const reg = new SkillRegistry({ sources: [{ name: "ghost", dir: path.join(tmp, "nope") }] });
    expect(await reg.list()).toEqual([]);
  });
});

describe("splitFrontmatter", () => {
  it("parses simple key: value pairs", () => {
    const { frontmatter, body } = splitFrontmatter("---\nname: x\ndescription: y\n---\nBODY");
    expect(frontmatter).toEqual({ name: "x", description: "y" });
    expect(body).toBe("\nBODY");
  });

  it("passes through documents without frontmatter", () => {
    const { frontmatter, body } = splitFrontmatter("# Just markdown");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Just markdown");
  });
});
