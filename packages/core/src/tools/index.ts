export { taskTool, type TaskArgs } from "./task.js";
export { askTool, askQuestionsTool, type AskArgs } from "./ask.js";

/** System prompt for subagents spawned without an explicit override. The
 *  last assistant message is all the orchestrator receives back. */
export const SUBAGENT_SYSTEM_PROMPT =
  "You are a subagent inside an agent-compositor session. Work on the single task in " +
  "the user's message using the session's selected tools; inherited permissions and limits apply. " +
  "Finish with a concise final report — only your last assistant message is " +
  "returned to the orchestrator, so make it self-contained.";
