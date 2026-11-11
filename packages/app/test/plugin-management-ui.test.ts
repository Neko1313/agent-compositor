import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildApp} from '../src/build.js';
import {AppUI} from '../src/ui.js';
import {ScriptedProvider} from '@agent-compositor/core';
import {hello,type WireMessage} from '@agent-compositor/protocol';

const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[],uis:AppUI[]=[];
afterEach(async()=>{for(const ui of uis.splice(0))ui.close();for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function wait(check:()=>boolean){await expect.poll(check,{timeout:5000}).toBe(true);}

it('manages plugins while the model streams, leaves its prompt and turn intact, and applies deferred file changes when idle',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-ui-'));roots.push(root);
 const provider=new ScriptedProvider([{text:'Agent working',hold:true},{text:'Agent working again',hold:true}]);
 const app=await buildApp({cwd:root,env:{HOME:join(root,'home')},provider,agentHub:false});apps.push(app);
 const ui=new AppUI(app.createCore,app.reloadPlugins);uis.push(ui);
 const messages:WireMessage[]=[];ui.connect(message=>messages.push(message));
 ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));
 await ui.core.start();
 const send=(text:string)=>{ui.windows.focused='input';ui.receive({type:'input',surface:'input',data:{kind:'text',text}});ui.receive({type:'input',surface:'input',data:{kind:'key',key:'enter'}});};
 const views:any[]=[];ui.core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')views.push(e.input);});
 send('Work on my task');await wait(()=>provider.requests.length===1);
 send('/plugins');await wait(()=>views.some(v=>JSON.stringify(v).includes('Browse marketplace')));
 expect(ui.core.getState()).toBe('running');expect(provider.requests).toHaveLength(1);
 send('/marketplace');await wait(()=>views.some(v=>JSON.stringify(v).includes('Plugin marketplaces')));
 const press=(site:string,key:string)=>ui.core.host.emit('ui.press',{site,key});
 const market='plugin-marketplace-manager-marketplaces',extensions='plugin-extension-manager-extensions';
 ui.core.host.registerPlugin({name:'management-policy',version:'1.0.0',trust:'trusted'},{'service.extension.control':()=>({deny:'Management blocked by policy'})});
 await press(extensions,'command:/extensions enable todos --project');
 expect(JSON.stringify(views.at(-1))).toContain('Management blocked by policy');
 ui.core.host.unregisterPlugin('management-policy');
 await press(market,'catalog:agent-compositor');
 await ui.core.host.emit('ui.change',{site:market,id:'search',value:'no-such-plugin'});
 expect(JSON.stringify(views.at(-1))).toContain('No matching plugins');
 await ui.core.host.emit('ui.change',{site:market,id:'search',value:'todos'});
 expect(views.at(-1).view.lines.some((line:any)=>line.action==='install:todos@agent-compositor')).toBe(true);
 ui.core.host.setFormHandler(async(_plugin,form)=>({action:form.title.startsWith('Install')?'install':'apply',values:{scope:'project',...(form.title.startsWith('Install')?{}:{action:'enable'})}}));
 await press(market,'install:todos@agent-compositor');
 expect(JSON.stringify(views.at(-1))).toContain('Installed todos');
 await press(extensions,'manage:todos');expect(JSON.stringify(views.at(-1))).toContain('Enabled todos');
 expect(app.plugins).toHaveLength(0);expect(ui.core.getState()).toBe('running');
 expect(ui.core.getMessages().filter(m=>m.role==='user').map(m=>m.content)).toEqual(['Work on my task']);
 send('/reload');expect(app.plugins).toHaveLength(0);
 provider.release();await ui.settled();expect(app.plugins.map(p=>p.manifest.name)).toContain('todos');
 send('Keep working');await wait(()=>provider.requests.length===2);
 await press(extensions,'command:/extensions remove todos --project');
 expect(JSON.stringify(views.at(-1))).toContain('remove todos queued');
 const directory=app.plugins.find(p=>p.manifest.name==='todos')!.dir;
 expect(await stat(directory)).toBeTruthy();send('/reload');
 provider.release();await ui.settled();
 expect(await stat(directory).catch(()=>null)).toBeNull();expect(app.plugins).toHaveLength(0);
 expect(provider.requests).toHaveLength(2);
});

