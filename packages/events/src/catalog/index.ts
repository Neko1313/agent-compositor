import type { EventDef } from "../define.js";
import * as tools from "./tools.js";
import * as session from "./session.js";
import * as prompts from "./prompts.js";
import * as turnsAgents from "./turns-agents.js";
import * as ui from "./ui.js";
import * as services from "./services.js";
import * as coreServices from "./core-services.js";
import * as coreTurns from "./core-turns.js";
import * as coreContext from "./core-context.js";

/** The catalog: ordered, versioned, frozen. The single source of truth. */
export const catalog: readonly EventDef[] = [
  // session lifecycle first: composition is known before anything fires
  session.sessionStart,
  session.sessionReload,
  session.sessionEnd,
  session.sessionCompact,
  // prompts before tools: a turn starts with a prompt
  prompts.promptSubmit,
  prompts.promptCompose,
  prompts.skillPrompt,
  // tools
  tools.toolCall,
  tools.toolCheck,
  tools.toolDescribe,
  // turns and agents
  turnsAgents.turnStart,
  turnsAgents.turnStep,
  turnsAgents.turnComplete,
  turnsAgents.agentOffer,
  turnsAgents.agentSpawn,
  // core loop events
  coreTurns.promptSteer,
  coreTurns.promptQueued,
  coreTurns.assistantText,
  coreTurns.toolResult,
  coreTurns.turnFailed,
  coreTurns.turnInterrupted,
  coreContext.contextCompacted,
  // interface
  ui.uiRender,
  ui.uiPress,
  ui.uiFocus,
  ui.uiInvalidate,
  // $ API surface: each method is itself an event
  services.serviceFsRead,
  services.serviceFsWrite,
  services.serviceExecRun,
  services.serviceModelComplete,
  services.serviceAuthLogin,
  services.serviceUiNotify,
  services.serviceTelemetryLog,
  // core-tool services (model-facing tools; same interception story as $ API)
  coreServices.serviceShellExec,
  coreServices.serviceFileRead,
  coreServices.serviceFileReadText,
  coreServices.serviceFileWrite,
  coreServices.serviceFileEdit,
];

export { namespaceOf } from "../define.js";
export type { EventDef, ResponseDef } from "../define.js";
export { defineEvent } from "../define.js";
