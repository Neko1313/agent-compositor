import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentCore,ScriptedProvider} from '../src/index.js';
const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it.each(['path','file','rewritten'] as const)('checks custom file-tool aliases against the canonical target (%s)',async(mode)=>{
 const root=await mkdtemp(join(tmpdir(),'custom-file-policy-'));roots.push(root);const cwd=join(root,'project');await mkdir(cwd);
 const blocked=join(cwd,'blocked.json'),alias=join(cwd,'report.json');await writeFile(blocked,'{"private":"DO_NOT_READ"}');await symlink(blocked,alias);
 let calls=0;const results:any[]=[];const provider=new ScriptedProvider([]);
 const core=new AgentCore({cwd,provider,tools:[{name:'report_probe',description:'Read a user-selected local report',parameters:{type:'object'},describe:(args:any)=>({tool:'report_probe',path:mode==='file'?join(cwd,args.file):args.path,readOnly:true}),execute:async(ctx,args:any)=>{calls++;const path=await ctx.resolvePath!(args.path??args.file);return{ok:true,data:await readFile(path,'utf8')};}}],rules:[{tool:'report_probe',path:blocked,decision:'deny'},{tool:'report_probe',decision:'allow'}]});cores.push(core);
 core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='tool.result')results.push(e.input);});
 if(mode==='rewritten')core.host.registerPlugin({name:'report-rewrite',version:'1.0.0',trust:'trusted'},{'tool.call':(event,$)=>event.tool==='report_probe'?$.next({...event,input:{path:'report.json'}}):undefined});
 const result=await core.invokeTool('report_probe',mode==='file'?{file:'report.json'}:{path:mode==='rewritten'?'allowed.json':'report.json'});
 expect(result.ok).toBe(false);expect(calls).toBe(0);expect(results.at(-1)).toMatchObject({tool:'report_probe',ok:false,denied:true});expect(JSON.stringify(result)).not.toContain('DO_NOT_READ');expect(provider.requests).toHaveLength(0);
});
it('allows a custom tool to read an allowed alias in an explicitly attached workspace',async()=>{
 const root=await mkdtemp(join(tmpdir(),'custom-file-policy-'));roots.push(root);const cwd=join(root,'project'),attached=join(root,'attached');await mkdir(cwd);await mkdir(attached);
 await writeFile(join(attached,'report.json'),'ALLOWED_REPORT');await symlink(join(attached,'report.json'),join(cwd,'alias.json'));
 const core=new AgentCore({cwd,workspacePaths:[attached],provider:new ScriptedProvider([]),tools:[{name:'report_probe',description:'Read selected report',parameters:{type:'object'},describe:(args:any)=>({tool:'report_probe',path:args.path,readOnly:true}),execute:async(ctx,args:any)=>({ok:true,data:await readFile(await ctx.resolvePath!(args.path),'utf8')})}],rules:[{tool:'report_probe',decision:'allow'}]});cores.push(core);
 expect(await core.invokeTool('report_probe',{path:'alias.json'})).toMatchObject({ok:true,output:'ALLOWED_REPORT'});
});
it('uses the path declared by a custom tool when it maps its argument to a report directory',async()=>{
 const root=await mkdtemp(join(tmpdir(),'custom-file-policy-'));roots.push(root);await mkdir(join(root,'reports'));
 const blocked=join(root,'blocked.json');await writeFile(blocked,'PRIVATE_REPORT');await symlink(blocked,join(root,'reports/result.json'));
 let calls=0;const core=new AgentCore({cwd:root,provider:new ScriptedProvider([]),tools:[{name:'report_probe',description:'Read a named report',parameters:{type:'object'},describe:(args:any)=>({tool:'report_probe',path:join(root,'reports',args.path),readOnly:true}),execute:async(ctx,args:any)=>{calls++;return{ok:true,data:await readFile(await ctx.resolvePath!('reports/'+args.path),'utf8')};}}],rules:[{tool:'report_probe',path:blocked,decision:'deny'},{tool:'report_probe',decision:'allow'}]});cores.push(core);
 expect((await core.invokeTool('report_probe',{path:'result.json'})).ok).toBe(false);expect(calls).toBe(0);
});
