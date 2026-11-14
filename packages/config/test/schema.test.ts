import { expect, it } from 'vitest';
import { ConfigSchema, compositionSchema } from '../src/schema.js';
it('validates dictionary values while preserving omitted settings and forward-compatible keys',()=>{
  expect(ConfigSchema.parse({})).toEqual({});
  const config={serviceProviders:{'service.project.query':'callix'},providers:{custom:{model:'example'}},permissions:{rules:[{decision:'ask'}],future:true},future:{enabled:true}};
  expect(ConfigSchema.parse(config)).toEqual(config);
  expect(ConfigSchema.safeParse({serviceProviders:{tool:123}}).success).toBe(false);
  expect(ConfigSchema.safeParse({permissions:{rules:[{tool:'exec'}]}}).success).toBe(false);
});
it.each([ConfigSchema,compositionSchema])('accepts a partial controller selection while rejecting unknown kinds and empty owners',schema=>{
  const config={ui:{controllers:{approval:'custom-approval',form:'private-form'}}};
  expect(schema.parse(config)).toEqual(config);
  expect(schema.parse({ui:{controllers:{}}})).toEqual({ui:{controllers:{}}});
  expect(schema.safeParse({ui:{controllers:{unknown:'provider'}}}).success).toBe(false);
  expect(schema.safeParse({ui:{controllers:{question:''}}}).success).toBe(false);
});
