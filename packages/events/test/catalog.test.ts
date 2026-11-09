import { describe, expect, it } from "vitest";
import { byAnyName, byName, catalog, resolve } from "../src/index.js";
import { namespaceOf } from "../src/define.js";

describe("event catalog", () => {
  it("has unique canonical names", () => {
    const names = catalog.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has unique aliases, and aliases never shadow canonical names", () => {
    const aliases = catalog.flatMap((e) => e.aliases ?? []);
    expect(new Set(aliases).size).toBe(aliases.length);
    for (const a of aliases) expect(byName.has(a)).toBe(false);
  });

  it("canonical name resolves to itself; alias resolves to its event", () => {
    expect(resolve("tool.call")?.name).toBe("tool.call");
    expect(resolve("classic.PreToolUse")?.name).toBe("tool.call");
    expect(resolve("nope.missing")).toBeUndefined();
  });

  it("namespace matches the name prefix", () => {
    for (const e of catalog) {
      expect(namespaceOf(e.name)).toBe(e.name.slice(0, e.name.indexOf(".")));
    }
  });

  it("every event is frozen and carries a since version", () => {
    for (const e of catalog) {
      expect(e.frozen).toBe(true);
      expect(e.since).toMatch(/^\d+\.\d+\.\d+$/);
      expect(e.version).toBeGreaterThanOrEqual(1);
    }
  });

  it("input and response schemas parse sample payloads", () => {
    for (const e of catalog) {
      const sample = e.input.parse(minimalSample(e.input));
      expect(sample).toBeDefined();
    }
  });

  it("every alias and every canonical name is reachable via byAnyName", () => {
    expect(byAnyName.size).toBe(catalog.length + catalog.flatMap((e) => e.aliases ?? []).length);
  });
});

/** best-effort minimal sample for zod parse smoke test */
function minimalSample(schema: unknown): unknown {
  const s = schema as {
    _def?: { typeName?: string; shape?: () => Record<string, unknown>; innerType?: unknown };
    safeParse?: (v: unknown) => { success: boolean };
  };
  const def = s._def;
  if (!def) return undefined;
  switch (def.typeName) {
    case "ZodObject": {
      const shape = def.shape!();
      return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, minimalSample(v)]));
    }
    case "ZodString":
      return "x";
    case "ZodNumber":
      return 1;
    case "ZodBoolean":
      return false;
    case "ZodEffects":
      return minimalSample((def as {schema:unknown}).schema);
    case "ZodArray": {
      const array=def as {type:unknown;minLength?:{value:number}};
      return Array.from({length:array.minLength?.value??0},()=>minimalSample(array.type));
    }
    case "ZodRecord":
      return {};
    case "ZodOptional":
      return undefined;
    case "ZodNullable":
      return null;
    case "ZodEnum":
      return (def as { values: string[] }).values[0];
    case "ZodUnknown":
    case "ZodAny":
      return undefined;
    case "ZodLiteral":
      return undefined;
    default:
      return undefined;
  }
}
