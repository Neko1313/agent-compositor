import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {prepareReleases,statePath,commitChange,changelogEntry} from './release-plan.mjs';
import {releaseNotes} from './release-notes.mjs';
const roots=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const git=(root,...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
async function file(root,path,value){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');}
function commit(root,message){git(root,'add','.');git(root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm',message);return git(root,'rev-parse','HEAD');}
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'plugin-prepare-'));roots.push(root);git(root,'init','-q');
 for(const name of ['alpha','bravo']){
  await file(root,`plugins/${name}/plugin.json`,{name,version:'1.2.3'});
  await file(root,`plugins/${name}/hooks.ts`,'export default {};\n');
  await file(root,`plugins/${name}/CHANGELOG.md`,'# Changelog\n\n## 1.2.3\n\nPrevious release.\n\n## 1.2.0\n\nOlder history.\n');
 }
 await file(root,'.claude-plugin/marketplace.json',{name:'fixture',metadata:{version:'2.0.0'},plugins:[{name:'alpha',version:'1.2.3',source:'./plugins/alpha'},{name:'bravo',version:'1.2.3',source:{source:'archive',assets:{}}}]});
 await file(root,'packages/shared.ts','export const shared=1;\n');
 await file(root,'package-lock.json',{packages:{'node_modules/runtime':{version:'1.0.0'},'node_modules/documentation':{version:'1.0.0'}}});
 const bootstrap=commit(root,'chore: initial packages');
 await file(root,statePath,{schemaVersion:1,bootstrap,repository:'owner/repository',plugins:{}});commit(root,'chore: configure automation');
 return root;
}
const inputs=async()=>[];
it('batches versions/changelogs/catalog changes and becomes a no-op after the generated PR merges',async()=>{
 const root=await fixture();
 await file(root,'plugins/alpha/hooks.ts','export const feature=1;');commit(root,'feat(alpha): add navigation');
 await file(root,'plugins/alpha/hooks.ts','export const feature=2;');commit(root,'fix(alpha): correct navigation');
 await file(root,'plugins/bravo/README.md','Updated guide');commit(root,'docs: explain bravo');
 const plan=await prepareReleases(root,{write:true,inputs});
 expect(plan.plugins).toMatchObject([{name:'alpha',previous:'1.2.3',version:'1.3.0',level:'minor'}]);
 expect(plan.plugins[0].commits).toHaveLength(2);
 const catalog=JSON.parse(await readFile(join(root,'.claude-plugin/marketplace.json'),'utf8'));
 expect(catalog.metadata.version).toBe('2.0.1');expect(catalog.plugins[0].version).toBe('1.3.0');
 const notes=await readFile(join(root,'plugins/alpha/CHANGELOG.md'),'utf8');
 expect(notes).toContain('## 1.2.3');expect(notes).toContain('add navigation');expect(notes).toContain('correct navigation');
 expect(releaseNotes(notes,'1.3.0')).not.toContain('Previous release');
 commit(root,'chore(release): prepare plugin versions');
 expect(await prepareReleases(root,{inputs})).toMatchObject({plugins:[],files:[]});
});
it('bumps only plugins whose bundled workspace inputs changed and honors breaking bodies',async()=>{
 const root=await fixture();await file(root,'packages/shared.ts','export const shared=2;');commit(root,'refactor: change shared contract\n\nBREAKING CHANGE: replace the shared interface');
 const result=await prepareReleases(root,{write:true,inputs:async(_,name)=>name==='alpha'?['packages/shared.ts']:[]});
 expect(result.plugins).toMatchObject([{name:'alpha',version:'2.0.0',level:'major'}]);
 expect(await readFile(join(root,'plugins/alpha/CHANGELOG.md'),'utf8')).toContain('replace the shared interface');
});
it('treats distribution changes as changes to every plugin artifact',async()=>{
 const root=await fixture();await file(root,'tools/release/licenses.mjs','export const corrected=true;');commit(root,'fix(build): preserve bundled licenses');
 const result=await prepareReleases(root,{inputs});expect(result.plugins.map(p=>[p.name,p.version])).toEqual([['alpha','1.2.4'],['bravo','1.2.4']]);
});
it('leaves published archive entries pinned while preparing a newer source version',async()=>{
 const root=await fixture();await file(root,'plugins/bravo/hooks.ts','export const corrected=true;');commit(root,'fix(bravo): recover after failure');
 const result=await prepareReleases(root,{write:true,inputs});expect(result.plugins[0].version).toBe('1.2.4');
 const catalog=JSON.parse(await readFile(join(root,'.claude-plugin/marketplace.json'),'utf8'));
 expect(catalog.plugins[1].version).toBe('1.2.3');expect(catalog.metadata.version).toBe('2.0.0');
});
it('refreshes development descriptions from manifests while preserving published metadata',async()=>{
 const root=await fixture(),path='.claude-plugin/marketplace.json';
 const catalog=JSON.parse(await readFile(join(root,path),'utf8'));
 for(const entry of catalog.plugins)entry.description='Previous published behavior';
 await file(root,path,catalog);
 for(const name of ['alpha','bravo'])await file(root,`plugins/${name}/plugin.json`,{name,version:'1.2.3',description:'Updated task-context behavior'});
 commit(root,'fix: describe the current approval behavior');
 await prepareReleases(root,{write:true,inputs});
 const prepared=JSON.parse(await readFile(join(root,path),'utf8'));
 expect(prepared.plugins[0]).toMatchObject({version:'1.2.4',description:'Updated task-context behavior'});
 expect(prepared.plugins[1]).toEqual(catalog.plugins[1]);
 commit(root,'chore(release): prepare plugin versions');
 expect(await prepareReleases(root,{inputs})).toMatchObject({plugins:[],files:[]});
});
it('does not bump for documentation/tests or unrelated lockfile dependencies',async()=>{
 const root=await fixture();await file(root,'plugins/alpha/README.md','New guide');await file(root,'plugins/alpha/test/unit.test.ts','fixture');
 await file(root,'package-lock.json',{packages:{'node_modules/runtime':{version:'1.0.0'},'node_modules/documentation':{version:'2.0.0'}}});commit(root,'docs: improve site and examples');
 const bundled=async(_,name)=>name==='alpha'?['node_modules/runtime/index.js']:[];
 expect(await prepareReleases(root,{inputs:bundled})).toMatchObject({plugins:[],files:[]});
 await file(root,'package-lock.json',{packages:{'node_modules/runtime':{version:'1.1.0'},'node_modules/documentation':{version:'2.0.0'}}});commit(root,'fix(deps): update bundled runtime');
 expect((await prepareReleases(root,{inputs:bundled})).plugins).toMatchObject([{name:'alpha',version:'1.2.4'}]);
});
it('refuses dirty checkouts without overwriting developer changes',async()=>{
 const root=await fixture();const path=join(root,'plugins/alpha/plugin.json'),before=await readFile(path,'utf8');
 await file(root,'plugins/alpha/hooks.ts','uncommitted work');
 await expect(prepareReleases(root,{write:true,inputs})).rejects.toThrow('clean committed checkout');
 expect(await readFile(path,'utf8')).toBe(before);
});
it('advances the catalog even when a previous manual development bump is already present',async()=>{
 const root=await fixture(),path='.claude-plugin/marketplace.json';
 const catalog=JSON.parse(await readFile(join(root,path),'utf8'));catalog.metadata.version='2.0.1';
 await file(root,path,catalog);await file(root,'plugins/alpha/hooks.ts','export const corrected=true;');commit(root,'fix(alpha): correct runtime');
 expect(await prepareReleases(root,{inputs})).toMatchObject({catalogVersion:'2.0.2'});
});
it('uses the real Bun input graph in the CLI and never executes plugin entry points',async()=>{
 const root=await fixture();await file(root,'plugins/alpha/hooks.ts',"import {shared} from '../../packages/shared'; throw Error('must not execute'); export {shared};");commit(root,'feat(alpha): use bundled helper');
 const script=resolve('tools/plugins/release-plan.mjs');
 const result=JSON.parse(execFileSync('bun',[script,'--write'],{cwd:root,encoding:'utf8'}));
 expect(result.plugins).toMatchObject([{name:'alpha',version:'1.3.0'}]);
 commit(root,'chore(release): prepare plugin versions');
 expect(JSON.parse(execFileSync('bun',[script],{cwd:root,encoding:'utf8'}))).toMatchObject({plugins:[],files:[]});
 const metadata=resolve('tools/plugins/release-metadata.mjs'),env={...process.env,PLUGIN_RELEASE_TAG:'plugin/alpha/v1.3.0'};
 expect(JSON.parse(execFileSync('bun',[metadata],{cwd:root,encoding:'utf8',env}))).toMatchObject({name:'alpha',version:'1.3.0'});
 await file(root,'packages/shared.ts','export const shared=42;');commit(root,'fix: repair the helper');
 expect(JSON.parse(execFileSync('bun',[script],{cwd:root,encoding:'utf8'})).plugins).toMatchObject([{name:'alpha',version:'1.3.1'}]);
 expect(()=>execFileSync('bun',[metadata],{cwd:root,encoding:'utf8',env,stdio:'pipe'})).toThrow(/unprepared runtime changes/);
});
it('extracts only the requested release and recognizes both breaking markers',()=>{
 expect(commitChange('feat(alpha)!: replace API').level).toBe('major');
 expect(commitChange('fix: correct behavior').level).toBe('patch');
 expect(commitChange('ordinary maintenance').level).toBe('patch');
 expect(changelogEntry('1.0.1',[{sha:'a'.repeat(40),message:'fix: render {value} <tag>'}],'owner/repository')).toContain('render \\{value\\} \\<tag\\>');
 expect(()=>releaseNotes('# Changelog\n\n## 1.0.0\nOld\n','1.1.0')).toThrow('Missing');
});
it('keeps a new plugin at its initial version without rewriting its manifest in the generated PR',async()=>{
 const root=await fixture(),manifest='{"name":"charlie","version":"0.1.0"}\n';
 await file(root,'plugins/charlie/plugin.json',manifest);await file(root,'plugins/charlie/hooks.ts','export default {};');await file(root,'plugins/charlie/CHANGELOG.md','# Changelog\n\n## 0.1.0\n\nInitial draft.\n');
 const base=commit(root,'feat(charlie): add a new plugin');
 const result=await prepareReleases(root,{write:true,inputs});expect(result.plugins).toMatchObject([{name:'charlie',version:'0.1.0'}]);
 expect(await readFile(join(root,'plugins/charlie/plugin.json'),'utf8')).toBe(manifest);
 execFileSync('bun',[resolve('tools/plugins/changed.mjs'),base,'--strict'],{cwd:root,stdio:'pipe'});
 commit(root,'chore(release): prepare plugin versions');expect(await prepareReleases(root,{inputs})).toMatchObject({files:[]});
});

it('certifies an immutable candidate without creating or changing plugin tags',async()=>{
 const root=await fixture(),sha=git(root,'rev-parse','HEAD'),metadata=resolve('tools/plugins/release-metadata.mjs');
 const before=git(root,'show-ref','--head');
 const result=JSON.parse(execFileSync('bun',[metadata],{cwd:root,encoding:'utf8',env:{...process.env,PLUGIN_RELEASE_TAG:'',PLUGIN_CANDIDATE_NAME:'alpha',PLUGIN_CANDIDATE_SHA:sha}}));
 expect(result).toEqual({name:'alpha',version:'1.2.3',tag:'plugin/alpha/v1.2.3',sha,mode:'candidate'});
 expect(git(root,'show-ref','--head')).toBe(before);
 expect(git(root,'status','--porcelain')).toBe('');
 await file(root,'plugins/alpha/hooks.ts','export const changed=true;');const changed=commit(root,'feat(alpha): extend behavior');
 expect(()=>execFileSync('bun',[metadata],{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,PLUGIN_RELEASE_TAG:'',PLUGIN_CANDIDATE_NAME:'alpha',PLUGIN_CANDIDATE_SHA:changed}})).toThrow(/unprepared runtime changes/);
});

