import * as storage from "./storage.js";
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
import * as customization from "./customization.js";

/** The catalog: ordered, versioned, frozen. The single source of truth. */
export const catalog: readonly EventDef[] = [
  ...Object.values(customization),
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
  coreTurns.turnUsage,
  coreTurns.subagentStart,
  coreTurns.subagentComplete,
  coreContext.contextCompacted,
  coreContext.contextCompacting,
  coreContext.contextPressure,
  coreContext.modelCapabilities,
  coreContext.agentInstructions,
  coreContext.agentFinish,
  // interface
  ui.uiConfigure,
  storage.storageRead,
  storage.storageWrite,
  storage.storageConfig,
  ui.projectChanged,
  ui.networkConfigure,
  ui.uiVisibility,
  ui.uiReaction,
  ui.uiRemove,
  ui.agentActivity,
  ui.uiInputTarget,
  ui.uiView,
  ui.agentTool,
  ui.uiSurface,
  ui.uiRender,
  ui.uiPress,
  ui.uiChange,
  ui.uiFocus,
  ui.uiInvalidate,
  // $ API surface: each method is itself an event
  services.serviceFsRead,
  services.serviceFsWrite,
  services.serviceExecRun,
  services.serviceModelComplete,
  services.serviceAuthLogin,
  services.serviceUiAsk,
  services.serviceUiQuestionnaire,
  services.serviceUiNotify,
  services.serviceTelemetryLog,
  // core-tool services (model-facing tools; same interception story as $ API)
  coreServices.serviceSkillsLoad,
  coreServices.serviceProjectQuery,
  coreServices.serviceSandboxRun,
  coreServices.servicePermissionReview,
  coreServices.serviceContextControl,
  coreServices.modelUsage,
  coreServices.serviceUsageQuota,
  coreServices.contextRestored,
  coreServices.serviceCheckpointControl,
  coreServices.serviceAgentControl,
  coreServices.serviceModelStream,
  coreServices.contextPrepared,
  coreServices.assistantMetadata,
  coreServices.serviceSessionControl,
  coreServices.serviceSessionStore,
  coreServices.serviceShellExec,
  coreServices.serviceShellExecOutput,
  coreServices.serviceShellExecKill,
  coreServices.serviceAgentSpawn,
  coreServices.serviceWorkflowRun,
  coreServices.serviceTodoUpdate,
  coreServices.serviceFileRead,
  coreServices.serviceFileReadText,
  coreServices.serviceFileWrite,
  coreServices.serviceFileEdit,
];

export { namespaceOf } from "../define.js";
export type { EventDef, ResponseDef } from "../define.js";
export { defineEvent } from "../define.js";

export {
  surfacePlacementSchema,
  type SurfacePlacement,
  uiAppearanceSchema,
  type UiAppearance,
  uiTextViewSchema,
  type UiTextView,
  uiToneSchema,
} from "./ui.js";

export * from "./storage.js";
