import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readTool,editTool,registerDefaultResolvers,UndoStore,type ToolContext} from '../src/index.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function context(cwd:string):ToolContext{
 const handlers=new Map<string,(args:any)=>Promise<any>>();registerDefaultResolvers({on:(name,handler)=>{handlers.set(name,handler);}},{root:cwd});
 return{cwd,signal:new AbortController().signal,undo:new UndoStore(),request:async(name,args)=>handlers.get(name)!(args)};
}
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'edit-ref-'));roots.push(cwd);const text='// 👻 café\r\nfirst target\r\nsecond target\r\n';await writeFile(join(cwd,'a.ts'),text);
 const ctx=context(cwd),result=await readTool.execute(ctx,{path:'a.ts',offset:3,limit:1});if(!result.ok)throw Error(result.error);
 const editRef=(result.data as any).editRef;expect(editRef).toEqual(expect.any(String));return{cwd,ctx,text,editRef,anchor:result.data.edit!};
}
it('copies a paged Unicode/CRLF read reference verbatim, confines replacement to that page and keeps guarded undo',async()=>{
 const f=await fixture(),result=await editTool.execute(f.ctx,{path:'a.ts',editRef:JSON.parse(JSON.stringify(f.editRef)),oldText:'target',newText:'updated'} as any);
 expect(result).toMatchObject({ok:true,data:{replacements:1,match:'exact'}});expect(await readFile(join(f.cwd,'a.ts'),'utf8')).toBe(f.text.replace('second target','second updated'));
 const stale=await editTool.execute(f.ctx,{path:'a.ts',editRef:f.editRef,oldText:'updated',newText:'changed'} as any);expect(stale).toMatchObject({ok:false,error:expect.stringContaining('stale')});
 const inverse=f.ctx.undo.pop()!.inverse as any;expect(inverse.expectedHash).toEqual(expect.any(String));expect(inverse.range).toBeDefined();
 expect((await editTool.execute(f.ctx,{path:'a.ts',...inverse})).ok).toBe(true);expect(await readFile(join(f.cwd,'a.ts'),'utf8')).toBe(f.text);expect(f.ctx.undo.size).toBe(1);
});
it('works in a fresh tool context without an in-memory anchor cache',async()=>{
 const f=await fixture(),fresh=context(f.cwd),again=await readTool.execute(fresh,{path:'a.ts',offset:3,limit:1});expect(again).toMatchObject({ok:true,data:{editRef:f.editRef}});
 expect((await editTool.execute(fresh,{path:'a.ts',editRef:f.editRef,oldText:'target',newText:'updated'} as any)).ok).toBe(true);
});
it('uses the reference path when no redundant path is supplied, without mutating arguments',async()=>{
 const f=await fixture(),args={editRef:f.editRef,oldText:'target',newText:'updated'},before=structuredClone(args);
 expect(await editTool.execute(f.ctx,args as any)).toMatchObject({ok:true,data:{path:join(f.cwd,'a.ts'),replacements:1}});
 expect(args).toEqual(before);expect(await readFile(join(f.cwd,'a.ts'),'utf8')).toBe(f.text.replace('second target','second updated'));
});
it.each(['',null,42])('does not replace an explicitly invalid path with a reference path (case %#)',async path=>{
 const f=await fixture();expect(await editTool.execute(f.ctx,{path,editRef:f.editRef,oldText:'target',newText:'updated'} as any)).toMatchObject({ok:false,error:expect.stringContaining('edit.path')});expect(await readFile(join(f.cwd,'a.ts'),'utf8')).toBe(f.text);
});
it('rejects use on a different path even if its entire source has the same hash',async()=>{
 const f=await fixture();await writeFile(join(f.cwd,'other.ts'),f.text);
 expect(await editTool.execute(f.ctx,{path:'other.ts',editRef:f.editRef,oldText:'target',newText:'updated'} as any)).toMatchObject({ok:false,error:expect.stringContaining('path')});
 expect(await readFile(join(f.cwd,'other.ts'),'utf8')).toBe(f.text);expect(f.ctx.undo.size).toBe(0);
});
it.each([{range:{start:0,end:1}},{expectedHash:'0'.repeat(64)},{strict:false}])('rejects conflicting explicit guards %j before any file request',async conflict=>{
 const f=await fixture();let requests=0;const ctx={...f.ctx,request:async()=>{requests++;throw Error('Must not run');}};
 expect(await editTool.execute(ctx,{path:'a.ts',editRef:f.editRef,oldText:'target',newText:'updated',...conflict} as any)).toMatchObject({ok:false,error:expect.stringContaining('conflicts')});expect(requests).toBe(0);
});
it('accepts redundant matching guards and rejects a certain no-op with only a reference',async()=>{
 const f=await fixture();expect(await editTool.execute(f.ctx,{path:'a.ts',editRef:f.editRef,oldText:'target',newText:'target'} as any)).toMatchObject({ok:false,error:expect.stringContaining('identical')});
 expect((await editTool.execute(f.ctx,{...f.anchor,editRef:f.editRef,oldText:'target',newText:'updated'} as any)).ok).toBe(true);
});
it.each([null,42,'','unknown:abc','edit-v1:!','edit-v1:'+Buffer.from('{}').toString('base64url'),'x'.repeat(17000)])('rejects malformed references before requesting services (case %#)',async editRef=>{
 let requests=0;const ctx:ToolContext={cwd:process.cwd(),signal:new AbortController().signal,undo:new UndoStore(),request:async()=>{requests++;throw Error('Must not run');}};
 expect(await editTool.execute(ctx,{path:'a.ts',editRef,oldText:'old',newText:'new'} as any)).toMatchObject({ok:false,error:expect.stringContaining('editRef')});expect(requests).toBe(0);
});
it.each([
 ['relative.ts','0'.repeat(64),0,1],['/a.ts','bad',0,1],['/a.ts','0'.repeat(64),-1,1],['/a.ts','0'.repeat(64),0.5,1],['/a.ts','0'.repeat(64),2,1],['/a.ts','0'.repeat(64),0,Number.MAX_SAFE_INTEGER+1],['/a.ts','0'.repeat(64),0,1,'extra'],
])('rejects invalid encoded selectors before requesting services (case %#)',async(...values)=>{
 let requests=0;const ctx:ToolContext={cwd:process.cwd(),signal:new AbortController().signal,undo:new UndoStore(),request:async()=>{requests++;throw Error('Must not run');}};
 const editRef='edit-v1:'+Buffer.from(JSON.stringify(values)).toString('base64url');
 expect(await editTool.execute(ctx,{path:'a.ts',editRef,oldText:'old',newText:'new'} as any)).toMatchObject({ok:false,error:expect.stringContaining('editRef')});expect(requests).toBe(0);
});