it('defers an actual version update until the active model turn has finished',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-ui-update-'));roots.push(root);
 const market=join(root,'catalog'),plugin=join(market,'plugins/probe');
 await mkdir(join(market,'.claude-plugin'),{recursive:true});await mkdir(plugin,{recursive:true});
 const publish=async(version:string)=>{
  await writeFile(join(market,'.claude-plugin/marketplace.json'),JSON.stringify({name:'test-market',owner:{name:'Fixture'},plugins:[{name:'probe',version,source:'./plugins/probe'}]}));
  await writeFile(join(plugin,'plugin.json'),JSON.stringify({name:'probe',version,trust:'trusted'}));
  await writeFile(join(plugin,'version.txt'),version);
  await writeFile(join(plugin,'hooks.ts'),'export default {};');
 };
 await publish('1.0.0');
 const provider=new ScriptedProvider([{text:'Holding update',hold:true}]);
 const app=await buildApp({cwd:root,env:{HOME:join(root,'home')},provider,agentHub:false});apps.push(app);
 const core=app.createCore(async()=>true);
 await core.invokeTool('marketplace_control',{action:'add',source:market,scope:'project'});
 await core.invokeTool('extension_control',{action:'install',name:'probe@test-market',scope:'project'});
 await core.invokeTool('extension_control',{action:'enable',name:'probe',scope:'project'});await app.reloadPlugins(core);
 const installed=app.plugins[0].dir;await publish('1.1.0');
 const running=core.submit('Continue the original work');await wait(()=>provider.requests.length===1);
 const surfaces:any[]=[];core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')surfaces.push(e.input);});
 await core.host.emit('ui.press',{site:'plugin-extension-manager-extensions',key:'command:/extensions update probe --project'});
 expect(JSON.stringify(surfaces.at(-1))).toContain('update probe queued');
 expect(await readFile(join(installed,'version.txt'),'utf8')).toBe('1.0.0');
 expect(await app.reloadPlugins(core)).toContain('Wait until');
 provider.release();await running;await app.reloadPlugins(core);
 expect(app.plugins[0].manifest.version).toBe('1.1.0');
 expect(await readFile(join(installed,'version.txt'),'utf8')).toBe('1.1.0');expect(provider.requests).toHaveLength(1);
});

it.each(['approval','question'] as const)('keeps plugin navigation and forms usable while an agent %s waits in the dock',async(kind)=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-ui-dialog-'));roots.push(root);
 const provider=new ScriptedProvider([{toolCalls:[kind==='approval'?{name:'exec',args:{command:'echo approval-probe'}}:{name:'ask_user',args:{question:'Agent waiting for answer',options:['Continue','Cancel']}}]}]);
 const app=await buildApp({cwd:root,env:{HOME:join(root,'home')},provider,agentHub:false});apps.push(app);
 const ui=new AppUI(app.createCore,app.reloadPlugins);uis.push(ui);
 const rendered=new Map<string,string>();ui.connect(message=>{if(message.type==='render')rendered.set(message.surface,message.grid?.map(row=>row.map(cell=>cell.ch).join('')).join('\n')??'');});
 ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));await ui.core.start();
 const key=(key:string)=>ui.receive({type:'input',surface:'input',data:{kind:'key',key}});
 ui.receive({type:'input',surface:'input',data:{kind:'text',text:'Work'}});key('enter');
 const marker=kind==='approval'?'allow once':'Agent waiting for answer';
 await wait(()=>rendered.get('input')?.includes(marker)??false);
 ui.receive({type:'input',surface:'status',data:{kind:'mouse',row:22,col:16,button:'left',action:'press'}});
 await wait(()=>rendered.get('plugin-extension-manager-extensions')?.includes('Browse marketplace')??false);
 expect(ui.core.getState()).toBe('running');expect(rendered.get('input')).toContain(marker);
 const managing=ui.core.host.emit('ui.press',{site:'plugin-extension-manager-extensions',key:'manage:todos'});
 await wait(()=>rendered.has('settings-form'));
 expect(rendered.get('input')).toContain(marker);key('escape');await managing;
 expect(ui.core.getState()).toBe('running');expect(rendered.get('input')).toContain(marker);expect(provider.requests).toHaveLength(1);
 ui.close();await ui.settled();
});

