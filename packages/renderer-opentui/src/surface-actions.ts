import type {UiTextView} from '@agent-compositor/events';

/** One keyboard target per advertised semantic action, including expanded details. */
export function surfaceActions(view?: UiTextView): string[] {
  const actions:string[]=[];
  const add=(action?:string)=>{if(action&&!actions.includes(action))actions.push(action);};
  for(const tab of view?.tabs??[])if(!tab.disabled)add(tab.action);
  for(const line of view?.lines??[])add(line.action);
  for(const row of view?.table?.rows??[]){
    add(row.action);
    if(row.expanded)for(const line of row.details??[])add(line.action);
  }
  return actions;
}

/** Enter may invoke only an explicitly advertised, currently available action. */
export function surfaceSubmitAction(view?:UiTextView):string|undefined {
  const action=view?.input?.submitAction;
  return action&&surfaceActions(view).includes(action)?action:undefined;
}
