import {writeFile} from 'node:fs/promises';
export default class CertificationReporter {
 results=[];
 onTestCaseResult(test){
  const titles=[test.name];let parent=test.parent;
  while(parent?.type==='suite'){titles.unshift(parent.name);parent=parent.parent;}
  const diagnostic=test.diagnostic()??{retryCount:0,flaky:false};
  this.results.push({file:test.module.moduleId,test:titles.join(' '),status:test.result().state,duration:diagnostic.duration??0,retryCount:diagnostic.retryCount,flaky:diagnostic.flaky,attempts:test.attempts().map(a=>a.result?.state??a.state)});
 }
 async onTestRunEnd(_modules,errors,reason){
  await writeFile(process.env.PLUGIN_CERT_DIAGNOSTICS,JSON.stringify({reason,errors:errors.map(e=>e.message??e.name??"Unhandled error"),results:this.results},null,2));
 }
}
