import type {HooksApi} from '@agent-compositor/hooks';
import type {AgentCore} from '@agent-compositor/core';

type ManagementResult={ok:boolean;data?:unknown;error?:string};
type Control=(args:any,signal:AbortSignal)=>Promise<ManagementResult>;
/** User management has a replaceable service chain independent of model tool turns. */
export function installPluginServices(core:AgentCore,extensions:Control,marketplaces:Control):void {
  for(const [name,control]of [['service.extension.control',extensions],['service.marketplace.control',marketplaces]] as const){
    core.runtime.setResolver(name,async(args:any)=>{
      const result=await control(args,args.signal instanceof AbortSignal?args.signal:AbortSignal.timeout(300000));
      return result.ok?{value:result.data}:{deny:result.error??'Plugin operation failed'};
    });
  }
}
export async function managementResult($:HooksApi,service:'service.extension.control'|'service.marketplace.control',args:Record<string,unknown>):Promise<ManagementResult>{
  try{
    const result=await $.emit(service,{...args,signal:$.signal}) as {value?:unknown;deny?:string};
    if(result?.deny)return{ok:false,error:result.deny};
    if(!result||!('value'in result))return{ok:false,error:'Plugin management service returned no result'};
    return{ok:true,data:result.value};
  }catch(error){return{ok:false,error:String(error)};}
}
