import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, discover, substitute } from "../src/index.js";

let tmp: string;
let cwd: string;
let xdg: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ac-config-"));
  cwd = path.join(tmp, "repo");
  xdg = path.join(tmp, "xdg");
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(xdg, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const env = () => ({ XDG_CONFIG_HOME: xdg, TEST_SECRET: "s3cr3t-value" } as NodeJS.ProcessEnv);
const opts = (over: Record<string, unknown> = {}) => ({ cwd, env: env(), system: false, ...over });

async function writeConfig(dir: string, content: string, name = "agent-compositor.json") {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), content);
}

describe("discovery", () => {
  it("finds project config at cwd", async () => {
    await writeConfig(cwd, "{}");
    const sources = await discover(opts());
    const present = sources.filter((s) => s.present);
    expect(present).toHaveLength(1);
    expect(present[0].layer).toBe("project");
  });

  it("walks ancestors so a monorepo contributes from every level, closest last", async () => {
    const leaf = path.join(cwd, "packages/leaf");
    await fs.mkdir(leaf, { recursive: true });
    await writeConfig(cwd, "{}");
    await writeConfig(path.join(cwd, "packages"), "{}");
    const sources = await discover(opts({ cwd: leaf }));
    const project = sources.filter((s) => s.layer === "project" && s.present);
    expect(project).toHaveLength(2);
    expect(project[0].path).toBe(path.join(cwd, "agent-compositor.json")); // farthest first
    expect(project[1].path).toBe(path.join(cwd, "packages", "agent-compositor.json")); // closest last
  });

  it("finds config inside .agent-compositor/ project dirs", async () => {
    await writeConfig(path.join(cwd, ".agent-compositor"), "{}");
    const sources = await discover(opts());
    expect(sources.some((s) => s.present && s.path.includes(".agent-compositor"))).toBe(true);
  });

  it("does not re-enter the global root through the project walk", async () => {
    const globalDir = path.join(xdg, "agent-compositor");
    await writeConfig(globalDir, "{}");
    const inside = path.join(globalDir, "sub");
    await fs.mkdir(inside, { recursive: true });
    await writeConfig(inside, "{}");
    const sources = await discover(opts({ cwd: inside }));
    const project = sources.filter((s) => s.layer === "project" && s.present);
    expect(project.some((s) => s.path.startsWith(globalDir))).toBe(false);
  });
});

describe("merge precedence", () => {
  it("project overrides global, global overrides defaults — per key, deep", async () => {
    await writeConfig(path.join(xdg, "agent-compositor"), JSON.stringify({
      model: "global-model",
      agent: { max_steps: 10, verbose: false },
      plugins: ["global-plugin"],
    }));
    await writeConfig(cwd, JSON.stringify({
      model: "project-model",
      agent: { verbose: true },
      plugins: ["project-plugin"],
    }));
    const loaded = await loadConfig(opts());
    expect(loaded.config.model).toBe("project-model");
    expect(loaded.config.agent).toEqual({ max_steps: 10, verbose: true }); // deep: project wins per key
    expect(loaded.config.plugins).toEqual(["project-plugin"]); // arrays replace
  });

  it("arrays are replaced, not concatenated", async () => {
    await writeConfig(cwd, JSON.stringify({ plugins: ["a", "b"] }));
    const loaded = await loadConfig(opts());
    expect(loaded.config.plugins).toEqual(["a", "b"]);
  });

  it("unknown keys pass through for forward compatibility", async () => {
    await writeConfig(cwd, JSON.stringify({ future_subsystem: { flag: true } }));
    const loaded = await loadConfig(opts());
    expect(loaded.config.future_subsystem).toEqual({ flag: true });
  });

  it("records per-key origins with the winning source", async () => {
    await writeConfig(path.join(xdg, "agent-compositor"), JSON.stringify({ model: "global-model" }));
    await writeConfig(cwd, JSON.stringify({ model: "project-model" }));
    const loaded = await loadConfig(opts());
    const origin = loaded.origins.filter((o) => o.key === "model").at(-1);
    expect(origin?.source).toContain(cwd);
    expect(origin?.layer).toBe("project");
  });
});

describe("substitutions", () => {
  it("substitutes {env:VAR}", async () => {
    await writeConfig(cwd, JSON.stringify({ providers: { demo: { api_key: "{env:TEST_SECRET}" } } }));
    const loaded = await loadConfig(opts());
    expect((loaded.config.providers as Record<string, Record<string, string>>).demo.api_key).toBe("s3cr3t-value");
  });

  it("substitutes {file:path} relative to the config dir", async () => {
    await fs.writeFile(path.join(cwd, "key.pem"), "  PEM-BODY\n");
    await writeConfig(cwd, JSON.stringify({ providers: { demo: { api_key: "{file:./key.pem}" } } }));
    const loaded = await loadConfig(opts());
    expect((loaded.config.providers as Record<string, Record<string, string>>).demo.api_key).toBe("PEM-BODY");
  });

  it("missing env var becomes empty string with a warning, load survives", async () => {
    await writeConfig(cwd, JSON.stringify({ providers: { demo: { api_key: "{env:NOPE_MISSING}" } } }));
    const loaded = await loadConfig(opts());
    expect((loaded.config.providers as Record<string, Record<string, string>>).demo.api_key).toBe("");
    expect(loaded.warnings.some((w) => w.includes("NOPE_MISSING"))).toBe(true);
  });

  it("tokens inside comments are left alone", async () => {
    await writeConfig(
      cwd,
      `{
  // api_key: "{env:TEST_SECRET}" stays textual
  "model": "m"
}`,
    );
    const loaded = await loadConfig(opts());
    expect(loaded.config.model).toBe("m");
  });

  it("marks substituted keys as sensitive in origins", async () => {
    await writeConfig(cwd, JSON.stringify({ providers: { demo: { api_key: "{env:TEST_SECRET}" } } }));
    const loaded = await loadConfig(opts());
    expect(loaded.origins.some((o) => o.key === "providers.demo.api_key" && o.sensitive)).toBe(true);
    expect(loaded.origins.some((o) => o.key === "providers" && o.sensitive)).toBe(false);
  });

  it("values with quotes/backslashes stay parseable", async () => {
    const { text } = await substitute({
      text: JSON.stringify({ p: "{env:TRICKY}" }),
      configDir: cwd,
      source: "test",
      env: { TRICKY: 'a"b\\c\nd' },
    });
    expect(JSON.parse(text).p).toBe('a"b\\c\nd');
  });
});

describe("parsing", () => {
  it("accepts JSONC: comments and trailing commas", async () => {
    await writeConfig(
      cwd,
      `{
  // chosen model
  "model": "jsonc-model",
  "plugins": ["a",],
}`,
    );
    const loaded = await loadConfig(opts());
    expect(loaded.config.model).toBe("jsonc-model");
    expect(loaded.warnings).toHaveLength(0);
  });

  it("malformed file is skipped with a warning, other layers survive", async () => {
    await writeConfig(cwd, "{ not json");
    const loaded = await loadConfig(opts());
    expect(loaded.warnings.some((w) => w.includes("rejected"))).toBe(true);
  });

  it("reports substitution records", async () => {
    await writeConfig(cwd, JSON.stringify({ providers: { demo: { api_key: "{env:TEST_SECRET}" } } }));
    const loaded = await loadConfig(opts());
    expect(loaded.substitutions).toHaveLength(1);
    expect(loaded.substitutions[0]).toMatchObject({ kind: "env", reference: "TEST_SECRET", missing: false });
  });
});
