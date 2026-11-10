import type {UiTextView} from '@agent-compositor/events';
export function extensionView(action:string,result:any):UiTextView{
 const data=result.output??result.data;
 if(!result.ok)return{lines:[{text:String(result.error??'Operation failed'),tone:'danger'}]};
 if(action==='list')return{lines:[
  {text:`${data.available.filter((plugin:any)=>plugin.enabled).length} enabled · ${data.available.length} available`,bold:true},
  ...(data.unavailable?.length?[{text:`Selected source unavailable: ${data.unavailable.join(', ')}`,tone:'danger' as const}]:[]),
  ...data.available.map((plugin:any)=>({text:`${plugin.name}  v${plugin.version} · ${plugin.enabled?'enabled':'off'}`,action:'manage:'+plugin.name})),
 ]};
 if(action==='check-updates')return{lines:[{text:'Plugin updates',bold:true},...data.updates.map((entry:any)=>({text:entry.error?`${entry.name}: ${entry.error}`:`${entry.name} · ${entry.scope} · ${entry.installedVersion??'unlocked'} → ${entry.availableVersion??'unknown'}${entry.updateAvailable?' · update available':' · current'}`}))]};
 const name=data.changed??data.name??data.removed??'',scope=data.scope??'project';
 return{lines:[
  {text:action==='install'?`Installed ${name} v${data.version} · ${scope}`:`${action==='enable'?'Enabled':action==='disable'?'Disabled':action==='rollback'?'Rolled back':action==='remove'?'Removed':'Updated'} ${name}${data.version?' v'+data.version:''} · ${scope}`,bold:true},
  ...(action==='install'?[{text:'Inactive until you explicitly enable it.',tone:'muted' as const},{text:`/extensions enable ${name} --${scope}`}]:[]),
  ...(action==='enable'&&data.enabled===false?[{text:'Effective state: off. A project decision or capability selection takes precedence.',tone:'warning' as const}]:[]),
  ...(action==='disable'&&data.enabled===true?[{text:'Effective state: enabled by the project decision. Disable it in project scope to turn it off here.',tone:'warning' as const}]:[]),
  {text:data.unchanged?'Already at this version.':'Use /reload between turns to apply changes.',tone:'muted'},
 ]};
}
export function marketplaceView(result:any):UiTextView{
 const data=result.output??result.data;
 if(!result.ok)return{lines:[{text:String(result.error??'Marketplace operation failed'),tone:'danger'}]};
 if(Array.isArray(data))return{lines:[{text:'Plugin marketplaces',bold:true},...data.map((row:any)=>({text:`${row.name} · ${row.builtin?'bundled':row.scope} · ${row.plugins.length} plugins`,action:'catalog:'+row.name})),{text:'Choose a marketplace to browse plugins.',tone:'muted'}]};
 return{lines:[{text:data.removed?`Removed marketplace ${data.removed}`:`Refreshed ${data.name} · ${data.plugins?.length??0} plugins`,bold:true},{text:'Installed plugin versions and activation choices are unchanged.',tone:'muted'}]};
}
