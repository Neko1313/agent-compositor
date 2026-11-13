import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
vi.mock('@agent-compositor/tools',async importOriginal=>({...await importOriginal<typeof import('@agent-compositor/tools')>(),encodeEditAnchor:undefined}));
import {readSymbol} from '../../../plugins/callix/navigation.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('retains explicit symbol anchors when the host SDK has no reference encoder',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'callix-old-sdk-'));roots.push(cwd);const content='function one(){}';await writeFile(join(cwd,'a.ts'),content);
 const source=await readSymbol({schema_version:1,nodes:[{id:'one',name:'one',qualified_name:'one',kind:'function',file_path:'a.ts',span:[1,1,1,content.length+1]}],relations:[],metadata:{resolver_status:'degraded'}},{cwd,action:'read_symbol',pattern:'one'});
 if(!('content' in source))throw Error('Missing source');
 expect(source.content).toBe(content);expect(source.edit).toMatchObject({path:'a.ts',strict:true,range:{start:0,end:content.length}});expect(source).not.toHaveProperty('editRef');
});
