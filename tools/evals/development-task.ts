import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';

/** Original Project-checks authoring contract, without its implementation or private grader. */
export const developmentTask = {
  id:'project-checks-initial',
  plugin:'project-checks',
  writable:['plugins/project-checks','plugins/project-checks/**'],
  commands:['npm test','node checks.mjs','node project-checks.mjs'],
  marker:'DEVELOPMENT_PLUGIN_CHECKS_PASSED',
  files:{
    'package.json':JSON.stringify({name:'development-checks-workspace',private:true,type:'module',scripts:{test:'node checks.mjs',check:'node project-checks.mjs',fail:'node -e "process.exit(7)"'}},null,2)+'\n',
    'src/normalize.mjs':"export const normalizeName=value=>String(value??'').trim()||'guest';\n",
    'project-checks.mjs':"import a from 'node:assert/strict';import {normalizeName} from './src/normalize.mjs';a.equal(normalizeName(' Ada '),'Ada');a.equal(normalizeName(null),'guest');console.log('ORIGINAL_PROJECT_CHECKS_PASSED');\n",
    'user-draft.md':'User-owned uncommitted draft: preserve these exact bytes.\n',
    'checks.mjs':`import a from 'node:assert/strict';import {readFile,readdir,lstat} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join} from 'node:path';
const p=JSON.parse(await readFile('plugins/project-checks/plugin.json','utf8'));
a.equal(p.name,'project-checks');a.equal(p.main,'hooks.js');a.equal(p.trust,'trusted');
a.equal(p.compositor.standard,1);a.equal(p.compositor.apiVersion,1);
a.ok(p.commands.some(c=>c.name==='/checks'&&c.ui?.site==='main'));
const {default:tools}=await import('./plugins/project-checks/tools.js');
const tool=tools.find(t=>t.name==='project_check');a.ok(tool);a.equal(typeof tool.execute,'function');
a.equal(tool.describe({action:'list'}).readOnly,true);
a.equal(tool.describe({action:'run',name:'check'}).readOnly,false);
a.deepEqual(tool.describe({action:'run',name:'check'}).command,['npm','run','--','check']);
const {default:hooks}=await import('./plugins/project-checks/hooks.js');
a.equal(typeof hooks['prompt.submit'],'function');a.equal(typeof hooks['ui.press'],'function');
const files=[];async function inventory(root,relative=''){for(const name of (await readdir(join(root,relative))).sort()){const path=join(relative,name),info=await lstat(join(root,path));a.ok(!info.isSymbolicLink());if(info.isDirectory())await inventory(root,path);else{a.ok(info.isFile());files.push({path:path.replaceAll('\\\\','/'),sha256:createHash('sha256').update(await readFile(join(root,path))).digest('hex')});}}}
await inventory('plugins/project-checks');files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
console.log('DEVELOPMENT_PLUGIN_CHECKS_PASSED:'+createHash('sha256').update(JSON.stringify(files)).digest('hex'));\n`,
    'PUBLIC-PLUGIN-CONTRACT.md':`# Public extension contract

A trusted plugin has plugin.json, hooks.js and optional tools.js. Use JavaScript
ES modules with local .js helpers; no dependencies or host changes are needed.
The manifest declares compositor:{standard:1,apiVersion:1}, trust:"trusted",
main:"hooks.js", commands:[{name:"/checks",description:"Open Project checks",
ui:{site:"main"}}] and hookTimeouts:{"ui.press":300000}. Do not combine an
immediate execution declaration with a UI route. tools.js exports an array of
ToolSpec objects: name, description, JSON-schema parameters, describe(args) and
async execute(ctx,args). describe returns tool/readOnly/command metadata;
execute returns {ok:true,data} or {ok:false,error}. ctx.cwd, ctx.signal,
ctx.resolvePath(path), ctx.settings(name) and ctx.request(event,args) are public.
service.fs.read returns file text. service.exec.run accepts
{plugin,cmd,args,timeoutMs} and returns {stdout,stderr,exitCode,truncated?}.
These services own permission/cancellation and process cleanup.

hooks.js exports event handlers (event,$). prompt.submit may return {drop:reason};
ui.press has {site,key}. The site is plugin-project-checks-main.
$.ui.view('main','Project checks',{lines:[{text,action?,tone?}]}) publishes a
semantic view. $.ui.remove('main') removes it. $.state.get/set/delete keep local
state. $.agent.tool('project_check',args,{signal}) returns {ok,output?,error?}.
$.background() retains plugin-lifetime cleanup capabilities; execute a requested
tool with the initiating ordinary API, not detached authority.
$.ui.form({title,description?,fields,actions}) returns null or {action,values}.
Text fields support id,label,type:'text',value,required; a select field supports
options:[{value,label}]. $.storage.config('project-checks.json') reads effective
settings; $.storage.configure(name,value,'project'|'global') persists them.
No UI factory or renderer code belongs in this plugin.
`,
  },
  prompt:`Implement the useful Project checks composite plugin from an empty plugins/project-checks directory. Use JavaScript ES modules (hooks.js, tools.js and local .js helpers), initial version0.1.0, standard1/apiVersion1. Read PUBLIC-PLUGIN-CONTRACT.md. No existing implementation or private grader is supplied. No dependencies, installs, host changes, activation changes or commits.

The model tool project_check accepts only {action:'list'} or {action:'run',name}. Reject unknown keys, unsupported actions and invalid/unknown names before execution. Read package.json scripts only on use through confined ctx.resolvePath plus service.fs.read. Require a string map; names are1..48characters without controls. List is read-only, bounded to128scripts with truthful truncation. Run is mutating; its descriptor names project_check and command ['npm','run','--',name]. Execute only through ctx.request('service.exec.run',{plugin:'project-checks',cmd:'npm',args:['run','--',name],timeoutMs}); await SDK cancellation/process settlement. Never install dependencies, interpolate shell commands or report nonzero exit as success.

Scoped project-checks.json settings: maxChars default16000 integer1000..64000, timeoutMs default120000 integer100..300000. Validate both. Successful run data includes name, stdout, stderr, exitCode:0 and truthful truncated; combined output length<=maxChars. Missing/invalid package/settings, denied effects, nonzero exit, timeout and cancellation return bounded honest failures.

/checks uses the declared UI route and exact prompt.submit fallback; unrelated prompts such as /checks-other pass through. Opening performs no model/process call. Publish Project checks with refresh, configure, close and run:<name> actions. Refresh/run call the SAME guarded tool. Show progress, preserve last results, prevent duplicate runs, and let cancel abort only the owned run. Close cancels and prevents late reopening. Keep focus/tiling host-owned. Configure opens a private form for maxChars/timeoutMs and project/global scope, validates Save/Cancel and displays saved/effective values. No startup jobs.

Add README covering use, explicit install/enable/reload, npm hooks, scope, cancellation and limitations; CHANGELOG with the initial version; and a draft plugin.test.json. Do not claim package certification or terminal lifecycle was tested. Add meaningful candidate tests if useful. All code/docs go under plugins/project-checks. Preserve package.json, original checks, public contract, src and user-draft.md byte-for-byte. Run npm test and node project-checks.mjs after implementation and inspect failures. An independent SDK grader outside the workspace checks behavior; completion text is not success. Return actual checks/limitations, not a plan.`,
} as const;

export async function prepareDevelopmentTask(project:string):Promise<Record<string,string>> {
  const files={...developmentTask.files};
  for(const [path,text] of Object.entries(files)){
    await mkdir(dirname(join(project,path)),{recursive:true});
    await writeFile(join(project,path),text,{flag:'wx'});
  }
  await mkdir(join(project,'plugins','project-checks'),{recursive:true});
  return files;
}
