import { z } from "zod";
import { defineEvent } from "../define.js";

const value = [{kind:"value",summary:"Selected implementation result",schema:z.object({value:z.unknown().optional()})},
  {kind:"deny",summary:"Refuse the operation",schema:z.object({deny:z.string()})}];
function service(name:string, summary:string, input:z.ZodType) {
  return defineEvent({name,since:"0.18.0",version:1,summary,input,responses:value,frozen:true});
}
/** Contexts contain bounded, invocation-scoped host capabilities, never wire data. */
export const agentRun = service("service.agent.run", "Execute a prepared turn through a replaceable strategy. Return a TurnOutcome in {value}.",
  z.object({turnId:z.string(),context:z.unknown()}));
export const agentTools = service("service.agent.tools", "Resolve the effective tool definitions before a turn. Only returned tools can be called.",
  z.object({tools:z.array(z.unknown())}));
export const agentBatch = service("service.agent.batch", "Schedule a batch of tool calls. Each context.execute call retains permission checks and executes at most once.",
  z.object({calls:z.array(z.unknown()),context:z.unknown()}));
export const contextPrepare = service("service.context.prepare", "Prepare user input and optional attachments without assuming repository references.",
  z.object({text:z.string(),signal:z.unknown().optional()}));
export const contextManage = service("service.context.manage", "Run a replaceable context-pressure strategy before a model step.",
  z.object({context:z.unknown()}));
export const contextCompact = service("service.context.compact", "Replace conversation compaction using the public turn context.",
  z.object({context:z.unknown(),reason:z.string().optional()}));
export const agentCompact = service("service.agent.compact", "Request compaction through the shared context service.",
  z.object({plugin:z.string().optional(),reason:z.string().optional()}));
export const agentClear = service("service.agent.clear", "Clear the active conversation through an interceptable service.",
  z.object({plugin:z.string().optional()}));
export const authStatus = service("service.auth.status", "Read the selected authentication implementation's status.",
  z.object({plugin:z.string().optional()}));
export const sessionAppend = service("service.session.append", "Persist a session event through a replaceable journal implementation.",
  z.object({sessionId:z.string(),cwd:z.string(),event:z.string(),data:z.unknown()}));
