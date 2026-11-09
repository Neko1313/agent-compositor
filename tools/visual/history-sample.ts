import { SessionStore } from "../../packages/session/src/store.js";
import { storagePaths } from "../../packages/config/src/storage.js";
export async function seedHistory(cwd: string) {
  let tick = Date.now() - 86400000;
  const store = new SessionStore({
    sessionsRoot: storagePaths(cwd, { HOME: cwd }).sessions,
    now: () => (tick += 60000),
  });
  for (let i = 0; i < 10; i++) {
    const id = i === 0 ? "history-auth" : `history-${i}`;
    await store.create(cwd, {
      id,
      name: i === 0 ? "Authentication repair" : `UI investigation ${i}`,
    });
    await store.append(
      id,
      [
        {
          type: "prompt.submit",
          text:
            i === 0 ? "Inspect login regression" : `Investigate component ${i}`,
        },
        {
          type: "assistant.text",
          turnId: "fixture",
          text:
            i === 0 ? "Trace the legacy callback marker" : "Saved UI evidence",
        },
        {
          type: "turn.complete",
          turnId: "fixture",
          text:
            i === 0 ? "Trace the legacy callback marker" : "Saved UI evidence",
        },
        { type: "prompt.submit", text: "Add regression tests" },
        {
          type: "assistant.text",
          turnId: "fixture-next",
          text: i === 0 ? "Login behavior verified" : "UI behavior verified",
        },
        {
          type: "turn.complete",
          turnId: "fixture-next",
          text: i === 0 ? "Login behavior verified" : "UI behavior verified",
        },
      ],
      cwd,
    );
  }
  await store.create(cwd, {
    id: "history-archived",
    name: "Archived experiment",
  });
  await store.append(
    "history-archived",
    [{ type: "prompt.submit", text: "Archived task" }],
    cwd,
  );
  await store.archive("history-archived", cwd);
}
export function historyReply(messages: any[]) {
  const users = messages.filter((m) => m.role === "user");
  return `History continued: ${users.at(-1)?.content}. Earlier task: ${users[0]?.content}.`;
}
