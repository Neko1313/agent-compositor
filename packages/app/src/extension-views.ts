import type {UiTextView} from '@agent-compositor/events';
export function extensionView(action:string,result:any):UiTextView{
 const data=result.output??result.data;
 const recovery=[{text:'Back to plugins',action:'navigate:extensions'},{text:'Browse marketplace',action:'navigate:marketplace'}];
 if(!result.ok)return{lines:[{text:String(result.error??'Operation failed'),tone:'danger'},...recovery]};
 const navigation=[{text:'Installed plugins',action:'navigate:extensions'},{text:'Browse marketplace',action:'navigate:marketplace'},{text:'Check for updates',action:'updates'},{text:'Arrange plugin windows',action:'navigate:placement'},{text:'Apply plugin changes',action:'navigate:reload'}];
 if(action==='list')return{lines:[
  ...navigation,
  {text:`${data.available.filter((plugin:any)=>plugin.enabled).length} enabled · ${data.available.length} available`,bold:true},
  ...(data.unavailable?.length?[{text:`Selected source unavailable: ${data.unavailable.join(', ')}`,tone:'danger' as const}]:[]),
  ...data.available.map((plugin:any)=>({text:`${plugin.name}  v${plugin.version} · ${plugin.enabled?'enabled':'off'}`,action:'manage:'+plugin.name})),
 ]};
 if(action==='check-updates')return{lines:[...navigation,{text:'Plugin updates',bold:true},...(data.updates.length?[]:[{text:'No installed plugins to check.',tone:'muted' as const}]),...data.updates.map((entry:any)=>({text:entry.error?`${entry.name}: ${entry.error}`:`${entry.name} · ${entry.scope} · ${entry.installedVersion??'unlocked'} → ${entry.availableVersion??'unknown'}${entry.updateAvailable?' · update available':' · current'}`,action:'manage:'+entry.name}))]};
 if(data.queued)return{lines:[...navigation,{text:`${action} ${data.name} queued`,bold:true},{text:'Files stay unchanged while agents run. Apply plugin changes to finish when idle.',tone:'muted'}]};
 if(data.unchanged)return{lines:[{text:`${data.name} is already at v${data.version} · ${data.scope}`,bold:true},...navigation]};
 const name=data.changed??data.name??data.removed??'',scope=data.scope??'project';
 return{lines:[
  {text:action==='install'?`Installed ${name} v${data.version} · ${scope}`:`${action==='enable'?'Enabled':action==='disable'?'Disabled':action==='rollback'?'Rolled back':action==='remove'?'Removed':'Updated'} ${name}${data.version?' v'+data.version:''} · ${scope}`,bold:true},
  ...(['enable','disable'].includes(action)?[{text:'Selection saved. Apply changes to update the running session.',tone:'muted' as const}]:[]),
  ...(action==='install'?[{text:'Enable installed plugin',action:'manage:'+name},{text:'Inactive until you explicitly enable it.',tone:'muted' as const},{text:`/extensions enable ${name} --${scope}`}]:[]),
  ...(action==='enable'&&data.enabled===false?[{text:'Effective state: off. A project decision or capability selection takes precedence.',tone:'warning' as const}]:[]),
  ...(action==='disable'&&data.enabled===true?[{text:'Effective state: enabled by the project decision. Disable it in project scope to turn it off here.',tone:'warning' as const}]:[]),
  ...navigation,
  {text:'Apply plugin changes to update this session. Busy agents finish first.',tone:'muted'},
 ]};
}
export function marketplaceView(result:any):UiTextView{
 const data=result.output??result.data;
 if(!result.ok)return{lines:[{text:String(result.error??'Marketplace operation failed'),tone:'danger'}]};
 if(Array.isArray(data))return{lines:[{text:'Installed plugins',action:'navigate:extensions'},{text:'Add marketplace',action:'add'},{text:'Plugin marketplaces',bold:true},...data.flatMap((row:any)=>[{text:`${row.name} · ${row.builtin?'bundled':row.scope} · ${row.plugins.length} plugins`,action:'catalog:'+row.name},{text:`Refresh ${row.name}`,action:'refresh:'+row.name},...(!row.builtin?[{text:`Remove ${row.name}`,action:'remove:'+row.name}]:[])]),{text:'Choose a marketplace to browse plugins.',tone:'muted'}]};
 return{lines:[{text:'All marketplaces',action:'navigate:marketplace'},{text:data.removed?`Removed marketplace ${data.removed}`:`Refreshed ${data.name} · ${data.plugins?.length??0} plugins`,bold:true},{text:'Installed plugin versions and activation choices are unchanged.',tone:'muted'}]};
}

export function pendingManagementView(action:string,name?:unknown):UiTextView{
 const verb:Record<string,string>={install:'Installing',update:'Updating',rollback:'Rolling back',remove:'Removing',enable:'Enabling',disable:'Disabling',add:'Registering'};
 return{lines:[{text:`${verb[action]??'Loading'} ${name??'plugins'}…`,bold:true},{text:'You can keep using other windows while this finishes.',tone:'muted'}]};
}
