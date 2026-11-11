import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {buildApp} from '../src/build.js';
import {AppUI} from '../src/ui.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {hello} from '@agent-compositor/protocol';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[],uis:AppUI[]=[];
afterEach(async()=>{for(const ui of uis.splice(0)){ui.close();await ui.settled();}for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const wait=(check:()=>boolean)=>expect.poll(check,{timeout:3000}).toBe(true);
async function setup(names:string[]=['probe']){
 const root=await mkdtemp(join(tmpdir(),'ui-command-'));roots.push(root);
 if(names.includes('probe')){
  const dir=join(root,'plugins','probe');await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'plugin.json'),JSON.stringify({name:'probe',version:'1.0.0',trust:'trusted',commands:[{name:'/inspect',description:'Inspect project',ui:{site:'main'}},{name:'/queued',description:'Queued command'}]}));
  await writeFile(join(dir,'hooks.ts'),`export default {
   'prompt.submit':async(e,$)=>{if(e.text.startsWith('/inspect'))throw Error('UI command leaked into prompt hooks');if(e.text==='/queued'){await $.ui.view('queued','Queued',{lines:[{text:'QUEUED_COMMAND_EXECUTED'}]});return{drop:'queued: handled'};}},
   'ui.press':async(e,$)=>{if(e.site!=='plugin-probe-main')return;if(e.key==='command:/inspect fail')throw Error('UI command failed deliberately');await $.fs.write('.agent-compositor/received-command.json',JSON.stringify(e.key));await $.ui.view('main','Inspection',{lines:[{text:e.key}]});}
  };`);
 }
 await writeFile(join(root,'agent-compositor.json'),JSON.stringify({enabledPlugins:names,agent:{projectContext:false}}));
 const provider=new ScriptedProvider([{text:'MAIN_STILL_ACTIVE',hold:true},{text:'UNEXPECTED_MODEL_REQUEST'}]);
 const app=await buildApp({cwd:root,env:{HOME:join(root,'home')},provider,agentHub:false,pluginDirs:names.filter(n=>n!=='probe').map(n=>resolve('plugins',n))});apps.push(app);
 const ui=new AppUI(app.createCore,app.reloadPlugins,[],app.commands);uis.push(ui);const screens=new Map<string,string>();
 ui.connect(message=>{if(message.type==='render')screens.set(message.surface,message.grid?.map(row=>row.map(c=>c.ch).join('')).join('\n')??'');});
 ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));await ui.core.start();
 const send=(text:string)=>{ui.receive({type:'input',surface:'input',data:{kind:'key',key:'i',modifiers:['meta']}});ui.receive({type:'input',surface:'input',data:{kind:'text',text}});ui.receive({type:'input',surface:'input',data:{kind:'key',key:'enter'}});};
 return{root,app,ui,provider,screens,send};
}
it('routes an arbitrary loaded plugin command with literal arguments while legacy commands remain queued',async()=>{
 const f=await setup();expect(f.app.commands().find(c=>c.name==='/inspect')?.ui).toEqual({site:'plugin-probe-main'});
 f.send('Actual task');await wait(()=>f.provider.requests.length===1);f.send('/queued');
 const before=structuredClone(f.ui.core.getMessages());
 f.send('/inspect "two words" $(literal)');await wait(()=>f.screens.get('plugin-probe-main')?.includes('$(literal)')===true);
 expect(JSON.parse(await readFile(join(f.app.storage.paths.state,'received-command.json'),'utf8'))).toBe('command:/inspect "two words" $(literal)');
 expect(f.ui.core.getMessages()).toEqual(before);expect(f.screens.has('plugin-probe-queued')).toBe(false);expect(f.provider.requests).toHaveLength(1);
 f.send('/inspect fail');await wait(()=>f.screens.get('session')?.includes('deliberately')===true);
 expect(f.ui.core.getState()).toBe('running');expect(f.provider.requests[0].signal.aborted).toBe(false);
 f.provider.release();await f.ui.settled();expect(f.provider.requests).toHaveLength(1);expect(f.screens.get('plugin-probe-queued')).toContain('QUEUED_COMMAND_EXECUTED');
 expect(JSON.stringify(f.ui.core.getMessages())).not.toContain('/inspect');
});
it('opens bundled usage, tasks, MCP, workflows and proxy panels without stopping the model',async()=>{
 const f=await setup(['cost','todos','mcp','workflows','network-proxy']);f.send('Actual task');await wait(()=>f.provider.requests.length===1);
 const before=structuredClone(f.ui.core.getMessages());
 for(const[command,site,evidence]of [
  ['/cost','plugin-cost-usage','input'],['/usage','plugin-cost-usage','input'],['/todos','plugin-todos-tasks','No tasks yet'],
  ['/mcp','plugin-mcp-connections','MCP connections'],['/workflows','plugin-workflows-runs','Workflow'],['/proxy status','plugin-network-proxy-network','Proxy disabled'],
 ]){f.send(command);await expect.poll(()=>f.screens.get(site)??'',{message:command,timeout:3000}).toContain(evidence);expect(f.ui.core.getState()).toBe('running');}
 expect(f.provider.requests).toHaveLength(1);expect(f.ui.core.getMessages()).toEqual(before);f.provider.release();await f.ui.settled();expect(f.provider.requests).toHaveLength(1);
});
