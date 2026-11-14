import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {runDevelopment,developmentLimits} from './development.js';
import {EvalBudget,EVAL_BUDGET_POLICY} from './budget.js';
import {NetworkClient} from '../../packages/provider/src/network.js';

const persistence=vi.hoisted(()=>({before:undefined as undefined|((path:string)=>Promise<void>)}));
vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return{...actual,writeFile:async(...args:Parameters<typeof actual.writeFile>)=>{
    await persistence.before?.(String(args[0]));return actual.writeFile(...args);
  }};
});
const roots:string[]=[];
afterEach(async()=>{persistence.before=undefined;vi.restoreAllMocks();vi.unstubAllEnvs();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
function gate(){let release!:()=>void;const promise=new Promise<void>(resolve=>{release=resolve;});return{promise,release};}
async function texts(path:string):Promise<string>{
  let result='';for(const entry of await readdir(path,{withFileTypes:true})){
    const file=join(path,entry.name);if(entry.isDirectory()){if(entry.name!=='.git')result+=await texts(file);}
    else if(entry.isFile()&&!entry.name.endsWith('.tar.gz'))result+=await readFile(file,'utf8');
  }return result;
}

// These optional tests run an explicitly selected immutable native archive.
// Their scripted Responses prove transport/ownership, not autonomous authoring.
it.skipIf(!process.env.DEVELOPMENT_FIXTURE_BINARY).each(['natural-drain','operator-during-drain'] as const)(
  'runs the actual installed Responses actor through %s with no external HTTP',async mode=>{
    const retained=process.env.DEVELOPMENT_FIXTURE_OUTPUT;
    const base=retained?join(retained,mode):await mkdtemp(join(tmpdir(),'development-installed-'));
    if(retained){await mkdir(dirname(base),{recursive:true,mode:0o700});await mkdir(base,{mode:0o700});}else roots.push(base);
    const parent=join(base,'private-fixture-parent'),output=join(base,'attempt');await mkdir(join(parent,'eval-budgets'),{recursive:true,mode:0o700});
    const profile='synthetic-installed-profile',secret='installed-fixture-parent-only-key',proxySecret='installed-fixture-proxy-password';
    vi.stubEnv('AGENT_HOME',parent);vi.stubEnv('OPENAI_API_KEY',secret);vi.stubEnv('HTTPS_PROXY','http://user:'+proxySecret+'@127.0.0.1:9');
    await writeFile(join(parent,'providers.json'),JSON.stringify({profiles:{[profile]:{type:'openai-responses',baseUrl:'https://api.openai.com/v1',model:'gpt-6.1-sol',reasoningEffort:'low',maxOutputTokens:128}}}),{mode:0o600});
    await writeFile(join(parent,'credentials.json'),JSON.stringify({[profile]:{accessToken:secret}}),{mode:0o600});
    const ledger=join(parent,'eval-budgets',profile+'.json');
    await writeFile(ledger,JSON.stringify({version:1,policy:EVAL_BUDGET_POLICY,profile,model:'gpt-6.1-sol',limitMicroUsd:50000000,charges:{}}),{mode:0o600});
    const budget=new EvalBudget(ledger,profile,'gpt-6.1-sol',50,{existingOnly:true}),before=await budget.auditStatus();
    const requested=gate(),receiptEntered=gate(),receiptPermit=gate();let upstream!:ReadableStreamDefaultController<Uint8Array>,cancelled=false;
    const upstreamBodies:unknown[]=[];
    const transport=vi.fn(async(url:unknown,init?:RequestInit)=>{
      expect(String(url)).toBe('https://api.openai.com/v1/responses');expect(init?.redirect).toBe('error');
      expect((init?.headers as Record<string,string>).authorization).toBe('Bearer '+secret);
      upstreamBodies.push(JSON.parse(String(init?.body)));requested.release();
      return new Response(new ReadableStream<Uint8Array>({start(controller){upstream=controller;},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
    });
    vi.spyOn(NetworkClient.prototype,'fetch').mockReturnValue(transport as typeof fetch);
    const close=vi.spyOn(NetworkClient.prototype,'close');
    const receiptPath=join(output,'evidence','transport','1-receipt.json');
    persistence.before=async path=>{if(path===receiptPath){receiptEntered.release();await receiptPermit.promise;}};
    const abort=new AbortController();let settled=false;
    const pending=runDevelopment({binary:process.env.DEVELOPMENT_FIXTURE_BINARY!,binarySha256:process.env.DEVELOPMENT_FIXTURE_BINARY_SHA256??'',output,
      provider:{kind:'saved-openai-profile',profile,model:'gpt-6.1-sol',maxUsd:50},limits:{...developmentLimits,maxRequests:2,maxOutputTokens:128,deadlineMs:20000},
      execute:true,providerAccessNote:'Scripted synthetic-profile fixture. Parent fetch is replaced; no external HTTP or paid model.',signal:abort.signal});
    void pending.then(()=>{settled=true;},()=>{settled=true;});
    try{
      await requested.promise;
      await expect.poll(async()=>readFile(join(output,'evidence','actor-start.json'),'utf8').then(JSON.parse).catch(()=>null),{timeout:10000}).toMatchObject({pid:expect.any(Number)});
      const started=JSON.parse(await readFile(join(output,'evidence','actor-start.json'),'utf8'));
      expect(started.pid).toBeGreaterThan(0);
      if(process.platform==='linux'){
        const env=await readFile(`/proc/${started.pid}/environ`,'utf8');
        for(const value of [secret,proxySecret,parent,'OPENAI_API_KEY=','HTTPS_PROXY='])expect(env).not.toContain(value);
        expect(env).toContain('AGENT_API_KEY=development-local');
      }
      expect(upstreamBodies[0]).toMatchObject({model:'gpt-6.1-sol',stream:true,store:false,max_output_tokens:128,reasoning:{effort:'low'},service_tier:'default'});
      const sse='data: '+JSON.stringify({type:'response.output_text.delta',delta:'Scripted transport fixture; plugin authoring remains unverified.'})+'\n\ndata: '+JSON.stringify({type:'response.completed',response:{id:'resp_installed_fixture',service_tier:'default',usage:{input_tokens:32,output_tokens:4,total_tokens:36,input_tokens_details:{cached_tokens:8}}}})+'\n\ndata: [DONE]\n\n';
      upstream.enqueue(new TextEncoder().encode(sse));
      await expect.poll(async()=>readFile(join(output,'evidence','actor-exit.json'),'utf8').then(JSON.parse).catch(()=>null),{timeout:10000}).toMatchObject({code:0,signal:null,stopped:false});
      expect(settled).toBe(false);expect(cancelled).toBe(false);expect(transport).toHaveBeenCalledTimes(1);
      expect(await budget.status()).toMatchObject({reportedRequests:0,pendingRequests:1});
      if(mode==='operator-during-drain')abort.abort(Error('Fixture operator abort during actual actor drain'));
      else upstream.close();
      await receiptEntered.promise;expect(settled).toBe(false);
      expect(await budget.status()).toMatchObject(mode==='natural-drain'?{reportedRequests:1,pendingRequests:0}:{reportedRequests:0,pendingRequests:1});
      receiptPermit.release();const report=await pending;
      if(!('actor' in report)||!('transport' in report))throw Error('Expected an executed installed-actor report');
      expect(report.actor).toMatchObject({code:0,signal:null,stopped:false});expect(transport).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
      expect(report.ok).toBe(false); // No scripted model supplied a useful plugin.
      const receipt=JSON.parse(await readFile(receiptPath,'utf8'));
      if(mode==='natural-drain'){
        expect(receipt).toMatchObject({settled:true,terminal:{type:'completed',usage:{inputTokens:32,outputTokens:4,cachedInputTokens:8}}});
        expect(receipt.error).toBeUndefined();expect(report.transport?.halted).toBeUndefined();
        expect(await readFile(join(output,'evidence','transport','1-response.sse'),'utf8')).toBe(sse);
      }else{expect(receipt.settled).not.toBe(true);expect(report.transport?.halted).toContain('Fixture operator abort');}
      const config=JSON.parse(await readFile(join(output,'evidence','executed-config.json'),'utf8'));
      expect(config.providers.default).toMatchObject({type:'openai-responses',model:'gpt-6.1-sol',reasoningEffort:'low',maxOutputTokens:128,apiKey:'development-local'});
      const actorVisible=await texts(join(output,'project'))+await texts(join(output,'home'))+await readFile(join(output,'evidence','trajectory.jsonl'),'utf8');
      for(const value of [secret,proxySecret,parent,profile])expect(actorVisible).not.toContain(value);
      const evidence=await texts(join(output,'evidence'));for(const value of [secret,proxySecret,'Bearer '+secret])expect(evidence).not.toContain(value);
      const after=await budget.auditStatus();expect(after.ledgerSha256).not.toBe(before.ledgerSha256);
      await writeFile(join(base,'installed-fixture-proof.json'),JSON.stringify({mode,externalHttp:0,upstreamRequests:transport.mock.calls.length,actor:report.actor,
        binary:process.env.DEVELOPMENT_FIXTURE_BINARY,binarySha256:process.env.DEVELOPMENT_FIXTURE_BINARY_SHA256,
        pendingWhileActualActorExited:true,receiptJoined:true,credentialIsolation:true,budgetBefore:before,budgetAfter:after,
        autonomousAuthoring:false,reportOk:report.ok},null,2)+'\n',{flag:'wx',mode:0o600});
    }finally{receiptPermit.release();abort.abort();if(!cancelled)try{upstream?.close();}catch{}await pending.catch(()=>{});}
  },30000);
