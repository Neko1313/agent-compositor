import type { ProviderProfile } from '@agent-compositor/provider';
export const providerTypes = ['openai-compat','openai-responses','anthropic','gemini'] as const;
export type SavedProfile = Pick<ProviderProfile,'baseUrl'|'model'|'type'|'timeoutMs'|'maxOutputTokens'>;
export function profileId(id:string) {
  if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)||['constructor','prototype'].includes(id))throw Error('Use a profile ID starting with a letter, followed by letters, digits, _ or -');
  return id;
}
export function profileSettings(input:any):SavedProfile {
  if(!input||!providerTypes.includes(input.type??'openai-compat'))throw Error('Choose a supported API type');
  const url=new URL(String(input.baseUrl));
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('Provider address must be an HTTP(S) base URL without credentials, query or fragment');
  const model=String(input.model??'').trim();
  if(!model||model.length>200)throw Error('Enter a model ID');
  const result:SavedProfile={type:input.type??'openai-compat',baseUrl:url.href.replace(/\/$/,''),model};
  for(const [name,max]of [['timeoutMs',600000],['maxOutputTokens',1000000]] as const)if(input[name]!==undefined&&input[name]!==null&&input[name]!==''){
    const n=Number(input[name]);if(!Number.isSafeInteger(n)||n<1||n>max)throw Error(`${name} must be a positive integer up to ${max}`);result[name]=n;
  }
  return result;
}
/** Lists model IDs without issuing a paid completion or returning provider error bodies. */
export async function availableModels(profile:ProviderProfile,fetcher:typeof fetch,signal?:AbortSignal):Promise<string[]> {
  const url=new URL(profile.baseUrl.replace(/\/$/,'')+'/models');
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid provider address');
  const headers:Record<string,string>={Accept:'application/json',...profile.headers};
  if(profile.apiKey){if(profile.type==='gemini')headers['x-goog-api-key']=profile.apiKey;else if(profile.type==='anthropic')headers['x-api-key']=profile.apiKey;else headers.Authorization=`Bearer ${profile.apiKey}`;}
  if(profile.type==='anthropic')headers['anthropic-version']='2023-06-01';
  let response:Response;
  try{response=await fetcher(url,{headers,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])});}
  catch{throw Error('Connection failed. Check the address, credentials and proxy.');}
  if(!response.ok){await response.body?.cancel();throw Error(`Provider returned HTTP ${response.status}. Check credentials and endpoint.`);}
  let text='';const reader=response.body?.getReader();
  if(reader){const decoder=new TextDecoder();let bytes=0;try{while(true){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>1048576)throw Error('Model list exceeds 1 MiB');text+=decoder.decode(next.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}}
  let body:any;try{body=JSON.parse(text);}catch{throw Error('Provider returned an invalid model list');}
  const rows=body.data??body.models;
  if(!Array.isArray(rows))throw Error('Provider does not expose a supported model list; enter a model ID manually');
  return [...new Set(rows.map((m:any)=>m?.id??m?.name).filter((m:unknown):m is string=>typeof m==='string'&&m.length<=200).map((m:string)=>m.replace(/^models\//,'')))].sort().slice(0,200);
}
