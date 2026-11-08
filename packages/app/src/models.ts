import type { HooksApi } from '@agent-compositor/hooks';
import type { CorePlugin } from '@agent-compositor/core';
import type { ProviderRouter } from '@agent-compositor/provider';
export function modelControls(router: ProviderRouter): CorePlugin {
  const show = async ($: HooksApi) => $.ui.view('models', 'Models', { lines: [
    { text: `${router.active} · ${router.model}`, bold: true }, { text: 'Choose a profile or use /model <name>', tone: 'muted' },
    ...Object.entries(router.profiles).map(([name, profile]) => ({ text: `${name} · ${profile.type ?? 'openai-compat'} · ${profile.model}`, action: `model:${name}`, selected: router.active === name })),
  ] }, { site: 'inspector', focus: false });
  const choose = async (name: string, $: HooksApi) => {
    router.select(name); await $.fs.write('.agent-compositor/model.json', JSON.stringify(name)); await show($);
    await $.ui.notify(`Model: ${router.model}`);
  };
  return { manifest: { name: 'model-selector', version: '1.0.0', trust: 'trusted' }, hooks: {
    'prompt.submit': async (event, $) => {
      const [command, ...rest] = event.text.trim().split(/\s+/);
      if (command !== '/model') return;
      if (rest.length) await choose(rest.join(' '), $); else await show($);
      return { drop: 'model-selector: handled' };
    },
    'ui.press': async (event, $) => { if (event.site === 'plugin-model-selector-models' && event.key.startsWith('model:')) await choose(event.key.slice(6), $); },
  } };
}
