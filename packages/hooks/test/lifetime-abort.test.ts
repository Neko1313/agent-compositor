import {afterEach,expect,it} from 'vitest';
import {mkdtemp,access,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '@agent-compositor/runtime';
import {attach,type HooksApi} from '../src/index.js';

const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
it('rejects effect and journal services on a closed host while explicitly refusing stale UI publication',async()=>{
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'closed-effects',cwd:process.cwd()}});let effects=0;
  runtime.setResolver('service.fs.write',()=>{effects++;return{value:true};});
  runtime.setResolver('service.session.append',()=>{effects++;return{value:true};});host.close();
  await expect(host.emit('service.fs.write',{path:'never',content:'unsafe'})).rejects.toThrow('Hooks host closed');
  await expect(host.emit('service.session.append',{sessionId:'closed-effects',cwd:process.cwd(),event:'ui.press',data:{}})).rejects.toThrow('Hooks host closed');
  expect(await host.emit('service.ui.configure',{appearance:{colors:{accent:'red'}}})).toMatchObject({value:{accepted:false}});expect(effects).toBe(0);
});
it.each(['close','unload'] as const)('settles a direct ignored hook on %s and revokes the retained API',async action=>{
  const root=await mkdtemp(join(tmpdir(),'hooks-lifetime-abort-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const runtime=new Runtime(),host=attach(runtime,{session:{id:'private-lifetime',cwd:root}});cleanup.push(()=>host.close());
  let release!:()=>void;const pause=new Promise<void>(done=>{release=done;});cleanup.push(release);
  let api!:HooksApi;
  host.registerPlugin({name:'owner',version:'1.0.0',trust:'trusted',hookTimeouts:{'ui.press':300000}},
    {'ui.press':async(_event,current)=>{api=current;await pause;await current.fs.write('late.txt','must stay absent');}});
  const pending=host.emit('ui.press',{site:'owner',key:'hold'}).catch(error=>error);
  await expect.poll(()=>api).toBeDefined();if(action==='close')host.close();else host.unregisterPlugin('owner');
  let timer:ReturnType<typeof setTimeout>;const outcome=await Promise.race([pending,new Promise(done=>{timer=setTimeout(()=>done('still pending'),300);})]).finally(()=>clearTimeout(timer));
  expect(outcome).toBeInstanceOf(Error);expect(api.signal.aborted).toBe(true);
  await expect(api.fs.write('new.txt','blocked')).rejects.toBeInstanceOf(Error);
  release();await new Promise<void>(done=>setImmediate(done));
  await expect(access(join(root,'late.txt'))).rejects.toMatchObject({code:'ENOENT'});
  await expect(access(join(root,'new.txt'))).rejects.toMatchObject({code:'ENOENT'});
});
