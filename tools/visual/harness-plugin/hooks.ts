export default {
  'prompt.submit':async(e:any,$:any)=>{
    if(e.text.trim()==='/workflow-proof'){
      const result=await $.agent.tool('workflow_run',{action:'start',title:'Repository audit proof',concurrency:2,stages:[{id:'discover',title:'Discover work',prompt:'PROOF_DISCOVER',expand:true},{id:'verify',title:'Verify combined result',prompt:'PROOF_VERIFY',dependsOn:['discover']}]});
      if(!result.ok)await $.ui.notify(result.error,'error');return{drop:'proof started'};
    }
    if(e.text.trim()==='/workflow-release'){await $.fs.write('proof-release.txt','released');return{drop:'proof released'};}
  },
};
