import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {queryProject,readTool,editTool,registerDefaultResolvers,UndoStore,type ToolContext} from '../src/index.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(text:string){
 const cwd=await mkdtemp(join(tmpdir(),'search-read-'));roots.push(cwd);await writeFile(join(cwd,'dense.txt'),text);
 const handlers=new Map<string,(p:any)=>Promise<any>>();registerDefaultResolvers({on:(s,h)=>{handlers.set(s,h);}},{root:cwd});
 const ctx:ToolContext={cwd,signal:new AbortController().signal,undo:new UndoStore(),request:(s,p)=>handlers.get(s)!(p)};
 return{cwd,ctx};
}
it.each([false,true])('locates, reads and edits a far-end match directly, regex=%s',async regex=>{
 const original='x'.repeat(60000)+'TARGET'+' suffix',f=await fixture(original);
 const result=await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET',regex});
 const match=result.matches[0];expect(match.text).toContain('TARGET');expect(match.text.length).toBeLessThanOrEqual(2000);
 expect(match).not.toHaveProperty('readView');
 expect(match).toMatchObject({column:60001,textTruncated:true,readArgs:{path:await realpath(join(f.cwd,'dense.txt')),offset:1,limit:1,cursor:expect.any(String)}});
 const read=await readTool.execute(f.ctx,match.readArgs);if(!read.ok)throw Error(read.error);
 expect(read.data.content).toContain('TARGET');expect(read.data.edit!.range.start).toBeGreaterThan(59000);expect(read.data.editRef).toEqual(expect.any(String));
 expect(await editTool.execute(f.ctx,{editRef:read.data.editRef,oldText:'TARGET',newText:'REPAIRED'})).toMatchObject({ok:true});
 expect(await readFile(join(f.cwd,'dense.txt'),'utf8')).toBe(original.replace('TARGET','REPAIRED'));
});
it.each([{regex:false,padding:''},{regex:true,padding:''},{regex:false,padding:'x'},{regex:true,padding:'x'}])('converts Unicode locations without splitting the preview: $regex / $padding',async({regex,padding})=>{
 const original='😀'.repeat(5000)+padding+'TARGET'+'中'.repeat(2000),f=await fixture(original);
 const {matches}=await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET',regex});const m=matches[0];
 expect(m.column).toBe(10001+padding.length);expect(m.text).toContain('TARGET');expect(Buffer.byteLength(m.text,'utf8')).toBeLessThanOrEqual(2000);expect(Buffer.from(m.text).toString('utf8')).toBe(m.text);
 expect(original.slice(m.textOffset,m.textOffset+m.text.length)).toBe(m.text);
 const r=await readTool.execute(f.ctx,m.readArgs);if(!r.ok)throw Error(r.error);expect(r.data.content).toContain('TARGET');
 expect(original.slice(r.data.edit!.range.start,r.data.edit!.range.end)).toBe(r.data.content);
});
it.each(['\n','\r\n'])('reads long matches on a later line with exact global anchors (%j)',async newline=>{
 const original='header😀'+newline+'x'.repeat(4000)+'TARGET'+newline+'tail',f=await fixture(original);
 for(const regex of [false,true]){
  const {matches}=await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET',regex});const args=matches[0].readArgs;
  expect(args.offset).toBe(2);const r=await readTool.execute(f.ctx,args);if(!r.ok)throw Error(r.error);
  expect(r.data.content).toContain('TARGET');expect(original.slice(r.data.edit!.range.start,r.data.edit!.range.end)).toBe(r.data.content);
 }
});
it('rejects a changed search view before treating a search cursor as current source',async()=>{
 const f=await fixture('x'.repeat(60000)+'TARGET'),result=await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET'});
 await writeFile(join(f.cwd,'dense.txt'),'y'.repeat(60000)+'TARGET');
 expect(await readTool.execute(f.ctx,result.matches[0].readArgs)).toMatchObject({ok:false,error:expect.stringContaining('stale')});
});
it.each([false,true])('preserves a UTF-8 BOM when binding the search view, regex=%s',async regex=>{
 const text='\uFEFF'+'x'.repeat(60000)+'TARGET',f=await fixture(text),result=await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET',regex});
 const match=result.matches[0];expect(match.column).toBe(text.indexOf('TARGET')+1);
 const r=await readTool.execute(f.ctx,match.readArgs);if(!r.ok)throw Error(r.error);expect(r.data.content).toContain('TARGET');
});
it('keeps short-line result shapes unchanged',async()=>{
 const f=await fixture('TARGET\n');
 expect((await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET'})).matches).toEqual([{path:'dense.txt',line:1,text:'TARGET'}]);
});
it.each([false,true])('skips non-UTF-8 files that native read cannot consume, regex=%s',async regex=>{
 const f=await fixture('TARGET\n');await writeFile(join(f.cwd,'invalid.txt'),Buffer.from([0xff,...Buffer.from('TARGET')]));
 expect((await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET',regex})).matches).toEqual([{path:'dense.txt',line:1,text:'TARGET'}]);
});
it('keeps inherited ripgrep configuration from changing the native source view',async()=>{
 const f=await fixture('TARGET\n'),config=join(f.cwd,'rg-config');await writeFile(config,'--unknown-compositor-fixture-flag\n');
 const previous=process.env.RIPGREP_CONFIG_PATH;process.env.RIPGREP_CONFIG_PATH=config;
 try{expect((await queryProject({cwd:f.cwd,action:'grep',pattern:'TARGET',regex:true})).matches).toEqual([{path:'dense.txt',line:1,text:'TARGET'}]);}
 finally{if(previous===undefined)delete process.env.RIPGREP_CONFIG_PATH;else process.env.RIPGREP_CONFIG_PATH=previous;}
});
