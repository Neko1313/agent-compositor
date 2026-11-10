export type PluginScope='user'|'project';
export interface PluginActivation {enabled?:string[];disabled:string[]}
/** Project decisions override user decisions; a configured allowlist remains a ceiling. */
export function pluginSelection(user:PluginActivation,project:PluginActivation,allowlist?:string[]):string[]{
  const selected=new Set(allowlist??[]);
  for(const state of [user,project]){
    for(const name of state.enabled??[])if(!allowlist||allowlist.includes(name))selected.add(name);
    for(const name of state.disabled)selected.delete(name);
  }
  return [...selected];
}
