import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {estimateTokens} from '../../packages/context/src/index.js';
import {query,runBinary} from '../../plugins/callix/adapter.js';
import callixTools from '../../plugins/callix/tools.js';
import {queryProject,readTool,editTool,registerDefaultResolvers,UndoStore,type ToolContext} from '../../packages/tools/src/index.js';
const output=resolve(process.env.NAV_OUTPUT??'dist/navigation-benchmark'),binary=resolve(process.env.CALLIX_TEST_BIN??'plugins/callix/bin/callix');
const temp=await mkdtemp(join(tmpdir(),'callix-method-bench-'));await mkdir(output,{recursive:true});
const question='Change the multiplier in src/core/pricing.ts computeTotal from 2 to 3 without changing the UI function. Identify its real callers.';
const target='src/core/pricing.ts';
const files:Record<string,string>={
 'package.json':'{"type":"module"}',
 'tsconfig.json':JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext'},include:['src/**/*.ts']}),
 [target]:Array.from({length:1200},(_,i)=>`// Pricing invariant ${i}: stable public behavior and independent rounding policy.`).join('\n')+'\nexport function computeTotal(n:number){ return n * 2; }\n',
 'src/ui/pricing.ts':'export function computeTotal(n:number){ return n * 2; }\n',
 'src/checkout.ts':'import {computeTotal as calculate} from "./core/pricing.js";\nexport function checkout(n:number){ return calculate(n); }\n',
 'src/invoice.ts':'import {computeTotal} from "./core/pricing.js";\nexport function invoice(n:number){ return computeTotal(n); }\n',
};
for(let i=0;i<40;i++)files[`src/noise/file-${i}.ts`]=Array.from({length:8},(_,j)=>`// historical computeTotal example ${i}:${j}, not an executable reference`).join('\n')+'\nexport const value'+i+' = 0;\n';
const cases=['text-full','text-ranged','callix']as const,results:any[]=[];
const schemas=(tools:any[])=>tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters}));
try{
 for(const method of cases){
  const cwd=join(temp,method);for(const[file,body]of Object.entries(files)){await mkdir(dirname(join(cwd,file)),{recursive:true});await writeFile(join(cwd,file),body);}
  const handlers=new Map<string,(p:any)=>Promise<any>>();registerDefaultResolvers({on:(s,h)=>{handlers.set(s,h);}},{root:cwd});
  const ctx:ToolContext={cwd,signal:new AbortController().signal,undo:new UndoStore(),request:async(s,p)=>handlers.get(s)!(p)};
  const tools=method==='callix'?[callixTools[0],editTool]:[...callixTools.slice(1),readTool,editTool],schemaTokens=estimateTokens(JSON.stringify(schemas(tools)));
  const traffic:Array<{operation:string;args:any;tokens:number;bytes:number;ms:number}>=[];
  const record=async<T>(operation:string,args:any,fn:()=>Promise<T>):Promise<T>=>{const start=performance.now(),value=await fn(),json=JSON.stringify(value);traffic.push({operation,args,tokens:estimateTokens(json),bytes:Buffer.byteLength(json),ms:performance.now()-start,...((value as any)?.metrics?.cache?{cache:(value as any).metrics.cache,indexMs:(value as any).metrics.indexMs}:{})});return value;};
  let anchor:any,oldText:string,callerCandidates:any[],resolvedCallerPaths:string[]=[];
  if(method==='callix'){
   const definitions=await record('code_query definition',{pattern:'computeTotal',path:target},()=>query({cwd,action:'definition',pattern:'computeTotal',path:target,settings:{executable:binary}}));
   const id=definitions.symbols[0]?.id;if(!id)throw Error('Native definition missing');
   const source=await record('code_query read_symbol',{pattern:id},()=>query({cwd,action:'read_symbol',pattern:id,settings:{executable:binary}}));anchor=source.edit;oldText='n * 2';
   const callers=await record('code_query callers',{pattern:id},()=>query({cwd,action:'callers',pattern:id,settings:{executable:binary}}));callerCandidates=callers.nodes.filter((n:any)=>n.id!==id&&n.kind==='function').map((n:any)=>({path:n.file_path,name:n.name}));resolvedCallerPaths=callerCandidates.map(c=>c.path).sort();
  }else{
   const found=await record('grep',method==='text-full'?{pattern:'computeTotal',limit:1000}:{pattern:'function computeTotal',path:target},()=>queryProject({cwd,action:'grep',pattern:method==='text-full'?'computeTotal':'function computeTotal',path:method==='text-full'?undefined:target,limit:method==='text-full'?1000:40}));
   const line=found.matches.find((m:any)=>m.path===target)?.line;if(!line)throw Error('Text definition missing');
   const read=await record('read',{path:target,...(method==='text-ranged'?{offset:line,limit:1}:{})},async()=>{const r=await readTool.execute(ctx,{path:target,...(method==='text-ranged'?{offset:line,limit:1}:{})});if(!r.ok)throw Error(r.error);return r.data;});anchor=read.edit;oldText='n * 2';
   const imports=await record('grep imports',{pattern:'import.*computeTotal',regex:true},()=>queryProject({cwd,action:'grep',pattern:'import.*computeTotal',regex:true,limit:1000}));
   const aliases=[...new Set(imports.matches.map((m:any)=>m.text.match(/computeTotal\s+as\s+(\w+)/)?.[1]??'computeTotal'))]as string[];
   const expression='('+aliases.join('|')+')\\(';
   const callers=await record('grep callers candidates',{pattern:expression,regex:true},()=>queryProject({cwd,action:'grep',pattern:expression,regex:true,limit:1000}));callerCandidates=callers.matches;
   const relevant=new Set(imports.matches.filter((m:any)=>{const spec=m.text.match(/from\s+["']([^"']+)["']/)?.[1];return spec&&resolve(cwd,dirname(m.path),spec.replace(/\.js$/,'.ts'))===resolve(cwd,target);}).map((m:any)=>m.path));
   resolvedCallerPaths=[...new Set<string>(callerCandidates.filter(c=>relevant.has(c.path)).map(c=>c.path))].sort();

  }
  if(JSON.stringify(resolvedCallerPaths)!==JSON.stringify(["src/checkout.ts","src/invoice.ts"]))throw Error("Caller navigation oracle failed: "+JSON.stringify(resolvedCallerPaths));
  const beforeEditCount=traffic.length;
  const edit=await record('edit',{...anchor,oldText,newText:'n * 3'},()=>editTool.execute(ctx,{...anchor,oldText,newText:'n * 3'}));if(!edit.ok)throw Error(edit.error);
  const changed=await readFile(join(cwd,target),'utf8'),ui=await readFile(join(cwd,'src/ui/pricing.ts'),'utf8');if(!changed.includes('return n * 3')||!ui.includes('return n * 2'))throw Error('Behavior/neighbor preservation failed');
  const resultTokens=traffic.reduce((n,r)=>n+r.tokens,0),argumentTokens=traffic.reduce((n,r)=>n+estimateTokens(JSON.stringify(r.args)),0);
  let cumulative=estimateTokens(question)+schemaTokens,estimatedInputAcrossRounds=0;
  for(const row of traffic){estimatedInputAcrossRounds+=cumulative+estimateTokens(JSON.stringify(row.args));cumulative+=row.tokens+estimateTokens(JSON.stringify(row.args))+16;}estimatedInputAcrossRounds+=cumulative;
  results.push({method,correctEdit:true,operations:traffic.length,schemaTokens,estimatedResultTokens:resultTokens,estimatedArgumentTokens:argumentTokens,estimatedInputAcrossRounds,bytes:traffic.reduce((n,r)=>n+r.bytes,0),navigationMs:traffic.slice(0,beforeEditCount).reduce((n,r)=>n+r.ms,0),callerCandidates,resolvedCallerPaths,traffic});
 }
 const semantic=results.find(r=>r.method==='callix');const version=(await runBinary(binary,['--version'],temp)).stdout.trim();const report={version:1,callixVersion:version,createdAt:new Date().toISOString(),callixBinary:binary,fixture:{files:Object.keys(files).length,sourceLines:Object.values(files).reduce((n,s)=>n+s.split('\n').length,0)},question,results,comparisons:results.filter(r=>r.method!=='callix').map(r=>({baseline:r.method,resultTokenReduction:1-semantic.estimatedResultTokens/r.estimatedResultTokens,inputEstimateReduction:1-semantic.estimatedInputAcrossRounds/r.estimatedInputAcrossRounds})),limits:['Deterministic navigation protocols, not measured model reasoning or a benchmark of branded assistants.','Token counts use the application heuristic on compact JSON; no provider billing claim. Repeated-input estimate excludes unknown reasoning/cache/provider framing.','Cold native indexing is charged to Callix; subsequent graph queries in the same unchanged fixture are warm.','All protocols validate the same fixture caller paths; the scripted import/alias handling is not a general-purpose semantic resolver.']};
 await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
 const rows=results.map(r=>`| ${r.method} | ${r.operations} | ${r.schemaTokens} | ${r.estimatedResultTokens} | ${r.estimatedInputAcrossRounds} | ${r.navigationMs.toFixed(1)} |`);
 await writeFile(join(output,'report.md'),'# Navigation method comparison\n\n| Method | Calls | Schema tokens ~ | Result tokens ~ | Input across rounds ~ | Navigation ms |\n|---|---:|---:|---:|---:|---:|\n'+rows.join('\n')+'\n\n'+report.limits.map(s=>'- '+s).join('\n')+'\n');
 console.log(JSON.stringify({output,results:results.map(({traffic,callerCandidates,...r})=>r),comparisons:report.comparisons},null,2));
}finally{await rm(temp,{recursive:true,force:true});}
