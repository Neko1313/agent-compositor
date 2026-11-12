import {it,expect} from 'vitest';
import {behavior} from '../../../tools/plugins/behavior/index.js';
it('test-reports panel: reads and selects failures, handles errors, preserves state and repairs configuration',async()=>{
 const observations=await behavior('test-reports');
 expect(observations.map(row=>row.requirement)).toEqual(expect.arrayContaining(['view.content','view.error','state.restart','mutation.recovery']));
});
