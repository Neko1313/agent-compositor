import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {runCase,type EvalCase} from './runner.js';
const output=resolve(process.env.NAV_OUTPUT??'dist/navigation-live'),models=(process.env.NAV_MODELS??'gemma4:31b-cloud,deepseek-v4.1-flash:1017-cloud').split(',');
const target = 'src/core/pricing.ts';
const editInstructions = 'Use the returned editRef verbatim with exact oldText and newText. If the read returns only an explicit anchor, copy its path, expectedHash, range and strict fields.';
const files:Record<string,string>={
 'package.json':'{"type":"module","scripts":{"test":"node --experimental-strip-types checks.mjs"}}',
 'tsconfig.json':'{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext"},"include":["src/**/*.ts"]}',
 [target]:Array.from({length:120},(_,i)=>`// Stable pricing invariant ${i}; preserve unrelated behavior.`).join('\n')+'\nexport function computeTotal(n:number){ return n * 2; }\nexport function unchanged(n:number){ return n * 2; }\n',
 'src/ui/pricing.ts':'export function computeTotal(n:number){ return n * 2; }\n',
 'src/checkout.ts':'import {computeTotal as calculate} from "./core/pricing.js";\nexport function checkout(n:number){ return calculate(n); }\n',
 'checks.mjs':"import assert from 'node:assert/strict';import {computeTotal,unchanged} from './src/core/pricing.ts';import {computeTotal as ui} from './src/ui/pricing.ts';assert.equal(computeTotal(5),15);assert.equal(unchanged(5),10);assert.equal(ui(5),10);console.log('NAVIGATION_CHECKS_PASSED');",

};
for(let i=0;i<12;i++)files[`src/extra-${i}.ts`]=`// computeTotal is a historical example, not this task's implementation.\nexport const value${i}=0;\n`;
await mkdir(output,{recursive:true});const results:any[]=[];
for(const model of models)for(const mode of ['semantic','text']as const){
 const methodInstructions = mode === 'semantic'
   ? 'Use code_query for semantic definition, callers and read_symbol.'
   : 'Use glob/grep and targeted read for navigation. Semantic graph tools are intentionally absent.';
 const test: EvalCase = {
   id: 'precise-edit-' + mode,
   split: 'test',
   navigationMode: mode,
   files,
   prompt: 'In src/core/pricing.ts change only computeTotal to multiply n by 3. Preserve the other function with the identical expression and preserve the UI implementation. Use a fresh snapshot-guarded edit rather than rewriting the whole file. Inspect how checkout calls the target, then run the project tests.',
   system: [
     'Execution already uses project cwd. Run exactly npm test, or node --experimental-strip-types checks.mjs, without cd/pipes/redirection.',
     methodInstructions,
     editInstructions,
   ].join(' '),
   expect: {
     guardedEditTarget: target,
     verification: 'NAVIGATION_CHECKS_PASSED',
     grader: "const fs=require('node:fs'),a=require('node:assert/strict'),{pathToFileURL}=require('node:url'),p=process.argv[2];(async()=>{const core=await import(pathToFileURL(p+'/src/core/pricing.ts')),ui=await import(pathToFileURL(p+'/src/ui/pricing.ts'));for(const n of [0,-1,2.5,99]){a.equal(core.computeTotal(n),n*3);a.equal(core.unchanged(n),n*2);a.equal(ui.computeTotal(n),n*2);}a.equal(fs.readFileSync(p+'/src/core/pricing.ts','utf8').split('Stable pricing invariant').length,121);})().catch(e=>{console.error(e);process.exitCode=1;});",
   },
   rules: [
     {tool:'exec', command:'npm test', decision:'allow'},
     {tool:'exec', command:'node --experimental-strip-types checks.mjs', decision:'allow'},
   ],
 };
 const row = await runCase(test, {model, timeoutMs:180000});
 const usedSemantic = row.trajectory.some(e => e.kind === 'catalog' && e.event === 'tool.call' && e.input.tool === 'code_query');
 const result = {...row, usedSemantic, methodAdhered:mode === 'semantic' ? usedSemantic : !usedSemantic};
 results.push(result);
 await writeFile(join(output,model.replace(/[^\w.-]/g,'_')+'-'+mode+'.json'),JSON.stringify(result,null,2));
 console.log(`${row.ok?'PASS':'FAIL'} ${model} ${mode} input=${row.usage.input} output=${row.usage.output} estimatedCalls=${row.usage.estimatedCalls}`);
}
const report={createdAt:new Date().toISOString(),passed:results.filter(r=>r.ok).length,total:results.length,limits:['One task per model/method; no statistical speed or capability claim.','Provider-reported usage includes schema/history/cache effects; toolTraffic sizes are heuristic estimates, not billing.','Both modes use the same permissions, correctness grader and guarded editing; semantic means graph tools are available, not that the model necessarily uses them. Check usedSemantic/methodAdhered before interpreting a pair.'],results:results.map(({trajectory,...r})=>r)};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));if(report.passed!==report.total)process.exitCode=1;
