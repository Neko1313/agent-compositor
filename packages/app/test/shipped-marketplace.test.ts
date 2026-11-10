import {afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {marketplaces} from '../src/marketplaces.js';
import {DEFAULT_MARKETPLACE_REPOSITORY} from '../src/bundled-marketplace.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(version='1.0.0',source:any='./plugins/probe'){
 const root=await mkdtemp(join(tmpdir(),'ac-shipped-market-'));roots.push(root);
 const shipped=join(root,'shipped'),git=join(root,'git'),global=join(root,'home'),cwd=join(root,'project');
 for(const dir of [shipped,git]){await mkdir(join(dir,'plugins/probe'),{recursive:true});await mkdir(join(dir,'.claude-plugin'));await writeFile(join(dir,'plugins/probe/plugin.json'),JSON.stringify({name:'probe',version:'1.0.0',trust:'trusted'}));}
 await mkdir(global);await mkdir(cwd);await writeFile(join(shipped,'VERSION'),'v0.4.0');
 const catalog={name:'agent-compositor',owner:{name:'Fixture'},plugins:[{name:'probe',version,source,compositor:{format:'native'}}]};
 for(const dir of [shipped,git])await writeFile(join(dir,'.claude-plugin/marketplace.json'),JSON.stringify(catalog));
 await writeFile(join(global,'marketplaces.json'),JSON.stringify({'agent-compositor':{source:DEFAULT_MARKETPLACE_REPOSITORY,ref:'main',root:git,commit:'a'.repeat(40),scope:'user'}}));
 return{shipped,manager:await marketplaces(cwd,root,join(root,'state'),global,shipped)};
}
it('uses the self-contained shipped snapshot when an official Git catalog names the same package version',async()=>{const f=await fixture();expect(await f.manager.source('probe@agent-compositor')).toMatchObject({version:'1.0.0',directory:join(f.shipped,'plugins/probe')});});
it('refuses unreleased raw first-party versions instead of installing incomplete source over a working package',async()=>{const f=await fixture('1.1.0');await expect(f.manager.source('probe@agent-compositor')).rejects.toThrow('published archive entry');});
it('accepts a pinned independent release even when its version is newer than the bundled snapshot',async()=>{
 const archive={url:'https://artifacts.example/probe-1.1.0.tar.gz',sha256:'a'.repeat(64)},f=await fixture('1.1.0',{source:'archive',assets:{[`${process.platform}-${process.arch}`]:archive}});
 expect(await f.manager.source('probe@agent-compositor')).toMatchObject({version:'1.1.0',archive});
});