it('opens management from a narrow pending question without consuming the answer or composer draft',async()=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-ui-shortcuts-'));roots.push(root);
 const provider=new ScriptedProvider([
  {toolCalls:[{name:'ask_user',args:{question:'Keep this question pending',options:['Continue','Cancel']}}]},
  {text:'Continued after management'},
 ]);
 const app=await buildApp({cwd:root,env:{HOME:join(root,'home')},provider,agentHub:false});apps.push(app);
 const ui=new AppUI(app.createCore,app.reloadPlugins);uis.push(ui);
 const rendered=new Map<string,string>();
 ui.connect(message=>{if(message.type==='render')rendered.set(message.surface,message.grid?.map(row=>row.map(cell=>cell.ch).join('')).join('\n')??'');});
 ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));ui.resize(48,18);await ui.core.start();
 const key=(key:string,modifiers?:string[])=>ui.receive({type:'input',surface:'input',data:{kind:'key',key,modifiers}});
 ui.receive({type:'input',surface:'input',data:{kind:'text',text:'Ask first'}});key('enter');
 await wait(()=>rendered.get('input')?.includes('Keep this question pending')??false);
 expect(rendered.get('status')).not.toContain('[Plugins]');
 key('o',['meta']);await wait(()=>ui.windows.focused==='plugin-extension-manager-extensions'&&(rendered.get('plugin-extension-manager-extensions')?.includes('Browse marketplace')??false));
 key(',',['meta']);await wait(()=>ui.windows.focused==='plugin-model-selector-models'&&(rendered.get('plugin-model-selector-models')?.includes('Add provider')??false));
 expect(rendered.get('input')).toContain('Alt+i to answer');expect(provider.requests).toHaveLength(1);
 key('i',['meta']);key('enter');await ui.settled();
 expect(provider.requests).toHaveLength(2);expect(ui.core.getMessages().some(m=>m.role==='assistant'&&m.content==='Continued after management')).toBe(true);
 key('i',['meta']);ui.receive({type:'input',surface:'input',data:{kind:'text',text:'Unsent draft'}});
 key('o',['meta']);await wait(()=>ui.windows.focused==='plugin-extension-manager-extensions');
 key('2',['meta']);expect(ui.windows.workspace).toBe(2);
 key(',',['meta']);await wait(()=>ui.windows.focused==='plugin-model-selector-models');expect(ui.windows.workspace).toBe(1);
 key('i',['meta']);expect(rendered.get('input')).toContain('Unsent draft');expect(provider.requests).toHaveLength(2);
},15000);

it.each(['approval','question'] as const)('expands a compact %s on click without submitting it',async kind=>{
 const root=await mkdtemp(join(tmpdir(),'compact-agent-dialog-'));roots.push(root);
 const provider=new ScriptedProvider([{toolCalls:[kind==='approval'
  ?{name:'exec',args:{command:'echo must-not-run-on-expand'}}
  :{name:'ask_user',args:{question:'Expand before answering',options:['Continue','Cancel']}}]}]);
 const app=await buildApp({cwd:root,env:{HOME:join(root,'home')},provider,agentHub:false});apps.push(app);
 const ui=new AppUI(app.createCore,app.reloadPlugins);uis.push(ui);
 const rendered=new Map<string,string>();
 ui.connect(message=>{if(message.type==='render')rendered.set(message.surface,message.grid?.map(row=>row.map(cell=>cell.ch).join('')).join('\n')??'');});
 ui.receive(hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Layout'],encodings:['jsonl']}));ui.resize(48,18);await ui.core.start();
 const key=(key:string,modifiers?:string[])=>ui.receive({type:'input',surface:'input',data:{kind:'key',key,modifiers}});
 ui.receive({type:'input',surface:'input',data:{kind:'text',text:'Wait for me'}});key('enter');
 const marker=kind==='approval'?'allow once':'Expand before answering';
 await wait(()=>rendered.get('input')?.includes(marker)??false);
 key('o',['meta']);await wait(()=>rendered.get('input')?.includes('Alt+i')??false);
 const mouse=(action:'move'|'press'|'release')=>ui.receive({type:'input',surface:'input',data:{kind:'mouse',row:14,col:5,button:'left',action}});
 mouse('move');expect(ui.windows.focused).not.toBe('input');
 mouse('press');mouse('release');
 expect(ui.windows.focused).toBe('input');expect(rendered.get('input')).toContain(marker);
 expect(provider.requests).toHaveLength(1);expect(ui.core.getState()).toBe('running');
 expect(ui.core.getMessages().some(m=>m.role==='tool')).toBe(false);
 ui.close();await ui.settled();
});
