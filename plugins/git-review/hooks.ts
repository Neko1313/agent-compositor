import type { HooksApi } from '@agent-compositor/hooks';

const PANEL = 'main';
const STATE = 'review';
type Review = { heading: string; output: string; failed?: boolean; truncated?: boolean };

async function show($: HooksApi) {
  const result = $.state.get<Review>(STATE);
  const text = result?.output ?? 'Choose an action. No Git command runs until you do.';
  // Stay inside the public view's line count and per-line size limits too.
  const rows = text.split('\n').flatMap(line => line.match(/.{1,10000}/gu) ?? ['']);
  await $.ui.view(PANEL, 'Git review', {
    lines: [
      { text: 'Refresh status', action: 'status', tone: 'accent' },
      { text: 'Working diff', action: 'working', tone: 'accent' },
      { text: 'Staged diff', action: 'staged', tone: 'accent' },
      { text: 'Configure output', action: 'configure', tone: 'accent' },
      { text: 'Close', action: 'close', tone: 'muted' },
      { text: result?.heading ?? 'Read-only working-tree review', tone: result?.failed ? 'danger' : 'text' },
      ...rows.slice(0, 1990).map(text => ({ text })),
      ...(result?.truncated || rows.length > 1990
        ? [{ text: 'Output truncated (maxChars or panel line limit).', tone: 'warning' as const }] : []),
    ],
  });
}

async function configure($:HooksApi) {
  try {
    const current=await $.storage.config('git-review.json');
    let value=String(current.maxChars??16000),scope='project',description='Limit Git output without changing the repository.';
    for (;;) {
      const result=await $.ui.form({title:'Configure Git review',description,fields:[
        {id:'maxChars',label:'Maximum output characters',type:'text',value,required:true,hint:'Whole number from 4000 to 64000'},
        {id:'scope',label:'Save for',type:'select',value:scope,options:[{value:'project',label:'This project'},{value:'global',label:'All projects'}]},
      ],actions:[{id:'save',label:'Save'},{id:'cancel',label:'Cancel'}]});
      if(!result||result.action==='cancel')return;
      value=String(result.values.maxChars??'');scope=String(result.values.scope??'project');
      const maxChars=Number(value);
      if(!/^\d+$/.test(value)||!Number.isInteger(maxChars)||maxChars<4000||maxChars>64000||!['project','global'].includes(scope)){
        description='Enter a whole number from 4000 to 64000 and choose a valid scope.';continue;
      }
      await $.storage.configure('git-review.json',{maxChars},scope as 'project'|'global');
      const effective=(await $.storage.config('git-review.json')).maxChars??16000;
      $.state.set(STATE,{heading:'Settings saved',output:`Saved ${maxChars} characters · ${scope}\nEffective in this project: ${effective} characters${scope==='global'&&effective!==maxChars?' (project override)':''}`});return;
    }
  }catch(error){$.state.set(STATE,{heading:'Settings failed',output:String(error),failed:true});}
  finally{await show($);}
}

async function run($: HooksApi, key: 'status' | 'working' | 'staged') {
  const heading = key === 'status' ? 'Status' : key === 'staged' ? 'Staged diff' : 'Working diff';
  try {
    const result = await $.agent.tool('git_review', key === 'status'
      ? { action: 'status' } : { action: 'diff', staged: key === 'staged' });
    if (!result.ok) {
      $.state.set(STATE, { heading, output: result.error || 'Git review failed or was denied.', failed: true });
    } else {
      const data = result.output as { output?: unknown; exitCode?: unknown; truncated?: unknown } | undefined;
      if (!data || typeof data.output !== 'string' || data.exitCode !== 0 || typeof data.truncated !== 'boolean') {
        $.state.set(STATE, { heading, output: 'git_review returned an invalid result.', failed: true });
      } else {
        $.state.set(STATE, { heading, output: data.output || '(No changes.)', truncated: data.truncated });
      }
    }
  } catch (error) {
    $.state.set(STATE, { heading, output: `Git review failed: ${error instanceof Error ? error.message : String(error)}`, failed: true });
  }
  await show($);
}

export default {
  'prompt.submit': async (event: { text: string }, $: HooksApi) => {
    if (event.text.trim() !== '/git-review') return;
    await show($);
    return { drop: 'git-review: handled' };
  },
  'ui.press': async (event: { site: string; key: string }, $: HooksApi) => {
    if (event.site !== `plugin-git-review-${PANEL}`) return;
    if (event.key === 'close') {
      await $.ui.remove(PANEL);
    } else if(event.key==='configure') {
      await configure($);
    } else if (event.key === 'status' || event.key === 'working' || event.key === 'staged') {
      await run($, event.key);
    }
  },
};
