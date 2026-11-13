import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readTool,editTool,registerDefaultResolvers,UndoStore,type ToolContext} from '../src/index.js';
import {decodeReadCursor,encodeReadCursor} from '../src/read-cursor.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(text:string){
 const cwd=await mkdtemp(join(tmpdir(),'read-cursor-'));roots.push(cwd);await writeFile(join(cwd,'data.txt'),text);
 const handlers=new Map<string,(p:any)=>Promise<any>>();registerDefaultResolvers({on:(name,handler)=>{handlers.set(name,handler);}},{root:cwd});
 const calls:any[]=[];
 const ctx:ToolContext={cwd,signal:new AbortController().signal,undo:new UndoStore(),request:async(name,payload)=>{calls.push({name,payload:structuredClone(payload)});return handlers.get(name)!(payload);}};
 return{cwd,ctx,calls};
}

it('bounds a dense single-line read and reaches its entire suffix through stateless cursors',async()=>{
 const text='x'.repeat(65000)+'THE-END',f=await fixture(text);let cursor:string|undefined,content='',pages=0;
 do{
  const result=await readTool.execute(f.ctx,{path:'data.txt',cursor});if(!result.ok)throw Error(result.error);
  expect([...result.data.content].length).toBeLessThanOrEqual(16000);
  expect(result.data.edit!.range).toEqual({start:content.length,end:content.length+result.data.content.length});
  expect(text.slice(result.data.edit!.range.start,result.data.edit!.range.end)).toBe(result.data.content);
  expect(result.data.editRef).toEqual(expect.any(String));
  expect(result.data.nextOffset).toBeUndefined();content+=result.data.content;cursor=result.data.nextCursor;pages++;
  expect(result.data.truncated).toBe(!!cursor);
 }while(cursor&&pages<10);
 expect(pages).toBe(5);expect(content).toBe(text);
 expect(f.calls.every(c=>c.name==='service.file.read'&&Object.keys(c.payload).every(k=>['path','offset','limit'].includes(k)))).toBe(true);
});

it('keeps Unicode code points intact and returns edit anchors for the exact chunk',async()=>{
 const f=await fixture('A😀中Z'),first=await readTool.execute(f.ctx,{path:'data.txt',maxChars:1});if(!first.ok)throw Error(first.error);
 const second=await readTool.execute(f.ctx,{path:'data.txt',cursor:first.data.nextCursor,maxChars:1});if(!second.ok)throw Error(second.error);
 expect(second.data.content).toBe('😀');expect(second.data.edit!.range).toEqual({start:1,end:3});
 expect(await editTool.execute(f.ctx,{editRef:second.data.editRef,oldText:'😀',newText:'👻'})).toMatchObject({ok:true});
 expect(await readFile(join(f.cwd,'data.txt'),'utf8')).toBe('A👻中Z');
 expect(await readTool.execute(f.ctx,{path:'data.txt',cursor:second.data.nextCursor})).toMatchObject({ok:false,error:expect.stringContaining('stale')});
});

it.each(['\n','\r\n'])('finishes a character window before exposing the next line offset (%j)',async newline=>{
 const text=['one','two','three'].join(newline),f=await fixture(text),parts:string[]=[];let cursor:string|undefined;
 do{
  const r=await readTool.execute(f.ctx,{path:'data.txt',...(cursor?{cursor}:{offset:1,limit:2}),maxChars:2});if(!r.ok)throw Error(r.error);
  parts.push(r.data.content);cursor=r.data.nextCursor;
  expect(r.data.nextOffset).toBe(cursor?undefined:3);
 }while(cursor&&parts.length<10);
 expect(parts.join('')).toBe(text.split('\n').slice(0,2).join('\n'));
 expect(await readTool.execute(f.ctx,{path:'data.txt',offset:3})).toMatchObject({ok:true,data:{content:'three',truncated:false}});
});

it('rejects a cursor for another path or a conflicting line window without reading',async()=>{
 const f=await fixture('abcdef'),r=await readTool.execute(f.ctx,{path:'data.txt',maxChars:2});if(!r.ok)throw Error(r.error);
 const before=f.calls.length;
 for(const args of [{path:'other.txt'},{path:'data.txt',offset:2},{path:'data.txt',limit:1}])
  expect(await readTool.execute(f.ctx,{...args,cursor:r.data.nextCursor})).toMatchObject({ok:false});
 expect(f.calls).toHaveLength(before);
});

it.each([0,1.5,16001])('rejects invalid character bound %s before reading',async maxChars=>{
 const f=await fixture('text');expect(await readTool.execute(f.ctx,{path:'data.txt',maxChars})).toMatchObject({ok:false,error:expect.stringContaining('maxChars')});expect(f.calls).toHaveLength(0);
});

it.each(['garbage','read-v2:eA','read-v1:eA','read-v1:'+ 'x'.repeat(16384)])('rejects malformed cursors before reading',async cursor=>{
 const f=await fixture('text');expect(await readTool.execute(f.ctx,{path:'data.txt',cursor})).toMatchObject({ok:false,error:expect.stringContaining('cursor')});expect(f.calls).toHaveLength(0);
});

it('continues with a fresh tool context and leaves the caller arguments untouched',async()=>{
 const f=await fixture('abcdef'),first=await readTool.execute(f.ctx,{path:'data.txt',maxChars:2});if(!first.ok)throw Error(first.error);
 const args={path:'data.txt',cursor:first.data.nextCursor,maxChars:2},before=structuredClone(args);
 const fresh={...f.ctx,undo:new UndoStore()};
 expect(await readTool.execute(fresh,args)).toMatchObject({ok:true,data:{content:'cd',truncated:true}});expect(args).toEqual(before);
});

it('rejects a forged cursor boundary inside a surrogate pair',async()=>{
 const f=await fixture('A😀Z'),first=await readTool.execute(f.ctx,{path:'data.txt',maxChars:1});if(!first.ok)throw Error(first.error);
 const cursor=encodeReadCursor({...decodeReadCursor(first.data.nextCursor),index:2});
 expect(await readTool.execute(f.ctx,{path:'data.txt',cursor})).toMatchObject({ok:false,error:expect.stringContaining('invalid boundary')});
});

it('paginates custom service content without preserving an incompatible whole-window anchor',async()=>{
 const f=await fixture('abcdef'),ctx={...f.ctx,request:async()=>({content:'abcdef',totalLines:1,truncated:false,edit:{path:join(f.cwd,'data.txt'),expectedHash:'a'.repeat(64),range:{start:0,end:7},strict:true}})} as ToolContext;
 const first=await readTool.execute(ctx,{path:'data.txt',maxChars:2});if(!first.ok)throw Error(first.error);
 expect(first.data.content).toBe('ab');expect(first.data.edit).toBeUndefined();expect(first.data.editRef).toBeUndefined();
 expect(await readTool.execute(ctx,{path:'data.txt',cursor:first.data.nextCursor,maxChars:2})).toMatchObject({ok:true,data:{content:'cd'}});
});
