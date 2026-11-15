import {expect,it} from 'vitest';
import {CheckProgress,failedCheckObservation} from '../src/check-progress.js';

it('recognizes only completed, nonzero checks without shell composition',()=>{
 const args={command:'npm test',cwd:'/work'},failure={stdout:'',stderr:'failed',exitCode:1,durationMs:10};
 const key=failedCheckObservation(args,failure);expect(key).toBeTruthy();
 expect(failedCheckObservation({...args,command:'npm run test:ci'},failure)).toBeTruthy();
 expect(failedCheckObservation(args,{...failure,durationMs:999})).toBe(key);
 expect(failedCheckObservation(args,{...failure,stderr:'different'})).not.toBe(key);
 expect(failedCheckObservation(args,{...failure,exitCode:0})).toBeUndefined();
 expect(failedCheckObservation(args,{...failure,exitCode:-1})).toBeUndefined();
 expect(failedCheckObservation({...args,background:true},failure)).toBeUndefined();
 expect(failedCheckObservation({...args,command:'npm test && echo side-effect'},failure)).toBeUndefined();
 expect(failedCheckObservation({...args,command:'echo test'},failure)).toBeUndefined();
 const cyclic:any={...args};cyclic.extra=cyclic;expect(failedCheckObservation(cyclic,failure)).toBeUndefined();
});

it('reminds once per repeated failure and resets after a new check or effect',()=>{
 const progress=new CheckProgress();
 expect(progress.observe('a')).toBe(false);expect(progress.observe('a')).toBe(true);expect(progress.observe('a')).toBe(false);
 expect(progress.observe('b')).toBe(false);expect(progress.observe('b')).toBe(true);
 progress.reset();expect(progress.observe('b')).toBe(false);expect(progress.observe('b')).toBe(true);
});
