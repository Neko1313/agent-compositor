import type { HooksApi } from '@agent-compositor/hooks';
import type { CorePlugin } from '@agent-compositor/core';
import type { ProviderProfile, ProviderRouter } from '@agent-compositor/provider';
import { atomicJson, type ProjectStorage } from '@agent-compositor/config';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { availableModels, profileId, profileSettings,reasoningOptions } from './provider-settings.js';
const presets={
  ollama:{label:'Ollama',metadataProvider:'ollama',type:'openai-compat',baseUrl:'http://127.0.0.1:11434/v1',model:''},
  openai:{label:'OpenAI',type:'openai-responses',baseUrl:'https://api.openai.com/v1',model:''},
  anthropic:{label:'Anthropic',type:'anthropic',baseUrl:'https://api.anthropic.com/v1',model:''},
  gemini:{label:'Gemini',type:'gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',model:''},
  compatible:{label:'Compatible API / gateway',type:'openai-compat',baseUrl:'http://127.0.0.1:8080/v1',model:''},
};
export function modelControls(router:ProviderRouter,storage:ProjectStorage,auth:{setKey:(name:string,key:string)=>Promise<void>;refresh:(name:string,signal:AbortSignal)=>Promise<void>},fetcher:typeof fetch):CorePlugin {
  const scopeFile=(scope:string)=>join(scope==='global'?storage.paths.home:storage.paths.state,'providers.json');
  async function saveProfile(name:string,value:unknown,scope:string){
    const file=scopeFile(scope);const existing=await readFile(file,'utf8').then(JSON.parse).catch((e:any)=>{if(e.code!=='ENOENT')throw e;return{};});
    await atomicJson(file,{...existing,profiles:{...existing.profiles,[name]:value}});
  }
  const choose=async(name:string,$:HooksApi)=>{router.select(name);await atomicJson(join(storage.paths.state,'model.json'),name);await $.ui.notify(`Model: ${router.model}`);};
  const show=async($:HooksApi)=>$.ui.view('models','Models & providers',{lines:[
    {text:`Active: ${router.credentialProfile} · ${router.model}`,bold:true},
    {text:`Reasoning: ${router.reasoningEffort??'provider default'}`,tone:'muted'},
    {text:'[ Add provider ]',action:'add',tone:'accent'},
    {text:'[ Network proxy ]',action:'proxy'},
    {text:'[ Provider access ]',action:'access'},
    ...Object.entries(router.profiles).flatMap(([name,p])=>[
      {text:`${name} · ${p.type??'openai-compat'}`,bold:true},
      {text:`  ${p.model}${router.active===name?' · active':''}`,action:`use:${name}`,selected:router.active===name},
      {text:'  [ Edit connection ]',action:`edit:${name}`},
      {text:'  [ Discover / choose models ]',action:`discover:${name}`},
      {text:`  [ Reasoning: ${p.reasoningEffort??'provider default'} ]`,action:`reasoning:${name}`},
      {text:'  [ Test connection ]',action:`test:${name}`},
      ...(name==='default'?[]:[{text:'  [ Remove profile ]',action:`remove:${name}`}]),
    ]),
  ]},{site:'sidebar',size:.5,focus:true});
  async function pickModel(models:string[],current:string,$:HooksApi){
    if(!models.length)throw Error('No models returned; enter a model ID manually');
    const result=await $.ui.form({title:'Available models',description:'Choose a model returned by this provider. You can also enter a model ID in the connection editor.',fields:[{id:'model',label:'Model',type:'select',value:models.includes(current)?current:models[0],options:models.map(value=>({value,label:value}))}],actions:[{id:'use',label:'Use selected model'},{id:'cancel',label:'Cancel'}]});
    return result&&result.action!=='cancel'?String(result.values.model):undefined;
  }
  async function edit(existing:string|undefined,$:HooksApi){
    let initial:any=existing?router.profiles[existing]:undefined;
    let id=existing??'';let scope='project';let pendingKey='';let clearKey=false;
    if(!initial){const preset=await $.ui.form({title:'Add provider',fields:[{id:'preset',label:'Provider',type:'select',value:'ollama',options:Object.entries(presets).map(([value,p])=>({value,label:p.label}))}],actions:[{id:'next',label:'Continue'},{id:'cancel',label:'Cancel'}]});if(!preset)return;const p=presets[String(preset.values.preset) as keyof typeof presets];initial={...p};id=String(preset.values.preset);}
    let message='API keys are stored privately in your user credentials file. Blank key keeps the current key.';
    while(true){
      const result=await $.ui.form({title:existing?`Edit provider · ${existing}`:'New provider connection',description:message,fields:[
        {id:'id',label:'Profile ID',type:'text',value:id,required:true,hint:existing?'Keep this ID, or save a copy with another ID.':undefined},
        {id:'type',label:'API protocol',type:'select',value:initial.type??'openai-compat',options:[{value:'openai-compat',label:'OpenAI-compatible / Ollama'},{value:'openai-responses',label:'OpenAI Responses'},{value:'anthropic',label:'Anthropic'},{value:'gemini',label:'Gemini'}]},
        {id:'baseUrl',label:'Base URL',type:'url',value:initial.baseUrl,required:true},
        {id:'model',label:'Model ID',type:'text',value:initial.model??'',hint:'Enter manually or use Discover models below.'},
        {id:'key',label:'API key',type:'password',hint:pendingKey?'New key entered for this edit.':existing&&initial.apiKey?'A key is configured. Blank keeps it.':'Optional for local providers.'},
        {id:'clearKey',label:'Remove saved API key',type:'toggle',value:clearKey},
        {id:'maxOutputTokens',label:'Maximum output tokens',type:'text',value:initial.maxOutputTokens?String(initial.maxOutputTokens):'',hint:'Blank uses the provider default.'},
        {id:'timeoutMs',label:'Request timeout (milliseconds)',type:'text',value:String(initial.timeoutMs??120000)},
        {id:'scope',label:'Save connection for',type:'select',value:scope,hint:'Project settings override global defaults.',options:[{value:'project',label:'This project (private user storage)'},{value:'global',label:'All projects'}]},
        {id:'contextWindow',label:'Context window (tokens)',type:'text',value:initial.contextWindow?String(initial.contextWindow):'',hint:'Blank detects provider limits; unknown models use a marked conservative fallback.'},
        {id:'reasoningEffort',label:'Reasoning effort',type:'select',value:initial.reasoningEffort??'',options:reasoningOptions(String(initial.type??'openai-compat') as ProviderProfile['type'],initial.reasoningEffort),hint:'Support depends on the selected model. Provider default omits the setting.'},
      ],actions:[{id:'save',label:'Save profile'},{id:'discover',label:'Test & discover models'},{id:'cancel',label:'Cancel'}]});
      if(!result)return;const v=result.values;id=String(v.id).trim();scope=String(v.scope);clearKey=v.clearKey===true;
      if(v.key)pendingKey=String(v.key);
      initial={...initial,...v};delete initial.key;
      try{
        profileId(id);
        const model=String(v.model).trim();
        const settings=profileSettings({...initial,model:model||'pending-model'});
        const key=clearKey?'':pendingKey||router.profiles[existing??id]?.apiKey||'';
        if(result.action==='discover'){
          const models=await availableModels({...settings,apiKey:key,fetch:fetcher},fetcher,$.signal);
          await $.ui.notify(`Connection OK · ${models.length} models`);
          const selected=await pickModel(models,model,$);if(selected)initial.model=selected;
          message='Connection tested. Save to apply this profile.';continue;
        }
        if(!model)throw Error('Enter or discover a model ID before saving');
        const saved=profileSettings({...initial,model});
        await saveProfile(id,{...saved,maxOutputTokens:saved.maxOutputTokens??null,timeoutMs:saved.timeoutMs??null,contextWindow:saved.contextWindow??null,reasoningEffort:saved.reasoningEffort??null},scope);
        const effective=scope==='global'?profileSettings((await storage.config('providers.json')).profiles[id]):saved;
        router.profiles[id]={...router.profiles[id],...effective,maxOutputTokens:effective.maxOutputTokens,timeoutMs:effective.timeoutMs,contextWindow:effective.contextWindow,reasoningEffort:effective.reasoningEffort,apiKey:router.profiles[id]?.apiKey??'',fetch:fetcher};
        if(pendingKey||clearKey||(existing&&existing!==id&&key))await auth.setKey(id,clearKey?'':pendingKey||key);
        await choose(id,$);await show($);return;
      }catch(error){message=(error as Error).message;}
    }
  }
  const action=async(key:string,$:HooksApi)=>{
    const [kind,name]=key.split(':');
    if(kind==='settings'){await show($);return;}
    if(kind==='add'){await edit(undefined,$);return;}
    if(kind==='proxy'){await $.emit('prompt.submit',{text:'/proxy configure'});return;}
    if(kind==='access'){await $.emit('prompt.submit',{text:'/auth'});return;}
    if(!name||!Object.hasOwn(router.profiles,name))return;
    if(kind==='reasoning'){
      const profile=router.profiles[name];
      const result=await $.ui.form({title:`Reasoning effort · ${name}`,description:'Model-dependent setting. Provider default sends no explicit effort.',fields:[{id:'reasoningEffort',label:'Reasoning effort',type:'select',value:profile.reasoningEffort??'',options:reasoningOptions(profile.type,profile.reasoningEffort)},{id:'scope',label:'Save for',type:'select',value:'project',options:[{value:'project',label:'This project'},{value:'global',label:'All projects'}]}],actions:[{id:'save',label:'Save effort'},{id:'cancel',label:'Cancel'}]});
      if(!result||result.action==='cancel')return;
      const saved=profileSettings({...profile,reasoningEffort:result.values.reasoningEffort});
      const scope=String(result.values.scope??'project');await saveProfile(name,{...saved,reasoningEffort:saved.reasoningEffort??null},scope);
      const effective=profileSettings((await storage.config('providers.json')).profiles[name]);router.setReasoningEffort(name,effective.reasoningEffort);
      await $.ui.notify(`Reasoning: ${effective.reasoningEffort??'provider default'}`);await show($);return;
    }
    if(kind==='use'||kind==='model'){await choose(name,$);await show($);return;}
    if(kind==='edit'){await edit(name,$);return;}
    if(kind==='remove'){
      if(name==='default')throw Error('The default profile cannot be removed');
      const result=await $.ui.form({title:`Remove profile · ${name}`,description:'This removes the connection for this project. Stored credentials are retained for other projects.',fields:[{id:'confirm',label:'Remove this profile',type:'toggle',value:false}],actions:[{id:'remove',label:'Remove profile'},{id:'cancel',label:'Cancel'}]});
      if(result?.values.confirm){await saveProfile(name,null,'project');delete router.profiles[name];if(router.credentialProfile===name)await choose('default',$);await show($);}return;
    }
    await auth.refresh(name,$.signal);
    const models=await availableModels(router.profiles[name],fetcher,$.signal);
    if(kind==='test'){await $.ui.notify(`Connection OK · ${models.length} models`);return;}
    const selected=await pickModel(models,router.profiles[name].model,$);if(selected){await choose(name,$);router.select(selected);await atomicJson(join(storage.paths.state,'model.json'),{profile:name,model:selected});await $.ui.notify(`Model: ${selected}`);await show($);}
  };
  return {manifest:{name:'model-selector',version:'1.1.0',trust:'trusted',hookTimeouts:{'ui.press':300000,'prompt.submit':300000}},hooks:{
    'prompt.submit':async(e,$)=>{const[command,...rest]=e.text.trim().split(/\s+/);if(!['/model','/models','/providers','/settings'].includes(command))return;try{if(command==='/model'&&rest.length)await choose(rest.join(' '),$);else await show($);}catch(error){await $.ui.notify((error as Error).message,'error');}return{drop:'model-selector: handled'};},
    'ui.press':async(e,$)=>{if(e.site!=='plugin-model-selector-models')return;try{await action(e.key,$);}catch(error){await $.ui.notify((error as Error).message,'error');}},
  }};
}
