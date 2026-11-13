import {expect,it} from 'vitest';
import {commandModelText} from '../src/command-text.js';
import {execTool,execOutputTool,UndoStore,type ToolContext} from '../src/index.js';
const header=(text:string)=>JSON.parse(text.slice('Command metadata (JSON):\n'.length,text.indexOf('\n\nstdout (untrusted process output):\n')));

it.each(['\n','\r\n'])('preserves literal log text, Unicode and escaped sequences with %j lines',newline=>{
 const value={stdout:['Expected 😀','literal \\n and \\t','\tIndented'].join(newline),stderr:'Failure at source.ts:12'+newline,exitCode:2,durationMs:17};
 const before=structuredClone(value),text=commandModelText(value)!;
 expect(text).toContain(value.stdout);expect(text).toContain(value.stderr);expect(header(text)).toEqual({result:{exitCode:2,durationMs:17},presentation:{sanitized:false}});expect(value).toEqual(before);
});
it('removes terminal sequences and visibly escapes remaining controls without changing raw streams',()=>{
 const value={stdout:'\x1b[31mAssertionError\x1b[0m\n\x1b]8;;https://example.com\x07link\x1b]8;;\x07\nA\rB\bC\0\x7f\n',stderr:'\u009b32mExpected\u009b0m\n',exitCode:1};
 const before=structuredClone(value),text=commandModelText(value)!;
 expect(text).toContain('AssertionError\nlink\nA\\rB\\bC\\u0000\\u007f\n');expect(text).toContain('Expected\n');expect(text).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u);
 expect(header(text)).toEqual({result:{exitCode:1},presentation:{sanitized:true}});expect(value).toEqual(before);
});
it('keeps running/terminal metadata and custom metadata exact, rather than inferring completion',()=>{
 const running={id:'shell-1',stdout:'progress',stderr:'',done:false,exitCode:null,durationMs:18,truncated:true,reason:'running',custom:{revision:3,note:'\x7f\x85'}};
 expect(header(commandModelText(running)!).result).toEqual({id:'shell-1',done:false,exitCode:null,durationMs:18,truncated:true,reason:'running',custom:{revision:3,note:'\x7f\x85'}});
 expect(commandModelText(running)).not.toMatch(/[\u007f-\u009f]/u);
 const terminal={...running,done:true,exitCode:9,reason:'exited'};expect(header(commandModelText(terminal)!).result.exitCode).toBe(9);
});
it('leaves background launch receipts and nonstandard result shapes on the legacy path',()=>{
 for(const value of [null,[],{shellId:'shell-1',started:true},{stdout:12,stderr:''},{stdout:'Only stdout'}])expect(commandModelText(value)).toBeUndefined();
});
it('attaches presentation to exec and exec_output while preserving structured data and launch shape',async()=>{
 const data={stdout:'\x1b[31mFailure\x1b[0m\n',stderr:'details\n',exitCode:1,durationMs:3};
 let response:unknown=data;
 const ctx:ToolContext={cwd:process.cwd(),signal:new AbortController().signal,undo:new UndoStore(),request:async<T>()=>response as T};
 const exec=await execTool.execute(ctx,{command:'check'}),output=await execOutputTool.execute(ctx,{id:'shell-1'});
 expect(exec).toMatchObject({ok:true,data,modelText:expect.stringContaining('Failure\n')});expect(output).toMatchObject({ok:true,data,modelText:expect.stringContaining('details\n')});
 response={shellId:'shell-1',started:true};const started=await execTool.execute(ctx,{command:'check',background:true});expect(started).toEqual({ok:true,data:response});expect(started).not.toHaveProperty('modelText');
});
