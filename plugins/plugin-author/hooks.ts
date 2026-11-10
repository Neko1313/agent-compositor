import type { HooksApi } from '@agent-compositor/hooks';

export default {
  'prompt.submit': async (event: {text:string}, $: HooksApi) => {
    const match = /^\/plugin(?:\s+([\s\S]*))?$/.exec(event.text.trim());
    if (!match) return;
    if (!match[1]?.trim()) {
      await $.ui.notify('Describe an extension with /plugin <request>. The agent can load create-plugin, inspect current contracts with plugin_dev, create a local starter and check it. Use /reload between turns to activate reviewed changes.');
      return {drop:'plugin-author: usage'};
    }
    return {text:'Develop a Compositor plugin for the request below. Load the create-plugin skill using skills, or use plugin_dev action="guide" topic="overview". Follow the requested scope, use the installed contracts and check the result before handing it back.\n\nUser request:\n'+match[1].trim()};
  },
};
