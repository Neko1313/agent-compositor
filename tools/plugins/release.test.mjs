import {afterEach,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {writeFixtureCertificates} from './fixtures/certificates.js';
const exec=promisify(execFile),roots=[],generate=resolve('tools/plugins/catalog-entry.mjs'),apply=resolve('tools/plugins/catalog-update.ts');
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const cwd=await mkdtemp(join(tmpdir(),'ac-release-entry-'));roots.push(cwd);await mkdir(join(cwd,'plugins/probe'),{recursive:true});await mkdir(join(cwd,'.claude-plugin'));await mkdir(join(cwd,'artifacts'));
 await writeFile(join(cwd,'plugins/probe/plugin.json'),JSON.stringify({name:'probe',version:'1.2.3'}));
 await writeFile(join(cwd,'.claude-plugin/marketplace.json'),JSON.stringify({name:'test',owner:{name:'Fixture'},metadata:{version:'1.0.0'},plugins:[{name:'probe',version:'1.2.3',source:'./plugins/probe'}]}));
 for(const platform of ['linux-x64','linux-arm64','darwin-x64','darwin-arm64']){
  // Metadata-generation fixtures are deliberately not executable platform artifacts.
  const bytes=Buffer.from('metadata fixture '+platform),file=join(cwd,'artifacts',`probe-1.2.3-${platform}.tar.gz`);await writeFile(file,bytes);await writeFile(file+'.sha256',createHash('sha256').update(bytes).digest('hex')+'  '+file+'\n');
 }
 const assets=Object.fromEntries(await Promise.all(['linux-x64','linux-arm64','darwin-x64','darwin-arm64'].map(async platform=>[platform,{sha256:createHash('sha256').update(await readFile(join(cwd,'artifacts',`probe-1.2.3-${platform}.tar.gz`))).digest('hex')}])));
 await writeFixtureCertificates(cwd,'probe','1.2.3',assets);
 return cwd;
}
it('generates pinned per-platform metadata and applies it as an independent, idempotent catalog update',async()=>{
 const cwd=await fixture();await exec('bun',[generate,'probe',join(cwd,'artifacts')],{cwd,env:{...process.env,GITHUB_REPOSITORY:'example/test'}});
 const path=join(cwd,'artifacts/marketplace-entry.json'),entry=JSON.parse(await readFile(path,'utf8'));
 expect(entry.source.source).toBe('archive');expect(Object.keys(entry.source.assets)).toHaveLength(4);expect(entry.source.assets['linux-x64'].url).toContain('plugin%2Fprobe%2Fv1.2.3');
 await writeFile(join(cwd,'plugins/probe/plugin.json'),JSON.stringify({name:'probe',version:'1.3.0'}));
 await exec('bun',[apply,path],{cwd});let catalog=JSON.parse(await readFile(join(cwd,'.claude-plugin/marketplace.json'),'utf8'));expect(catalog.metadata.version).toBe('1.0.1');expect(catalog.plugins[0]).toEqual(entry);
 await exec('bun',[apply,path],{cwd});catalog=JSON.parse(await readFile(join(cwd,'.claude-plugin/marketplace.json'),'utf8'));expect(catalog.metadata.version).toBe('1.0.1');
});
it('refuses incomplete or corrupted platform artifacts before producing a release entry',async()=>{
 const cwd=await fixture(),file=join(cwd,'artifacts/probe-1.2.3-linux-arm64.tar.gz');await rm(file);
 await expect(exec('bun',[generate,'probe',join(cwd,'artifacts')],{cwd})).rejects.toThrow();
 await writeFile(file,'corrupted fixture');await expect(exec('bun',[generate,'probe',join(cwd,'artifacts')],{cwd})).rejects.toThrow();
 await expect(readFile(join(cwd,'artifacts/marketplace-entry.json'))).rejects.toMatchObject({code:'ENOENT'});
});

it('can publish a new plugin without listing its unreleased working tree in the public catalog',async()=>{
 const cwd=await fixture(),file=join(cwd,'.claude-plugin/marketplace.json');const catalog=JSON.parse(await readFile(file,'utf8'));catalog.plugins=[];await writeFile(file,JSON.stringify(catalog));
 await exec('bun',[generate,'probe',join(cwd,'artifacts')],{cwd});await exec('bun',[apply,join(cwd,'artifacts/marketplace-entry.json')],{cwd});
 expect(JSON.parse(await readFile(file,'utf8')).plugins[0]).toMatchObject({name:'probe',version:'1.2.3',source:{source:'archive'}});
});
