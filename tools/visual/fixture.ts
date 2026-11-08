import { buildApp } from "../../packages/app/src/build.js";
import { runTui } from "../../packages/app/src/tui.js";
import { ScriptedProvider } from "../../packages/core/src/provider.js";
const app = await buildApp({
  pluginDirs: [new URL('../../plugins',import.meta.url).pathname],
  cwd: process.argv[2], env: { HOME: process.argv[2], XDG_CONFIG_HOME: `${process.argv[2]}/xdg` },
  provider: new ScriptedProvider([
    { text: "I will update the project task list.", toolCalls: [{ name: "todo", args: { todos: [
      { content: "Inspect project", status: "completed" },
      { content: "Build interactive UI", status: "in_progress" },
      { content: "Verify drag and persistence", status: "pending" },
    ] } }], usage: { inputTokens: 1200, outputTokens: 140 } },
    { text: "## Todos updated\nThe interface is ready for **visual verification**.\n\nOpen `/todos` to see the task list." },
    { toolCalls: [{ name: "task", args: { prompt: "Inspect task status" } }] },
    { toolCalls: [{ name: "ask_user", args: { question: "Choose report detail", options: ["Compact", "Detailed"] } }] },
    { text: "Child inspection completed with the selected detail." },
    { text: "Delegation complete." },
    { toolCalls: [{name:"write",args:{path:"review-demo.txt",content:"A reviewable change\nWritten by the agent\n"}}] },
    { text: "Review change prepared." },
    { text: "Independent agent response" },
  ]),
});
await runTui(app, process.stdin, process.stdout);
