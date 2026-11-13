import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {AgentCore,ScriptedProvider} from '../src/index.js';
const roots:string[]=[],cores:AgentCore[]=[];
afterEach(async()=>{for(const core of cores.splice(0))await core.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(text='a'.repeat(40000)){const cwd=await mkdtemp(join(tmpdir(),'core-read-cursor-'));roots.push(cwd);await writeFile(join(cwd,'data.txt'),text);await writeFile(join(cwd,'denied.txt'),'secret');return cwd;}
function create(cwd:string,extra:Partial<ConstructorParameters<typeof AgentCore>[0]>={}){const core=new AgentCore({cwd,provider:new ScriptedProvider([]),...extra});cores.push(core);return core;}
it('reuses a read cursor in a new core without granting access to another file',async()=>{
 const cwd=await fixture(),first=create(cwd),r=await first.invokeTool('read',{path:'data.txt'});
 expect(r.ok).toBe(true);const cursor=(r.output as any).nextCursor;expect(cursor).toEqual(expect.any(String));
 const second=create(cwd,{rules:[{tool:'read',path:join(cwd,'denied.txt'),decision:'deny'}]});
 expect(await second.invokeTool('read',{path:'data.txt',cursor})).toMatchObject({ok:true,output:{content:'a'.repeat(16000),edit:{range:{start:16000,end:32000}}}});
 expect(await second.invokeTool('read',{path:'denied.txt',cursor})).toMatchObject({ok:false,error:expect.stringContaining('denied')});
});
it.each(['a','👻'])('keeps a dense %s page below the model presentation cap with a visible continuation',async character=>{
 const cwd=await fixture(character.repeat(40000)),provider=new ScriptedProvider([{toolCalls:[{name:'read',args:{path:'data.txt'}}]},{text:'Read the first bounded page.'}]);
 const core=create(cwd,{provider});await core.submit('Inspect the dense file.');expect(core.failure).toBeUndefined();
 const message=provider.requests[1].messages.filter(m=>m.role==='tool').at(-1)!.content;
 expect(message).toContain('nextCursor');expect(message).toContain('File content (verbatim):');
 expect(message).not.toContain('Tool result exceeded');expect(Buffer.byteLength(message,'utf8')).toBeLessThan(20000);
});
it('continues the same snapshot in a fresh process without a shared cursor cache',async()=>{
 const cwd=await fixture('abcdef'),core=create(cwd),first=await core.invokeTool('read',{path:'data.txt',maxChars:2});
 const cursor=(first.output as any).nextCursor;expect(cursor).toEqual(expect.any(String));
 const script=join(cwd,'continue.mjs');
 await writeFile(script,`import{AgentCore,ScriptedProvider}from ${JSON.stringify(pathToFileURL(resolve('packages/core/src/index.ts')).href)};
const core=new AgentCore({cwd:${JSON.stringify(cwd)},provider:new ScriptedProvider([])});
try{console.log(JSON.stringify(await core.invokeTool('read',{path:'data.txt',cursor:${JSON.stringify(cursor)},maxChars:2})));}finally{await core.close();}`);
 const result=await promisify(execFile)(process.execPath,['--import','tsx',script],{cwd:process.cwd(),timeout:10000,env:{PATH:process.env.PATH,HOME:cwd,...(process.env.SYSTEMROOT?{SYSTEMROOT:process.env.SYSTEMROOT}:{})}});
 expect(JSON.parse(result.stdout)).toMatchObject({ok:true,output:{content:'cd',edit:{range:{start:2,end:4}}}});
},15000);
