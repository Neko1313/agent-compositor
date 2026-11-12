export default {
  'session.start':async(e:any,$:any)=>{
    if(!process.env.VISUAL_EXECUTABLE)return;
    const result=await $.emit('service.extension.control',{action:'list'});
    if(result?.deny)throw Error(result.deny);
    if(process.env.VISUAL_RESOURCES){
      const resources=result?.value?.available?.filter((row:any)=>row.name==='resources'&&row.enabled)??[],loaded=e.plugins?.find((plugin:any)=>plugin.name==='resources');
      if(resources.length!==1||!loaded||loaded.version!==resources[0].version)throw Error('Resource runtime identity differs from inventory');
      await $.fs.write('native-resources-identity.json',JSON.stringify({plugin:loaded.name,version:loaded.version,directory:resources[0].directory}));
    }
    const available=result?.value?.available?.filter((row:any)=>row.name==='workflows'&&row.enabled)??[];
    if(available.length!==1)throw Error('Expected exactly one enabled workflow package');
    const loaded=e.plugins?.find((plugin:any)=>plugin.name==='workflows');
    if(!loaded||loaded.version!==available[0].version)throw Error('Workflow inventory and runtime identity differ');
    await $.fs.write('native-fixture-identity.json',JSON.stringify({plugin:loaded.name,version:loaded.version,directory:available[0].directory}));
  },
  'prompt.submit':async(e:any,$:any)=>{
    if(e.text.trim()==='/workflow-proof'){
      const result=await $.agent.tool('workflow_run',{action:'start',title:'Repository audit proof',concurrency:2,stages:[{id:'discover',title:'Discover work',prompt:'PROOF_DISCOVER',expand:true},{id:'verify',title:'Verify combined result',prompt:'PROOF_VERIFY',dependsOn:['discover']}]});
      if(!result.ok)await $.ui.notify(result.error,'error');return{drop:'proof started'};
    }
    if(e.text.trim()==='/workflow-release'){await $.fs.write('proof-release.txt','released');return{drop:'proof released'};}
  },
};
