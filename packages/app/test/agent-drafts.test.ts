import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
const fileFor=(directory:string,id:string)=>join(directory,'agent-drafts',createHash('sha256').update(id).digest('hex')+'.json');
import {AgentDrafts} from '../src/agent-drafts.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function root(){const value=await mkdtemp(join(tmpdir(),'agent-drafts-'));roots.push(value);return value;}
it('writes only changed drafts privately and serializes overlapping saves',async()=>{
  const directory=await root(),file=fileFor(directory,'one'),store=await AgentDrafts.open(directory,new Set(['one','two']),()=>{});
  await store.flush();await expect(stat(file)).rejects.toMatchObject({code:'ENOENT'});
  store.set('one','first');const first=store.flush();store.set('two','second');const second=store.flush();await Promise.all([first,second]);
  expect(JSON.parse(await readFile(file,'utf8'))).toBe('first');expect(JSON.parse(await readFile(fileFor(directory,'two'),'utf8'))).toBe('second');if(process.platform!=='win32')expect((await stat(file)).mode&0o777).toBe(0o600);
  const reopened=await AgentDrafts.open(directory,new Set(['two']),()=>{});expect(reopened.get('one')).toBeUndefined();expect(reopened.get('two')).toBe('second');
});
it('keeps unsaved data available for retry after a storage failure',async()=>{
  const directory=await root(),blocked=join(directory,'blocked');await mkdir(blocked);
  const store=await AgentDrafts.open(blocked,new Set(['one']),()=>{});await rm(blocked,{recursive:true});await writeFile(blocked,'not a directory');store.set('one','recover me');
  await expect(store.flush()).rejects.toThrow();expect(store.get('one')).toBe('recover me');
  await rm(blocked);await mkdir(blocked);await store.flush();expect(JSON.parse(await readFile(fileFor(blocked,'one'),'utf8'))).toBe('recover me');
});
it('does not overwrite malformed saved drafts during startup',async()=>{
  const directory=await root(),file=fileFor(directory,'one');await mkdir(join(directory,'agent-drafts'));await writeFile(file,'{broken');
  const store=await AgentDrafts.open(directory,new Set(['one']),()=>{});expect(store.loadError).toContain('Unable to read');
  store.set('one','new');await expect(store.flush()).rejects.toThrow('Could not save');
  expect(store.get('one')).toBe('new');expect(await readFile(file,'utf8')).toBe('{broken');
});
it('preserves different agents when two application instances save concurrently',async()=>{
  const directory=await root(),ids=new Set(['one','two']);
  const one=await AgentDrafts.open(directory,ids,()=>{}),two=await AgentDrafts.open(directory,ids,()=>{});
  one.set('one','first instance');two.set('two','second instance');await Promise.all([one.flush(),two.flush()]);
  const restored=await AgentDrafts.open(directory,ids,()=>{});expect(restored.get('one')).toBe('first instance');expect(restored.get('two')).toBe('second instance');
});
