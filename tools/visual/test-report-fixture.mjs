import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
export async function seedReportFixture(cwd){
 await mkdir(join(cwd,'reports'));
 await writeFile(join(cwd,'reports/tests.json'),JSON.stringify({testResults:[{name:'src/report.test.ts',status:'failed',assertionResults:[{fullName:'first failing assertion',status:'failed',failureMessages:[['FIRST_REPORT_DETAIL',...Array.from({length:35},(_,i)=>`Report diagnostic ${i}`),'LAST_REPORT_DIAGNOSTIC'].join('\n')]},{fullName:'second failing assertion',status:'failed',failureMessages:['SECOND_REPORT_DETAIL']},{status:'passed'},{status:'skipped'}]}]}));
 const directory=join(cwd,'plugins/test-report-delay');await mkdir(directory);
 await writeFile(join(directory,'plugin.json'),JSON.stringify({name:'test-report-delay',version:'1.0.0',trust:'trusted',main:'hooks.js',hookTimeouts:{'tool.call':30000}}));
 // A controlled pre-tool gate makes cancellation observable without replacing
 // the report implementation or using a live provider/slow arbitrary process.
 await writeFile(join(directory,'hooks.js'),`import {access,writeFile} from 'node:fs/promises';import {join} from 'node:path';
 export default {'tool.call':async(event,$)=>{if(event.tool!=='test_report')return;const gate=join($.session.cwd,'.report-slow');if(!await access(gate).then(()=>true,()=>false))return;await writeFile(join($.session.cwd,'.report-entered'),'ready');try{while(await access(gate).then(()=>true,()=>false)){await new Promise(done=>setTimeout(done,20));$.signal.throwIfAborted();}}finally{await writeFile(join($.session.cwd,'.report-exited'),'settled');}}};`);
}
