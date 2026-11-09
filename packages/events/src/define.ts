import { z } from "zod";

/**
 * An event definition. This file is the "UAPI header" pattern from the Linux
 * kernel: the catalog is the contract, and `frozen: true` means the shape
 * must not change incompatibly — only new versions and aliases.
 * Unknown payload properties retain explicit optionality from the Zod 3 contract;
 * upgrading the validator must not make previously accepted missing keys fail.
 */
export interface ResponseDef {
  /** discriminator value a hook returns, e.g. "deny" */
  kind: string;
  summary: string;
  schema: z.ZodType;
}

export interface EventDef {
  /** canonical dotted name, e.g. "tool.call". Third-party: "plugin.<name>:<event>". */
  name: string;
  /** catalog version that introduced the event (semver) */
  since: string;
  /** bump when the payload changes incompatibly; additive changes stay at 1 */
  version: number;
  summary: string;
  input: z.ZodType;
  /** response forms; the first is the "pass-through" (next(e)) form */
  responses: ResponseDef[];
  /** legacy names that resolve to this event, e.g. "classic.PreToolUse" */
  aliases?: string[];
  /** async generator hooks (can yield intermediate values) */
  generator?: boolean;
  /** once true, the event shape is frozen ("don't break plugins") */
  frozen: boolean;
}

export function defineEvent(def: EventDef): EventDef {
  return Object.freeze(def);
}

export function namespaceOf(name: string): string {
  const i = name.indexOf(".");
  if (i === -1) return "";
  return name.slice(0, i);
}
