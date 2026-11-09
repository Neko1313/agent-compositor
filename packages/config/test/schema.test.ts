import { expect, it } from 'vitest';
import { ConfigSchema } from '../src/schema.js';
it('validates dictionary values while preserving omitted settings and forward-compatible keys',()=>{
  expect(ConfigSchema.parse({})).toEqual({});
  const config={serviceProviders:{'service.project.query':'callix'},providers:{custom:{model:'example'}},permissions:{rules:[{decision:'ask'}],future:true},future:{enabled:true}};
  expect(ConfigSchema.parse(config)).toEqual(config);
  expect(ConfigSchema.safeParse({serviceProviders:{tool:123}}).success).toBe(false);
  expect(ConfigSchema.safeParse({permissions:{rules:[{tool:'exec'}]}}).success).toBe(false);
});
