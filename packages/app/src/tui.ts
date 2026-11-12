import { referenceFiles } from "./project-context.js";
import { editDraft } from "./editor.js";
import { runInkRenderer } from "@agent-compositor/renderer-ink";
import type { WireMessage } from "@agent-compositor/protocol";
import { AppUI } from "./ui.js";
import type { BuiltApp } from "./build.js";

export async function runTui(app: BuiltApp, stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream, startupCommand?:string): Promise<void> {
  const queue: WireMessage[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  let renderer: Awaited<ReturnType<typeof runInkRenderer>>;
  const ui: AppUI = new AppUI(app.createCore, app.reloadPlugins, [
    ...app.pluginErrors.map(e => `Plugin error: ${e.error}`), ...app.config.warnings,
  ], app.commands, app.config.config.ui, { save: app.savePlacement, resume: app.resume, saveLayout: app.saveLayout, files: prefix => referenceFiles(ui.core.workspace,prefix), edit: draft => editDraft(draft, callback => renderer.runExternal(callback)) });
  const source = (async function* () {
    while (!ended || queue.length) {
      if (!queue.length) await new Promise<void>(resolve => { wake = resolve; });
      while (queue.length) yield queue.shift()!;
    }
  })();
  ui.connect(message => { queue.push(message); if (message.type === "bye") ended = true; wake?.(); wake = undefined; });
  await ui.core.start();
  try { ui.restoreLayout(await app.loadLayout()); } catch (error) { await ui.core.host.emit("service.ui.notify", { plugin: "layout", message: `Could not restore windows: ${String(error)}`, level: "warn" }); }
  if(!startupCommand&&await app.shouldOfferSetup?.())startupCommand='/setup';
  if(startupCommand)await ui.core.submit(startupCommand);
  const resize = () => ui.resize(stdout.columns ?? 80, stdout.rows ?? 24);
  resize(); stdout.on("resize", resize);
  try {
    renderer = await runInkRenderer({ source, send: message => ui.receive(message), stdin, stdout,
      hostControlsExit: true, exit: () => {} });
    await renderer.waitUntilExit;
  } finally {
    stdout.off("resize", resize); ui.close(); await app.close(); await ui.settled();
  }
}
