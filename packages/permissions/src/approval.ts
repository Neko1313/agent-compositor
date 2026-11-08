import { globToRegExp } from "./glob.js";
import { decide as decideWithRules } from "./rules.js";
import type { CompiledRule, DecisionResult, ToolCallDescriptor } from "./rules.js";

export interface Approval {
  /** joined command line that was approved */
  command?: string;
  /** broader pattern approved (e.g. the user approved "npm run *") */
  pattern?: string;
  path?: string;
  tool?: string;
  url?: string;
  approvedAt: number;
  note?: string;
}

/**
 * Session-scoped approvals (codex model): when the user approves a command,
 * later matching calls in the same session auto-allow without re-prompting.
 * Lives for the session; persistence across restarts is a renderer concern.
 */
export class ApprovalSession {
  private approvals: Approval[] = [];

  constructor(private now: () => number = Date.now) {}

  approve(call: ToolCallDescriptor, note?: string): Approval {
    const approval: Approval = {
      tool: call.tool,
      command: call.command ? call.command.join(" ") : undefined,
      path: call.path,
      url: call.url,
      approvedAt: this.now(),
      note,
    };
    this.approvals.push(approval);
    return approval;
  }

  /** Approve a pattern for repeated work, e.g. `npm run *` while iterating. */
  approvePattern(tool: string, pattern: string, note?: string): Approval {
    const approval: Approval = { tool, pattern, approvedAt: this.now(), note };
    this.approvals.push(approval);
    return approval;
  }

  /** Approve a path prefix (fs writes under a directory). */
  approvePathPrefix(path: string, note?: string): Approval {
    const approval: Approval = { path, approvedAt: this.now(), note };
    this.approvals.push(approval);
    return approval;
  }

  /** Consult approvals: strongest applicable approval wins; deny rules still
   *  beat this — approvals are checked only after rule evaluation said ask. */
  check(call: ToolCallDescriptor): DecisionResult | undefined {
    for (const a of this.approvals) {
      if (a.tool && a.tool !== call.tool) continue;
      if (a.url !== undefined) { if (call.url === a.url) return { decision: "allow", matched: true, via: "approval" }; continue; }
      if (a.command !== undefined) {
        if (!call.command || call.command.join(" ") !== a.command) continue;
        return { decision: "allow", matched: true, via: "approval" };
      }
      if (a.pattern !== undefined) {
        if (!call.command) continue;
        if (globToRegExp(a.pattern).test(call.command.join(" ")))
          return { decision: "allow", matched: true, via: "approval" };
        continue;
      }
      if (a.path !== undefined) {
        if (!call.path) continue;
        if (call.path === a.path || call.path.startsWith(a.path.replace(/\/+$/, "") + "/"))
          return { decision: "allow", matched: true, via: "approval" };
        continue;
      }
      // tool-wide approval
      if (a.tool) return { decision: "allow", matched: true, via: "approval" };
    }
    return undefined;
  }

  list(): readonly Approval[] {
    return this.approvals;
  }
  restore(values: readonly Approval[]): void { this.approvals = values.map(value => ({ ...value })); }

  revoke(index: number): boolean {
    if (index < 0 || index >= this.approvals.length) return false;
    this.approvals.splice(index, 1);
    return true;
  }
}

/** Full decision pipeline: rules first (deny is absolute), approvals downgrade ask→allow. */
export function evaluate(
  call: ToolCallDescriptor,
  rules: CompiledRule[],
  approvals?: ApprovalSession,
): DecisionResult {
  const base = decideWithRules(call, rules);
  if (base.decision !== "ask") return base; // allow stands, deny is absolute
  const approved = approvals?.check(call);
  return approved ?? base;
}
