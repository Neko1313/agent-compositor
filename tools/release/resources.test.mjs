import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, writeFile, readFile, symlink, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyPluginResources} from './resources.mjs';
const roots=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'ac-resources-'));roots.push(root);const source=join(root,'source'),dest=join(root,'dest');await mkdir(source);await mkdir(dest);return{root,source,dest};}
async function file(root,path,text){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),text);}
it('retains skill assets, default MCP config, referenced nested configs and explicitly declared runtime code',async()=>{
 const {source,dest}=await fixture();
 for(const path of ['skills/workflow/SKILL.md','.mcp.json','config/nested/servers.json','mcp/server.mjs','assets/icon.txt','bin/developer-only'])await file(source,path,path);
 await copyPluginResources(source,dest,{mcpServers:['config/nested/servers.json',{local:{command:'node'}}],resources:['mcp']});
 for(const path of ['skills/workflow/SKILL.md','.mcp.json','config/nested/servers.json','mcp/server.mjs','assets/icon.txt'])expect(await readFile(join(dest,path),'utf8')).toBe(path);
 await expect(readFile(join(dest,'bin/developer-only'))).rejects.toMatchObject({code:'ENOENT'});
});
it.each(['../outside','/outside','.','./','./hooks.js','./node_modules/pkg','hooks.js','plugin.json','node_modules/pkg','bin/runtime'])('rejects escaping or bundle-owned resource %s',async path=>{
 const{source,dest}=await fixture();await expect(copyPluginResources(source,dest,{resources:[path]})).rejects.toThrow();
});
it('rejects nested symlinks that escape declared resource directories',async()=>{
 const{root,source,dest}=await fixture();await file(root,'secret','outside');await mkdir(join(source,'mcp'));await symlink(join(root,'secret'),join(source,'mcp/server.mjs'));
 await expect(copyPluginResources(source,dest,{resources:['mcp']})).rejects.toThrow('escapes');
});
it('requires declared config and resources to exist',async()=>{
 const{source,dest}=await fixture();await expect(copyPluginResources(source,dest,{mcpServers:'missing.json'})).rejects.toMatchObject({code:'ENOENT'});
 await expect(copyPluginResources(source,dest,{resources:['missing']})).rejects.toMatchObject({code:'ENOENT'});
});