it('refuses ambiguous, mutable and mismatched candidate selections before certification',async()=>{
 const root=await fixture(),sha=git(root,'rev-parse','HEAD'),metadata=resolve('tools/plugins/release-metadata.mjs');
 const base={...process.env,PLUGIN_RELEASE_TAG:'',PLUGIN_CANDIDATE_NAME:'alpha',PLUGIN_CANDIDATE_SHA:sha};
 for(const override of [
  {PLUGIN_RELEASE_TAG:'plugin/alpha/v1.2.3'},
  {PLUGIN_CANDIDATE_NAME:''}, {PLUGIN_CANDIDATE_NAME:'../alpha'},
  {PLUGIN_CANDIDATE_SHA:''}, {PLUGIN_CANDIDATE_SHA:'main'},
  {PLUGIN_CANDIDATE_SHA:sha.slice(0,7)}, {PLUGIN_CANDIDATE_SHA:'a'.repeat(40)},
 ])expect(()=>execFileSync('bun',[metadata],{cwd:root,encoding:'utf8',stdio:'pipe',env:{...base,...override}})).toThrow();
});

it('excludes packaging history predating a new plugin from its initial release',async()=>{
 const root=await fixture();await file(root,'tools/plugins/build.mjs','export const oldPackaging=1;');const older=commit(root,'feat!: replace historical packaging');
 await file(root,'plugins/charlie/plugin.json',{name:'charlie',version:'0.1.0'});await file(root,'plugins/charlie/hooks.ts','export default {};');const created=commit(root,'feat(charlie): introduce CI inspection');
 const result=await prepareReleases(root,{write:true,inputs}),entry=result.plugins.find(p=>p.name==='charlie');
 expect(entry).toMatchObject({previous:null,version:'0.1.0',level:'minor',commits:[created]});expect(entry.paths).not.toContain('tools/plugins/build.mjs');
 const notes=await readFile(join(root,'plugins/charlie/CHANGELOG.md'),'utf8');expect(notes).toContain('introduce CI inspection');expect(notes).not.toContain(older.slice(0,7));expect(notes).not.toContain('historical packaging');
});
it('includes bundled changes after a new plugin is introduced while excluding earlier helper history',async()=>{
 const root=await fixture();await file(root,'packages/shared.ts','export const shared=2;');const older=commit(root,'fix: old helper repair');
 await file(root,'plugins/charlie/plugin.json',{name:'charlie',version:'0.1.0'});await file(root,'plugins/charlie/hooks.ts','export default {};');const created=commit(root,'feat(charlie): introduce helper client');
 await file(root,'packages/shared.ts','export const shared=3;');const later=commit(root,'fix: new helper repair');
 const result=await prepareReleases(root,{write:true,inputs:async(_,name)=>name==='charlie'?['packages/shared.ts']:[]}),entry=result.plugins.find(p=>p.name==='charlie');
 expect(entry.commits).toEqual([created,later]);expect(entry.paths).toContain('packages/shared.ts');const notes=await readFile(join(root,'plugins/charlie/CHANGELOG.md'),'utf8');expect(notes).toContain('new helper repair');expect(notes).not.toContain(older.slice(0,7));expect(notes).not.toContain('old helper repair');
});
