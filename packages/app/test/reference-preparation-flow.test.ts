import { afterEach, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedProvider, type CompletionRequest, type ModelProvider, type ProviderEvent } from "@agent-compositor/core";
import { buildApp, type BuiltApp } from "../src/build.js";

const roots: string[] = [], apps: BuiltApp[] = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "reference-flow-")));
  roots.push(root);
  const cwd = join(root, "project"), home = join(root, "home");
  await mkdir(cwd);
  await mkdir(home);
  await writeFile(join(cwd, "agent-compositor.json"), JSON.stringify({
    enabledPlugins: [],
    agent: { skills: false },
    permissions: { rules: [{ tool: "read", path: "/**/dense file.txt", decision: "ask" }] },
  }));
  return { cwd, home };
}

async function build(cwd: string, home: string, provider: ModelProvider) {
  const app = await buildApp({ cwd, env: { HOME: home }, provider, pluginDirs: [], agentHub: false });
  apps.push(app);
  return app;
}

it.each([true, false])("checks read permission again after a truncated preview (allow read: %s)", async allowRead => {
  const { cwd, home } = await fixture();
  const path = join(home, "dense file.txt"), prompt = 'Inspect @"~/dense file.txt"';
  const original = "Preface\n" + "🌊海".repeat(6_000) + "\nOriginal ending";
  const updated = "Fresh disk content visible only through an authorized read.";
  await writeFile(path, original);

  const requests: CompletionRequest[] = [];
  const provider: ModelProvider = {
    name: "reference-handoff",
    async *complete(request): AsyncIterable<ProviderEvent> {
      requests.push(request);
      if (requests.length === 1) {
        const prepared = request.messages.find(message => message.role === "user")!.content;
        expect(prepared.startsWith(prompt + "\n")).toBe(true);
        expect(Buffer.byteLength(prepared.slice(prompt.length))).toBeLessThanOrEqual(16_000);
        const fileBlock = /<file path=([^\n]+)>\n([\s\S]*?)\n\[Preview truncated\. Native read arguments: ([^\n]+)\]\n<\/file>/.exec(prepared);
        expect(fileBlock).not.toBeNull();
        const [, quotedPath, preview, readArgs] = fileBlock!;
        expect(JSON.parse(quotedPath)).toBe(path);
        expect(preview.startsWith("Preface\n")).toBe(true);
        expect(original.startsWith(preview)).toBe(true);
        expect(Buffer.from(preview).toString("utf8")).toBe(preview);
        expect(prepared).not.toContain("Original ending");
        await writeFile(path, updated);
        yield { type: "tool_call", id: "read-handoff", name: "read", args: JSON.parse(readArgs) };
        yield { type: "finish", reason: "tool_calls" };
      } else {
        yield { type: "text_delta", text: "Inspection finished." };
        yield { type: "finish", reason: "stop" };
      }
    },
  };
  const app = await build(cwd, home, provider);
  const approvals: string[] = [];
  const core = app.createCore(async request => {
    approvals.push(request.descriptor.path!);
    return approvals.length === 1 || allowRead;
  });
  await core.submit(prompt);
  expect(core.failure).toBeUndefined();
  expect(approvals).toEqual([path, path]);
  expect(requests).toHaveLength(2);
  const result = requests[1].messages.find(message => message.toolCallId === "read-handoff")!.content;
  if (allowRead) expect(result.split("\n\nFile content (verbatim):\n")[1]).toBe(updated);
  else {
    expect(result).toContain("Permission denied");
    expect(result).not.toContain(updated);
  }
});

it.each([
  { name: "malformed UTF-8", data: Buffer.from([0xff]), error: /UTF-8/i },
  { name: "an oversized instruction", data: "A".repeat(120_001), error: /limit|exceed/i },
])("stops before the model when scoped instructions contain $name", async ({ data, error }) => {
  const { cwd, home } = await fixture();
  const scope = join(cwd, "component");
  await mkdir(scope);
  await writeFile(join(scope, "AGENTS.md"), data);
  await writeFile(join(scope, "notes.txt"), "This submission must never reach the model.");
  const provider = new ScriptedProvider([{ text: "Unexpected dispatch." }]);
  const app = await build(cwd, home, provider);
  const core = app.createCore(async () => true);
  await core.submit("Inspect @component/notes.txt");
  expect(core.failure).toMatch(error);
  expect(provider.requests).toHaveLength(0);
  expect(core.getMessages().some(message => message.role === "user")).toBe(false);
});
