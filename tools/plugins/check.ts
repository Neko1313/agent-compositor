import {readFile,stat,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {marketplaceSchema} from '../../packages/app/src/marketplaces.js';
import {contained,diskManifestSchema,readPluginTestPlan,SEMVER,compareVersions} from '@agent-compositor/loader';
export async function checkPlugin(root:string,name:string){
  if(!/^[a-z][a-z0-9-]*$/.test(name))throw Error('Invalid plugin name');
  const directory=await contained(root,'plugins/'+name);
  const manifest=diskManifestSchema.parse(JSON.parse(await readFile(join(directory,'plugin.json'),'utf8')));
  if(manifest.name!==name||!SEMVER.test(manifest.version))throw Error('Plugin identity and SemVer are required');
  if(!manifest.compositor)throw Error('First-party plugin must declare compositor.standard and apiVersion');
  await contained(directory,'README.md');
  if(!(await readFile(await contained(directory,'CHANGELOG.md'),'utf8')).includes('## '+manifest.version))throw Error('Changelog must document the current plugin version');
  const plan=await readPluginTestPlan(directory,name);
  for(const suite of plan.tests){
    if(suite.pattern)new RegExp(suite.pattern);
    for(const file of suite.files){if(!(await stat(await contained(root,file))).isFile())throw Error('Test reference must name a file');}
  }
  for(const file of plan.evals??[])await contained(root,file);
  if(plan.visual)await contained(root,plan.visual);
  if(plan.schemaVersion===2){
    for(const c of plan.cases)await contained(root,c.run.file);
    if(plan.modelPolicy){
      const bytes=await readFile(await contained(root,plan.modelPolicy.taskSet),'utf8');
      if(createHash('sha256').update(bytes).digest('hex')!==plan.modelPolicy.taskSetSha256)throw Error('Model task-set checksum differs from its predeclared policy');
      const tasks=JSON.parse(bytes);
      for(const id of ['intended','unrelated','clarify','failure','denied','untrusted','cancel'])if(!tasks.tasks?.some((task:any)=>task.id===id&&typeof task.prompt==='string'&&task.prompt.trim().length>0&&Array.isArray(task.expect)&&task.expect.length))throw Error('Missing model task definition: '+id);
    }
    const ids=plan.cases.map(c=>c.id);
    if(ids.some(id=>id.startsWith('host.')))throw Error('host.* case IDs are reserved for kernel contracts');
    if(manifest.commands?.length&&!plan.profiles.components.includes('command'))throw Error('Declared commands require the command profile');
    if((manifest.provides??[]).some(p=>p.startsWith('service.agent.'))&&!plan.profiles.components.includes('agent-service'))throw Error('Agent service providers require the agent-service profile');
    if(((await stat(join(directory,'tools.ts')).catch(()=>undefined))||(await stat(join(directory,'tools.js')).catch(()=>undefined)))&&!plan.profiles.components.includes('tool'))throw Error('Tools require the tool profile');
    if((await stat(join(directory,'skills')).catch(()=>undefined))&&!plan.profiles.components.includes('skill'))throw Error('Skills require the skill profile');
    if((manifest.mcpServers||(await stat(join(directory,'.mcp.json')).catch(()=>undefined)))&&!plan.profiles.components.includes('mcp'))throw Error('MCP declarations require the MCP profile');
  }
  const catalog=marketplaceSchema.parse(JSON.parse(await readFile(join(root,'.claude-plugin/marketplace.json'),'utf8')));
  const entry=catalog.plugins.find(p=>p.name===name);
  if(entry && (typeof entry.source==='string'?entry.version!==manifest.version:!entry.version||compareVersions(entry.version,manifest.version)>0))throw Error('Catalog version must match its referenced source or an already released version');
  return{directory,manifest,plan};
}
if(import.meta.main){
  const root=resolve(import.meta.dirname,'../..'),name=process.argv[2];
  if(!name)throw Error('Usage: bun tools/plugins/check.ts <plugin> [--test]');
  const result=await checkPlugin(root,name);
  if(process.argv.includes('--test')){
    const output=join(root,'reports/plugins',name);await mkdir(output,{recursive:true});
    const suites=[{files:['tools/plugins/lifecycle.test.ts'],pattern:undefined},...result.plan.tests];
    for(const [index,suite]of suites.entries()){
      const report=join(output,`suite-${index}.xml`);
      execFileSync('npx',['--no-install','vitest','run',...suite.files,...(suite.pattern?['--testNamePattern',suite.pattern]:[]),'--reporter=default','--reporter=junit','--outputFile='+report],{cwd:root,stdio:'inherit',env:{...process.env,PLUGIN_TEST_NAME:name}});
      const xml=await readFile(report,'utf8');
      const summaries=[...xml.matchAll(/<testsuite\s[^>]*tests="(\d+)"[^>]*skipped="(\d+)"/g)];
      if(!summaries.some(match=>Number(match[1])>Number(match[2])))throw Error('A declared test suite ran no tests; fix its files or pattern');
    }
    for(const [index,suite]of (result.plan.evals??[]).entries())execFileSync(process.execPath,['tools/evals/run.ts','--suite',suite,'--models','scripted','--output',join(output,`eval-${index}`)],{cwd:root,stdio:'inherit'});
  }
  console.log(JSON.stringify({plugin:name,version:result.manifest.version,checked:true,tested:process.argv.includes('--test')}));
}
