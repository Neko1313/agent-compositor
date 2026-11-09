import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedProvider, replayTranscript } from "@agent-compositor/core";
import { hello, type WireMessage } from "@agent-compositor/protocol";
import { buildApp, type BuiltApp } from "../src/build.js";
import { AppUI } from "../src/ui.js";
const roots: string[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function setup(
  provider = new ScriptedProvider([{ text: "Continued the saved chat" }]),
) {
  const root = await mkdtemp(join(tmpdir(), "ac-history-"));
  roots.push(root);
  const app = await buildApp({ cwd: root, env: { HOME: root }, provider });
  const ui = new AppUI(
    app.createCore,
    undefined,
    [],
    app.commands,
    {},
    { resume: app.resume },
  );
  const messages = new Map<string, string>();
  let frames: Extract<WireMessage, { type: "layout" }>["frames"] = [];
  ui.connect((m) => {
    if (m.type === "render")
      messages.set(
        m.surface,
        m.grid?.map((r) => r.map((c) => c.ch).join("")).join("\n") ?? "",
      );
    if (m.type === "layout") frames = m.frames;
  });
  ui.receive(
    hello("renderer", {
      surfaces: ["terminal"],
      sites: [],
      elements: ["Text", "Layout"],
      encodings: ["jsonl"],
    }),
  );
  ui.resize(120, 40);
  cleanups.push(async () => {
    ui.close();
    await ui.settled();
    await app.close();
  });
  const input = (data: Extract<WireMessage, { type: "input" }>["data"]) =>
    ui.receive({ type: "input", surface: "input", data });
  return {
    app,
    ui,
    provider,
    messages,
    key: (key: string) => input({ kind: "key", key }),
    text: (text: string) => input({ kind: "text", text }),
    click: (label: string) => {
      const site = "plugin-session-manager-sessions";
      const row =
        messages
          .get(site)
          ?.split("\n")
          .findIndex((s) => s.includes(label)) ?? -1;
      expect(row).toBeGreaterThanOrEqual(0);
      const f = frames.find((f) => f.surface === site)!;
      input({
        kind: "mouse",
        action: "press",
        button: "left",
        row: f.y + 2 + row,
        col: f.x + 3,
      });
    },
  };
}
// The fixtures use the same cwd/root as the built application.
async function chat(
  app: BuiltApp,
  id: string,
  title: string,
  answer: string,
  archived = false,
) {
  const cwd = app.storage.paths.project;
  await app.store.create(cwd, { id, name: title });
  await app.store.append(
    id,
    [
      { type: "prompt.submit", text: `Investigate ${title}` },
      { type: "assistant.text", turnId: "old", text: answer },
      { type: "turn.complete", turnId: "old", text: answer },
    ],
    cwd,
  );
  if (archived) await app.store.archive(id, cwd);
}
describe("interactive chat history", () => {
  it.each(["/history", "/sessions", "/resume"])(
    "opens %s, searches without model calls and resumes the selected transcript",
    async (command) => {
      const { app, ui, messages, provider, text, key } = await setup();
      await chat(app, "old-auth", "Auth repair", "Saved authentication answer");
      await chat(app, "old-ui", "UI polish", "Saved UI answer");
      const previous = ui.core.sessionId;
      text(command);
      key("enter");
      await ui.settled();
      const saved = await app.store.load(previous, app.storage.paths.project);
      expect(
        saved.events.some((event) => event.type === "prompt.dropped"),
      ).toBe(true);
      expect(
        replayTranscript(saved.events).some((m) => m.content === command),
      ).toBe(false);
      expect(messages.get("plugin-session-manager-sessions")).toContain(
        "Auth repair",
      );
      text("Auth");
      await ui.settled();
      expect(messages.get("plugin-session-manager-sessions")).toContain(
        "1 chats",
      );
      expect(messages.get("plugin-session-manager-sessions")).toContain(
        "Saved authentication answer",
      );
      expect(provider.requests).toHaveLength(0);
      key("enter");
      await ui.settled();
      expect(ui.core.sessionId).toBe("old-auth");
      expect(ui.windows.focused).toBe("input");
      expect(ui.windows.has("plugin-session-manager-sessions")).toBe(false);
      text("Continue");
      key("enter");
      await ui.settled();
      expect(
        provider.requests[0].messages.some(
          (m) => m.content === "Saved authentication answer",
        ),
      ).toBe(true);
      expect(
        provider.requests[0].messages
          .filter((m) => m.role === "user")
          .map((m) => m.content),
      ).toEqual(["Investigate Auth repair", "Continue"]);
    },
  );
  it("handles mouse selection, no matches, archived filtering and Escape without switching", async () => {
    const { app, ui, messages, text, key, click } = await setup();
    await chat(app, "old-auth", "Auth repair", "Saved auth");
    await chat(app, "old-ui", "UI polish", "Saved UI");
    await chat(
      app,
      "old-archive",
      "Archived experiment",
      "Saved archive",
      true,
    );
    const before = ui.core.sessionId;
    text("/history");
    key("enter");
    await ui.settled();
    click("Auth repair");
    await ui.settled();
    expect(messages.get("plugin-session-manager-sessions")).toContain(
      "Agent: Saved auth",
    );
    text("nothing matches");
    await ui.settled();
    expect(messages.get("plugin-session-manager-sessions")).toContain(
      "No matching chats",
    );
    key("enter");
    await ui.settled();
    expect(ui.core.sessionId).toBe(before);
    for (let i = 0; i < "nothing matches".length; i++) key("backspace");
    await ui.settled();
    click("Archived: hidden");
    await ui.settled();
    expect(messages.get("plugin-session-manager-sessions")).toContain(
      "Archived experiment",
    );
    key("escape");
    await ui.settled();
    expect(ui.core.sessionId).toBe(before);
    expect(ui.windows.focused).toBe("input");
  });
  it("blocks stale selection during a live filter and preserves an unsent prompt on close", async () => {
    const { app, ui, messages, text, key, provider } = await setup();
    await chat(app, "old-auth", "Auth repair", "Saved auth");
    const before = ui.core.sessionId;
    text("Unsent prompt");
    await ui.core.host.emit("prompt.submit", { text: "/history" });
    text("Auth");
    key("enter");
    await ui.settled();
    expect(ui.core.sessionId).toBe(before);
    expect(messages.get("plugin-session-manager-sessions")).toContain(
      "History · 1 chats",
    );
    key("escape");
    await ui.settled();
    expect(messages.get("input")).toContain("Unsent prompt");
    expect(provider.requests).toHaveLength(0);
  });
  it("rejects switching during an active turn while allowing read-only history search", async () => {
    const provider = new ScriptedProvider([{ text: "Working", hold: true }]);
    const { app, ui, messages, text, key } = await setup(provider);
    await chat(app, "old-auth", "Auth repair", "Saved auth");
    const before = ui.core.sessionId;
    text("Hold this task");
    key("enter");
    await vi.waitFor(() => expect(provider.requests).toHaveLength(1));
    await ui.core.host.emit("prompt.submit", { text: "/history" });
    text("Auth");
    await vi.waitFor(() =>
      expect(messages.get("plugin-session-manager-sessions")).toContain(
        "History · 1 chats",
      ),
    );
    key("enter");
    await vi.waitFor(() =>
      expect(messages.get("session")?.replace(/\s+/g, " ")).toContain(
        "Wait until the current turn finishes",
      ),
    );
    expect(ui.core.sessionId).toBe(before);
    ui.core.interrupt();
    await ui.settled();
  });
  it("reports ambiguous IDs without losing the current chat", async () => {
    const { app, ui, messages, text, key } = await setup();
    await chat(app, "old-a", "One", "Answer");
    await chat(app, "old-b", "Two", "Answer");
    const before = ui.core.sessionId;
    text("/resume old-");
    key("enter");
    await ui.settled();
    expect(ui.core.sessionId).toBe(before);
    expect(messages.get("session")).toContain("Session not found or ambiguous");
  });
});
