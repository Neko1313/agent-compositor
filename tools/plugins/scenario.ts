/** Protocol for real PTY/model/artifact scenarios. Assertions stay in the scenario. */
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {digest,type CaseResult,caseResultSchema} from './certification.js';
export async function scenarioContext(){
 if(!process.env.PLUGIN_CERT_CONTEXT||!process.env.PLUGIN_CERT_RESULT)throw Error('Run through plugin:certify');
 const bytes=await readFile(process.env.PLUGIN_CERT_CONTEXT);
 return{...JSON.parse(bytes.toString()),context:digest(bytes)};
}
export async function finishScenario(result:CaseResult){
 const ctx=await scenarioContext(),parsed=caseResultSchema.parse(result);
 if(parsed.id!==ctx.caseId)throw Error('Scenario case mismatch');
 await writeFile(process.env.PLUGIN_CERT_RESULT!,JSON.stringify({runId:ctx.runId,context:ctx.context,result:parsed},null,2)+'\n');
}
export async function scenarioEvidence(path:string){
 const ctx=await scenarioContext();return{path,sha256:digest(await readFile(join(ctx.output,path)))};
}
