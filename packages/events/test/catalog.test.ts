import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { byAnyName, byName, catalog, resolve } from "../src/index.js";
import { namespaceOf } from "../src/define.js";

describe("event catalog", () => {
  it("preserves the recorded event contracts and aliases",()=>{
    const baseline=JSON.parse(readFileSync(new URL("./fixtures/catalog-0.17.json",import.meta.url),"utf8"));
    const current=JSON.parse(readFileSync(new URL("../../../schema/events.json",import.meta.url),"utf8"));
    const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
      ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,value])=>[key,canonical(value)])):value;
    for(const [name,old] of Object.entries(baseline.events) as [string,{version:number;aliases:string[];sha256:string}][]) {
      const entry=current.events[name];expect(entry,`Removed frozen event ${name}`).toBeDefined();
      expect(entry.version,`${name}: preserve the published version`).toBe(old.version);
      expect(entry.aliases).toEqual(expect.arrayContaining(old.aliases));
      const signature={input:entry.input,responses:Object.fromEntries(Object.entries(entry.responses).map(([key,response])=>[key,(response as any).schema]))};
      // Reviewed additive change in 0.19: existing calls omit cwd and keep their
      // original behavior. Check that this is the only change to the old shape.
      if(name==="service.agent.control"){
        expect(signature.input.properties.cwd).toEqual({type:"string",minLength:1});
        expect(signature.input.required??[]).not.toContain("cwd");
        signature.input=structuredClone(signature.input);delete signature.input.properties.cwd;
      }
      // Reviewed additive change in 0.20: omitted completion retains the
      // service shape; the workflows plugin owns the new delivery policy.
      if(name==='service.workflow.run'){
        expect(signature.input.properties.completion).toEqual({type:'string',enum:['wake','notify','none']});
        expect(signature.input.required??[]).not.toContain('completion');
        signature.input=structuredClone(signature.input);delete signature.input.properties.completion;
      }
      // Reviewed additive change in 0.22: user operations carry optional audit
      // correlation; omitted identifiers retain the original model-turn shape.
      if(['tool.call','tool.check','tool.result','model.usage'].includes(name)){
        expect(signature.input.properties.operationId).toEqual({type:'string'});
        expect(signature.input.required??[]).not.toContain('operationId');
        signature.input=structuredClone(signature.input);delete signature.input.properties.operationId;
        if(name==='tool.call'){
          const next=signature.responses.next as any;
          expect(next.properties.operationId).toEqual({type:'string'});
          expect(next.required??[]).not.toContain('operationId');
          signature.responses.next=structuredClone(next);delete (signature.responses.next as any).properties.operationId;
        }
      }
      // Reviewed additive change in 0.23: omitted profile retains the selected
      // model; auxiliary callers may resolve their own profile's hard capacity.
      if(name==='service.model.capabilities'){
        expect(signature.input.properties.profile).toEqual({type:'string'});
        expect(signature.input.required??[]).not.toContain('profile');
        signature.input=structuredClone(signature.input);delete signature.input.properties.profile;
      }
      // Reviewed additive change in 0.24: omitted scrollKeys preserves the
      // existing input/non-input key routes; only an explicit mode changes them.
      if(name==='service.ui.view'){
        expect(signature.input.properties.view.properties.scrollKeys).toEqual({type:'string',enum:['host','plugin']});
        expect(signature.input.properties.view.required??[]).not.toContain('scrollKeys');
        signature.input=structuredClone(signature.input);delete signature.input.properties.view.properties.scrollKeys;
        // Reviewed additive 0.27: absent table preserves every old text view.
        expect(signature.input.properties.view.required??[]).not.toContain('table');
        expect(signature.input.properties.view.properties.table.type).toBe('object');
        delete signature.input.properties.view.properties.table;
      }
      expect(createHash('sha256').update(JSON.stringify(canonical(signature))).digest('hex'),
        `${name}: changed a frozen schema; preserve the old contract or explicitly review an additive baseline update`).toBe(old.sha256);
    }
  });
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
      for (const response of e.responses) {
        expect(response.schema.safeParse(minimalSample(response.schema)).success,
          `${e.name} response ${response.kind}`).toBe(true);
      }
    }
  });

  it("preserves omitted unknown payloads and primitive defaults without weakening typed fields", () => {
    expect(byName.get("service.model.complete")!.input.parse({plugin:"test"})).toEqual({plugin:"test"});
    expect(byName.get("tool.call")!.responses.find(r=>r.kind==="result")!.schema.parse({})).toEqual({});
    expect(byName.get("service.storage.read")!.input.parse({plugin:"test",key:"item"})).toEqual({plugin:"test",key:"item",scope:"project"});
    expect(byName.get("service.storage.read")!.input.safeParse({plugin:"test"}).success).toBe(false);
    expect(byName.get("service.storage.read")!.input.safeParse({plugin:"test",key:"item",scope:"invalid"}).success).toBe(false);
  });

  it("publishes actual JSON Schema constraints instead of opaque placeholders", () => {
    const generated=JSON.parse(readFileSync(new URL("../../../schema/events.json",import.meta.url),"utf8"));
    const read=generated.events["service.storage.read"].input;
    expect(read.type).toBe("object");
    expect(read.required).toEqual(expect.arrayContaining(["plugin","key"]));
    expect(read.properties.scope.default).toBe("project");
    expect(read.properties.key.minLength).toBe(1);
    const questionnaire=generated.events["service.ui.questionnaire"].input;
    expect(questionnaire.properties.questions).toMatchObject({type:"array",minItems:1,maxItems:8});
    expect(generated.events["service.ui.view"].input.properties.view.properties.input.properties.label.maxLength).toBe(60);
    expect(JSON.stringify(generated)).not.toContain('"note":"opaque"');
  });

  it("every alias and every canonical name is reachable via byAnyName", () => {
    expect(byAnyName.size).toBe(catalog.length + catalog.flatMap((e) => e.aliases ?? []).length);
  });
});

/** Generate structural samples through the public JSON Schema API, then let
 * Zod validate every sample (including refinements); unsupported kinds fail. */
function minimalSample(schema: z.ZodType): unknown {
  let serial = 0;
  function sample(node: z.core.JSONSchema.JSONSchema): unknown {
    if ("default" in node) return node.default;
    if ("const" in node) return node.const;
    if (node.enum) return node.enum[0];
    if (node.anyOf) return sample(node.anyOf[0]);
    if (node.oneOf) return sample(node.oneOf[0]);
    if (Array.isArray(node.type)) return sample({...node,type:node.type[0]});
    switch (node.type) {
      case "object": return Object.fromEntries((node.required ?? []).map(key =>
        [key, sample(node.properties![key] as z.core.JSONSchema.JSONSchema)]));
      case "string": return `sample${++serial}`.padEnd(node.minLength ?? 0,"x");
      case "integer": case "number": return Math.max(node.minimum ?? 1, typeof node.exclusiveMinimum === "number" ? node.exclusiveMinimum + 1 : 1);
      case "boolean": return false;
      case "null": return null;
      case "array": return Array.from({length:node.minItems ?? 0},()=>sample(node.items as z.core.JSONSchema.JSONSchema));
      case undefined: return null; // unknown/any are JSON-unconstrained.
      default: throw Error(`Add a sample generator for ${node.type}`);
    }
  }
  return sample(z.toJSONSchema(schema,{io:"input",unrepresentable:"any"}));
}
