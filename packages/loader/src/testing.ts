/** Versioned certification requirements. Applicability is derived, never waived by a skipped test. */
export const components = ['hook','command','tool','skill','view','interactive-ui','agent-service','mcp'] as const;
export const traits = ['mutation','network','subprocess','persistence','private-input','model'] as const;
export type CertificationStage = 'pr'|'release'|'artifact';
export const requirementProfiles = {
 base: ['package.activate','package.reload','package.restart','package.disable','package.reenable','package.remove'],
 hook: ['hook.intended','hook.unrelated','hook.repeat','hook.failure'],
 command: ['command.intended','command.unrelated','command.repeat','command.failure'],
 tool: ['tool.success','tool.invalid','tool.denied','tool.failure','tool.cancel'],
 skill: ['skill.discovery','skill.resources','skill.precedence'],
 view: ['view.content','view.empty','view.error','view.narrow','view.lifecycle'],
 'interactive-ui': ['ui.keyboard','ui.pointer','ui.focus','ui.submit','ui.cancel','ui.restart'],
 'agent-service': ['agent.selection','agent.routing','agent.failure','agent.cancel','agent.budget','agent.policy','agent.honesty'],
 mcp: ['mcp.rpc','mcp.invalid','mcp.namespace','mcp.failure','mcp.timeout','mcp.denied','mcp.reconnect','mcp.cleanup'],
 mutation: ['mutation.result','mutation.invalid','mutation.denied','mutation.recovery'],
 network: ['network.success','network.status','network.malformed','network.unavailable','network.timeout','network.cancel'],
 subprocess: ['process.success','process.failure','process.cancel','process.timeout','process.cleanup'],
 persistence: ['state.fresh','state.restart','state.invalid','state.migration','state.isolation'],
 'private-input': ['privacy.receiver','privacy.model','privacy.logs','privacy.events'],
 model: ['model.intended','model.unrelated','model.clarify','model.failure','model.denied','model.untrusted','model.cancel','model.negative-control'],
 composite: ['composite.lifecycle'],
 release: ['release.upgrade','release.rollback'],
 artifact: ['artifact.install','artifact.behavior','artifact.lifecycle'],
} as const;
export const requirementIds = Object.values(requirementProfiles).flat();
export function requiredCases(profiles:{components:readonly string[];traits:readonly string[]},stage:CertificationStage,previousVersion:string|null=null){
 const keys=['base',...profiles.components,...profiles.traits];
 if(profiles.components.length>1)keys.push('composite');
 if(stage==='release' && previousVersion!==null)keys.push('release');
 if(stage==='artifact')keys.push('artifact');
 const ids=[...new Set(keys.flatMap(key=>requirementProfiles[key as keyof typeof requirementProfiles]??[]))];
 // UI needs the real terminal; model quality needs the real model at release, not scripted assertions.
 return ids.map(id=>({id,kind:id.startsWith('release.')?'upgrade':id.startsWith('model.')?'live':/^(view\.(narrow)|ui\.)/.test(id)?'visual':'deterministic'} as const))
  .filter(item=>stage!=='pr'||item.kind==='deterministic');
}
