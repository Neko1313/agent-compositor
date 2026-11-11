import {it,expect} from 'vitest';
import {FormDialog} from '../src/form.js';
const key=(key:string)=>({kind:'key' as const,key});
const text=(text:string)=>({kind:'text' as const,text});
for(const type of ['text','url','password'] as const)for(const value of ['😀','👩🏽‍💻','e\u0301','🇯🇵']){
 it(type+' Backspace removes complete '+value,()=>{
  const d=new FormDialog({title:'Settings',fields:[{id:'value',label:'Value',type}],actions:[{id:'save',label:'Save'}]});
  d.handle(text('A'+value));d.handle(key('backspace'));d.handle(text('B'));expect(d.values.value).toBe('AB');expect(d.cursor).toBe(2);
 });
 it(type+' navigation and Delete preserve whole '+value,()=>{
  const d=new FormDialog({title:'Settings',fields:[{id:'value',label:'Value',type}],actions:[{id:'save',label:'Save'}]});
  d.handle(text('A'+value+'B'));d.handle(key('left'));d.handle(key('left'));d.handle(key('delete'));d.handle(text('C'));d.handle(key('right'));d.handle(text('D'));expect(d.values.value).toBe('ACBD');
 });
}
it('never stores a split surrogate at the existing 4096-unit form limit',()=>{
 const d=new FormDialog({title:'Settings',fields:[{id:'value',label:'Value',type:'text'}],actions:[{id:'save',label:'Save'}]});
 d.handle(text('a'.repeat(4095)+'😀'));const result=String(d.values.value);expect(result.length).toBeLessThanOrEqual(4096);expect(new TextDecoder().decode(new TextEncoder().encode(result))).toBe(result);expect(d.cursor).toBe(result.length);
});
it('keeps password content private while editing complex graphemes',()=>{
 const d=new FormDialog({title:'Settings',fields:[{id:'value',label:'Password',type:'password'}],actions:[{id:'save',label:'Save'}]});
 d.handle(text('👩🏽‍💻private'));expect(JSON.stringify(d.visible(12,8))).not.toContain('private');expect(JSON.stringify(d.visible(12,8))).not.toContain('👩');
});
