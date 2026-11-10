/** Maintainer migration: bind only the requirement-specific oracles actually registered by the domain suites. */
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {requirementIds,requiredCases} from '@agent-compositor/loader';
import {behaviorRequirements} from './behavior/index.js';
for(const entry of await readdir('plugins',{withFileTypes:true})){
 if(!entry.isDirectory()||entry.name==='notify-done')continue;
 const path=`plugins/${entry.name}/plugin.test.json`,plan=JSON.parse(await readFile(path,'utf8'));
 const required=new Set<string>(requiredCases(plan.profiles,'pr').map(r=>r.id));
 const observed=(await behaviorRequirements(entry.name)).filter(id=>requirementIds.includes(id as any)&&required.has(id));
 if(!observed.length)throw Error('No domain oracle for '+entry.name);
 plan.cases=plan.cases.filter((c:any)=>!['domain-behavior','domain-artifact','composite-contract','composite-artifact'].includes(c.id));
 const base={setup:'The actual package is loaded through the public SDK into isolated projects/homes with filesystem-backed state, controllable dependencies and real local HTTP/process fixtures.',expect:['Every declared requirement has an executed assertion body and a recorded per-requirement observation.','Errors, denied actions, cancelled work and restarted state retain their documented effects.'],forbidden:['False success, leaked scope/private input, unfinished child processes, silent lost writes or source-only behavior substituting for archive behavior.'],timeoutMs:180000};
 for(const kind of ['deterministic','artifact'])plan.cases.push({...base,id:kind==='artifact'?'domain-artifact':'domain-behavior',kind,requirements:observed,run:{runner:'scenario',file:'tools/plugins/behavior-scenario.ts',args:[]}});
 if(required.has('composite.lifecycle'))for(const kind of ['deterministic','artifact'])plan.cases.push({...base,id:kind==='artifact'?'composite-artifact':'composite-contract',kind,requirements:['composite.lifecycle'],expect:['All actual components retain their behavior after reload, fresh process, synthetic contract-preserving update, rollback, disable and re-enable.','Real preceding-release compatibility remains a separate pinned release requirement.'],timeoutMs:300000,run:{runner:'scenario',file:'tools/plugins/behavior-scenario.ts',args:['--composite']}});
 await writeFile(path,JSON.stringify(plan,null,2)+'\n');
}
