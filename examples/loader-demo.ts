/**
 * Plugins from disk, end to end: discovery → load → run → edit → reload.
 *
 *   npm run example:loader
 *
 * The demo copies examples/plugins-disk into a temp dir (so the repo never
 * gets dirtied), loads the plugins through the loader, then rewrites the
 * safety plugin's source on disk and hot-reloads it — proving reload sees
 * new code. stdout: narrative + results; stderr: chain trace JSONL.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Runtime, jsonlTraceSink } from "@agent-compositor/runtime";
import { attach } from "@agent-compositor/hooks";
import { PluginLoader } from "@agent-compositor/loader";

const here = fileURLToPath(new URL(".", import.meta.url));
const stage = mkdtempSync(join(tmpdir(), "ac-loader-demo-"));
cpSync(join(here, "plugins-disk"), stage, { recursive: true });

const runtime = new Runtime({ trace: jsonlTraceSink(process.stderr) });
const host = attach(runtime, {
  session: { id: "demo", cwd: stage },
  notify: (message, level, plugin) =>
    console.log(`  [notify:${level}] ${plugin}: ${message}`),
});

const emitOne = async (event: string, input: unknown) => {
  const gen = runtime.emit(event, input);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const step = await gen.next();
    if (step.done) return step.value as { value: unknown; faults: unknown[] };
  }
};

try {
  console.log(`plugin dir (temp copy): ${stage}`);
  const loader = new PluginLoader(host, { dirs: [stage] });

  // 1. discover + load everything on disk
  const report = await loader.loadAll();
  console.log("\n== loadAll ==");
  for (const p of report.loaded)
    console.log(`  loaded ${p.name}@${p.version} trust=${p.trust} tier=${p.tier} hooks=${p.hookCount}`);
  for (const f of report.failed) console.log(`  FAILED ${f.name ?? f.path}: ${f.reason}`);
  for (const s of report.skipped) console.log(`  skipped ${s.name}: ${s.reason}`);

  // 2. composition → the session.start "udev moment"
  console.log("\n== session.start with composition ==");
  console.log(" ", JSON.stringify(loader.composition()));
  await emitOne("session.start", { sessionId: "demo", cwd: stage, plugins: loader.composition() });

  // 3. loaded hooks run in the chain
  console.log("\n== tool.check: rm -rf / ==");
  const denied = await emitOne("tool.check", { tool: "Bash", input: { command: "rm -rf /" }, callId: "c1" });
  console.log(" ", JSON.stringify(denied.value));

  console.log("\n== tool.check: ls -la ==");
  const allowed = await emitOne("tool.check", { tool: "Bash", input: { command: "ls -la" }, callId: "c2" });
  console.log(" ", JSON.stringify(allowed.value));

  console.log("\n== ui.render via render-only plugin ==");
  const ui = await emitOne("ui.render", { site: "status", surface: "headless", props: { model: "demo", turns: 1 } });
  console.log(" ", JSON.stringify((ui.value as { tree: unknown }).tree));

  // 4. edit the plugin on disk, hot-reload
  console.log("\n== editing safety/index.ts on disk + reload ==");
  writeFileSync(
    join(stage, "safety", "index.ts"),
    `export const hooks = {
  "tool.check": (e) => {
    if (e.tool === "Bash" && e.input?.command?.includes("rm -rf /")) {
      return { decision: "deny", reason: "refusing to rm -rf /" };
    }
    if (e.tool === "Bash" && e.input?.command?.startsWith("sudo")) {
      return { decision: "ask", reason: "sudo needs confirmation now" };
    }
    return undefined;
  },
  "session.reload": (_e, $) => {
    void $.ui.notify?.("safety reloaded", "info");
    return undefined;
  },
};`,
  );
  const reloaded = await loader.reload("safety");
  console.log(`  reloaded ${reloaded.name}@${reloaded.version} hooks=${reloaded.hookCount}`);
  await emitOne("session.reload", { plugins: loader.composition() });

  const sudo = await emitOne("tool.check", { tool: "Bash", input: { command: "sudo apt upgrade" }, callId: "c3" });
  console.log(" ", JSON.stringify(sudo.value));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
