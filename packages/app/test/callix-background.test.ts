import { describe, it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/build.js";
import { ScriptedProvider } from "@agent-compositor/core";
const dirs: string[] = [],
  apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function poll(test: () => Promise<boolean>) {
  const until = Date.now() + 5000;
  while (Date.now() < until) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw Error("Index did not refresh");
}
describe("persistent reactive project index", () => {
  it("warms a native CLI index, refreshes external edits and reuses disk state after restart", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "callix-background-"));
    dirs.push(cwd);
    const home = join(cwd, "home");
    await mkdir(home);
    await mkdir(join(cwd, ".agent-compositor"));
    const binary = join(cwd, ".agent-compositor/fake-callix");
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');const root=process.argv[3],file=path.join(root,'.agent-compositor/count');let count=0;try{count=Number(fs.readFileSync(file))}catch{}fs.writeFileSync(file,String(count+1));const name=fs.readFileSync(path.join(root,'source.ts'),'utf8').trim();console.log(JSON.stringify({schema_version:1,nodes:[{id:name,name,qualified_name:name,kind:'function'}],relations:[],metadata:{}}));`
    );
    await chmod(binary, 0o755);
    await writeFile(join(cwd, "source.ts"), "alpha");
    await writeFile(
      join(cwd, ".agent-compositor/callix.json"),
      JSON.stringify({ executable: binary, debounceMs: 100 })
    );
    const create = () =>
      buildApp({
        cwd,
        env: { HOME: home },
        agentHub: false,
        provider: new ScriptedProvider([]),
        pluginDirs: [join(process.cwd(), "plugins/callix")],
      });
    const app = await create();
    apps.push(app);
    const core = app.createCore(async () => true);
    const signals: any[] = [];
    core.host.registerPlugin(
      { name: "observer", version: "1.0.0", trust: "trusted" },
      {
        "project.changed": (e) => {
          signals.push(e);
        },
      }
    );
    await core.start();
    const index = join(app.storage.paths.state, "cache/callix/index.json");
    await poll(async () => !!(await readFile(index, "utf8").catch(() => "")));
    await writeFile(join(cwd, "source.ts"), "beta");
    await poll(async () => (await readFile(index, "utf8")).includes("beta"));
    expect(signals.length).toBeGreaterThan(0);
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const count = await readFile(join(cwd, ".agent-compositor/count"), "utf8");
    const next = await create();
    apps.push(next);
    const second = next.createCore(async () => true);
    const result = await second.host.emit("service.project.query", {
      cwd,
      action: "symbols",
      pattern: "beta",
    });
    expect(JSON.stringify(result.value)).toContain("beta");
    expect(await readFile(join(cwd, ".agent-compositor/count"), "utf8")).toBe(
      count
    );
  });
});
