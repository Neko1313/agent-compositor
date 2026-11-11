import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {buildApp} from '../src/build.js';
import {ScriptedProvider} from '@agent-compositor/core';
const roots:string[]=[],apps:Awaited<ReturnType<typeof buildApp>>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(git=true,decision='allow'){
 const root=await mkdtemp(join(tmpdir(),'git-review-oracle-'));roots.push(root);
 const cwd=join(root,'project'),home=join(root,'home');await mkdir(cwd);await mkdir(home);
 const run=(...args:string[])=>execFileSync('git',args,{cwd,env:{PATH:process.env.PATH,HOME:home,LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 if(git){run('init');run('config','user.email','fixture@example.test');run('config','user.name','Fixture');await writeFile(join(cwd,'tracked.txt'),'original\n');run('add','tracked.txt');run('commit','-m','Initial fixture');}
 await writeFile(join(cwd,'agent-compositor.json'),JSON.stringify({agent:{projectContext:false,skills:false},permissions:{rules:[{tool:'extension_control',decision:'allow'},{tool:'git_review',decision}]}}));
 const provider=new ScriptedProvider([]);
 const app=await buildApp({cwd,env:{HOME:home},provider,agentHub:false,pluginDirs:[resolve('plugins/git-review')]});apps.push(app);
 const core=app.createCore(async()=>false);
 const enabled=await core.invokeTool('extension_control',{action:'enable',name:'git-review',scope:'project'});expect(enabled.ok,enabled.error).toBe(true);
 const reloaded=await app.reloadPlugins(core);expect(reloaded).not.toMatch(/failed|error/i);
 return{root,cwd,home,run,app,core,provider};
}
it('reports actual status and distinct staged/unstaged diffs without changing the index',async()=>{
 const f=await fixture();await writeFile(join(f.cwd,'tracked.txt'),'staged-change\n');f.run('add','tracked.txt');await writeFile(join(f.cwd,'tracked.txt'),'working-change\n');await writeFile(join(f.cwd,'new file.txt'),'untracked\n');
 const before=f.run('diff','--cached');
 const status=await f.core.invokeTool('git_review',{action:'status'});expect(status).toMatchObject({ok:true,output:{exitCode:0,truncated:false}});expect((status.output as any).output).toContain('tracked.txt');expect((status.output as any).output).toContain('new file.txt');
 const staged=await f.core.invokeTool('git_review',{action:'diff',staged:true});expect(staged.ok,staged.error).toBe(true);expect((staged.output as any).output).toContain('+staged-change');expect((staged.output as any).output).not.toContain('+working-change');
 const work=await f.core.invokeTool('git_review',{action:'diff'});expect(work.ok,work.error).toBe(true);expect((work.output as any).output).toContain('+working-change');expect(f.run('diff','--cached')).toBe(before);
});
it('bounds displayed output with scoped maxChars configuration',async()=>{
 const f=await fixture();await f.app.storage.configure('git-review.json',{maxChars:4000});await writeFile(join(f.cwd,'tracked.txt'),Array.from({length:1500},(_,i)=>'changed line '+i).join('\n'));
 const result=await f.core.invokeTool('git_review',{action:'diff'});expect(result).toMatchObject({ok:true,output:{exitCode:0,truncated:true}});expect((result.output as any).output.length).toBeLessThanOrEqual(4000);
});
it('does not execute repository diff/textconv/fsmonitor programs',async()=>{
 const f=await fixture();const marker=join(f.root,'external-program-ran');const program=join(f.root,'external.cjs');await writeFile(program,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');`);
 const driver=`node ${program}`;f.run('config','diff.trap.command',driver);f.run('config','diff.trap.textconv',driver);f.run('config','core.fsmonitor',driver);
 await writeFile(join(f.cwd,'.gitattributes'),'tracked.txt diff=trap\n');await writeFile(join(f.cwd,'tracked.txt'),'safe changed text\n');
 for(const action of ['status','diff']){const result=await f.core.invokeTool('git_review',{action});expect(result.ok,result.error).toBe(true);}
 await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});
});
it('fails truthfully outside a repository and rejects invalid actions',async()=>{
 const f=await fixture(false);
 const result=await f.core.invokeTool('git_review',{action:'status'});expect(result.ok).toBe(false);expect(result.error).toMatch(/git|repository/i);
 expect((await f.core.invokeTool('git_review',{action:'commit'})).ok).toBe(false);
 expect((await f.core.invokeTool('git_review',{action:'diff',staged:'yes'})).ok).toBe(false);
});
it('respects tool denial and consumes only its exact command',async()=>{
 const f=await fixture(true,'deny');
 expect((await f.core.invokeTool('git_review',{action:'status'})).ok).toBe(false);
 const surfaces:any[]=[];f.core.subscribe(e=>{if(e.kind==='catalog'&&e.event==='ui.surface')surfaces.push(e.input);});
 await f.core.submit('/git-review');expect(f.provider.requests).toHaveLength(0);expect(surfaces.some(s=>s.title==='Git review')).toBe(true);
 await f.core.submit('/git-review-other');expect(f.provider.requests).toHaveLength(1);
});
