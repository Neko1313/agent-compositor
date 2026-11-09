import { describe, expect, it } from 'vitest';
import { PluginPanel } from '../src/plugin-panel.js';
describe('placement panel keyboard focus',()=>{
 it('reverses Tab and lets Escape close during a save without changing the pending draft',()=>{
  const p=new PluginPanel(()=>[{id:'usage',plugin:'cost',surface:'usage',title:'Usage',placement:{workspace:1}}],()=>[]);
  p.handle({kind:'key',key:'tab',modifiers:['shift']});
  expect(p.field).toBe(8);
  expect(p.handle({kind:'key',key:'enter'})).toBe('close');
  p.busy=true;
  const draft={...p.draft};
  p.handle({kind:'key',key:'right'});
  expect(p.draft).toEqual(draft);
  expect(p.handle({kind:'key',key:'escape'})).toBe('close');
  expect(p.busy).toBe(true);
  expect(p.draft).toEqual(draft);
 });
});
