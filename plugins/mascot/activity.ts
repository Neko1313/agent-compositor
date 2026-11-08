import { states, type State, type Config } from "./animations.js";
const defaults: Record<string, State> = {
  read: "searching",
  glob: "searching",
  grep: "searching",
  code_query: "searching",
  web_search: "searching",
  web_fetch: "searching",
  mcp_call: "searching",
  write: "editing",
  edit: "editing",
  todo: "planning",
  task: "waiting_subagents",
  workflow: "waiting_subagents",
};
export class Activity {
  turns = new Set<string>();
  tools = new Map<string, State>();
  children = new Set<string>();
  reactions = new Map<string, State>();
  transient?: { state: State; until: number };
  constructor(private config: Config = {}) {}
  accept(event: string, e: any, actor = "main", now = Date.now()) {
    const key = (id: string = "") => `${actor}:${id}`;
    if (event === "agent.activity") {
      this.accept(e.event, e.data ?? {}, e.agentId, now);
      return;
    }
    if (event === "turn.start") {
      this.turns.add(key(e.turnId));
      this.transient = undefined;
    }
    if (event === "tool.call")
      this.tools.set(
        key(e.callId),
        this.config.tools?.[e.tool] ?? defaults[e.tool] ?? "thinking"
      );
    if (event === "tool.result") {
      this.tools.delete(key(e.callId));
      if (!e.ok) this.flash("error", now);
    }
    if (event === "subagent.start") this.children.add(key(e.agentId));
    if (event === "subagent.complete") this.children.delete(key(e.agentId));
    if (event === "ui.reaction") {
      const id = key(`${e.source}:${e.id ?? e.kind}`),
        state =
          this.config.reactions?.[`${e.source}:${e.kind}`] ??
          this.config.reactions?.[e.kind] ??
          e.kind;
      if (e.active === false) this.reactions.delete(id);
      else if (states.includes(state)) {
        if (e.active === true) this.reactions.set(id, state);
        else this.flash(state, now);
      }
    }
    if (["turn.complete", "turn.failed", "turn.interrupted"].includes(event)) {
      for (const set of [this.turns, this.children])
        for (const id of set) if (id.startsWith(`${actor}:`)) set.delete(id);
      for (const map of [this.tools, this.reactions])
        for (const id of map.keys())
          if (id.startsWith(`${actor}:`) && !id.includes("plan-mode:"))
            map.delete(id);
      this.flash(
        event === "turn.failed"
          ? "error"
          : event === "turn.complete"
          ? "done"
          : "idle",
        now
      );
    }
  }
  flash(state: State, now = Date.now()) {
    this.transient = { state, until: now + 1800 };
  }
  current(now = Date.now()): State {
    const reactions = [...this.reactions.values()],
      tools = [...this.tools.values()];
    for (const state of ["approval", "question"] as State[])
      if (reactions.includes(state)) return state;
    if (this.transient?.state === "error" && this.transient.until > now)
      return "error";
    for (const state of ["editing", "searching", "planning"] as State[])
      if (tools.includes(state)) return state;
    if (this.children.size || tools.includes("waiting_subagents"))
      return "waiting_subagents";
    if (this.turns.size || this.tools.size)
      return reactions.includes("planning") ? "planning" : "thinking";
    if (this.transient && this.transient.until > now)
      return this.transient.state;
    return reactions.at(-1) ?? "idle";
  }
}
