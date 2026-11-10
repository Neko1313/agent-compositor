import {expect,it,vi} from 'vitest';
import hooks from '../hooks.js';
it('reports successful and failed completion with bounded diagnostic text',async()=>{
 const notify=vi.fn(),api={ui:{notify}};
 await hooks['turn.complete']({},api);expect(notify).toHaveBeenLastCalledWith('turn complete','info');
 await hooks['turn.failed']({error:'x'.repeat(300)},api);expect(notify).toHaveBeenLastCalledWith('turn failed: '+'x'.repeat(120),'error');
});

it('does not observe unrelated events and emits exactly once for each repeated completion',async()=>{
 const {Runtime}=await import('@agent-compositor/runtime'),{attach}=await import('@agent-compositor/hooks');
 const notifications:string[]=[];
 const host=attach(new Runtime(),{session:{id:'notify-contract',cwd:process.cwd()},notify:message=>notifications.push(message)});
 host.registerPlugin({name:'notify-done',version:'1.1.0',trust:'trusted'},hooks);
 await host.emit('prompt.submit',{text:'unrelated'});expect(notifications).toEqual([]);
 await host.emit('turn.complete',{turnId:'one'});await host.emit('turn.complete',{turnId:'two'});
 expect(notifications).toEqual(['turn complete','turn complete']);
 host.unregisterPlugin('notify-done');await host.emit('turn.complete',{turnId:'removed'});expect(notifications).toHaveLength(2);
});

it('contains notification dependency failures and recovers on the next event',async()=>{
 const {Runtime}=await import('@agent-compositor/runtime'),{attach}=await import('@agent-compositor/hooks');
 let unavailable=true;const notifications:string[]=[];
 const host=attach(new Runtime(),{session:{id:'notify-failure',cwd:process.cwd()},notify:message=>{if(unavailable)throw Error('notification sink unavailable');notifications.push(message);}});
 host.registerPlugin({name:'notify-done',version:'1.1.0',trust:'trusted'},hooks);
 const failed=await host.emit('turn.complete',{turnId:'failed'});expect(failed.faults).toHaveLength(1);expect(notifications).toEqual([]);
 unavailable=false;expect((await host.emit('turn.complete',{turnId:'recovered'})).faults).toEqual([]);expect(notifications).toEqual(['turn complete']);
 host.unregisterPlugin('notify-done');
});
