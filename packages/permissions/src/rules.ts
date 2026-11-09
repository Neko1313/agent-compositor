import { globToRegExp, urlMatches } from "./glob.js";

export type Decision = "allow" | "ask" | "deny";

/** A tool call reduced to the dimensions rules can match on. */
export interface ToolCallDescriptor {
  tool: string;
  readOnly?: boolean;
  /** argv for exec-like tools */
  command?: string[];
  /** resolved absolute path for fs tools */
  path?: string;
  url?: string;
}

export interface PermissionRule {
  name?: string;
  /** tool name or "*" (default) */
  tool?: string;
  decision: Decision;
  readOnly?: boolean;
  reason?: string;
  /** glob over the joined command line, e.g. "git *" or "npm run *" */
  command?: string;
  /** executable basename, e.g. "curl" */
  executable?: string;
  /** glob over path, e.g. "/etc/**" */
  path?: string;
  /** URL allowlist entry: domain or domain/path-prefix */
  url?: string;
}

/** Source rank: rules from higher sources break ties among equal decisions. */
export type RuleSource = "config" | "plugin" | "cli";

export interface CompiledRule extends PermissionRule {
  source: RuleSource;
  order: number;
}

export interface DecisionResult {
  decision: Decision;
  /** nothing matched → caller must ask the user */
  matched: boolean;
  rule?: CompiledRule;
  /** "approval" when allowed via an ApprovalSession */
  via?: "rule" | "approval" | "default";
}

const RANK: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };
const SOURCE_RANK: Record<RuleSource, number> = { config: 0, plugin: 1, cli: 2 };

export function compileRules(rules: PermissionRule[], source: RuleSource, startOrder = 0): CompiledRule[] {
  return rules.map((rule, i) => ({ ...rule, tool: rule.tool ?? "*", source, order: startOrder + i }));
}

/**
 * Decide over a call. Semantics harvested from codex execpolicy + opencode:
 *  - matching is layered by SPECIFICITY: command globs > executable / path / url > tool-wide
 *  - within the most specific matched layer, the WORST decision wins (deny > ask > allow)
 *  - ties break by (source rank, later order) — closer to the user wins
 *  - nothing matched → ask (fail closed; a renderer may downgrade under acceptEdits-style modes)
 */
export function decide(call: ToolCallDescriptor, rules: CompiledRule[]): DecisionResult {
  const matching = rules.filter((r) => ruleMatches(r, call));
  if (matching.length === 0) return { decision: "ask", matched: false, via: "default" };

  const bestTier = Math.max(...matching.map((r) => specificity(r)));
  const candidates = matching.filter((r) => specificity(r) === bestTier);

  let best: CompiledRule | undefined;
  for (const rule of candidates) {
    if (!best) {
      best = rule;
      continue;
    }
    const a = RANK[rule.decision];
    const b = RANK[best.decision];
    if (a > b) best = rule;
    else if (a === b && (SOURCE_RANK[rule.source] > SOURCE_RANK[best.source] || rule.order > best.order)) best = rule;
  }
  return { decision: best!.decision, matched: true, rule: best, via: "rule" };
}

/** higher = more specific; only same-tier rules compete */
function specificity(rule: CompiledRule): number {
  if (rule.command !== undefined) return 3;
  if (rule.executable !== undefined || rule.path !== undefined || rule.url !== undefined) return 2;
  return 1; // tool-wide
}

function ruleMatches(rule: CompiledRule, call: ToolCallDescriptor): boolean {
  if (rule.tool !== "*" && rule.tool !== call.tool) return false;
  if(rule.readOnly!==undefined&&rule.readOnly!==call.readOnly)return false;

  // an exec rule needs a command to match against
  if (rule.command !== undefined) {
    if (!call.command || call.command.length === 0) return false;
    const joined = call.command.join(" ");
    if (!globToRegExpCached(rule.command).test(joined)) return false;
    return true;
  }
  if (rule.executable !== undefined) {
    if (!call.command || call.command.length === 0) return false;
    return call.command[0] === rule.executable;
  }
  if (rule.path !== undefined) {
    if (!call.path) return false;
    return globToRegExpCached(rule.path).test(call.path);
  }
  if (rule.url !== undefined) {
    if (!call.url) return false;
    return urlMatches(rule.url, call.url);
  }
  // tool-wide rule: "ask on everything web_search does"
  return true;
}

const globCache = new Map<string, RegExp>();
function globToRegExpCached(g: string): RegExp {
  let re = globCache.get(g);
  if (!re) {
    re = globToRegExp(g);
    globCache.set(g, re);
  }
  return re;
}

