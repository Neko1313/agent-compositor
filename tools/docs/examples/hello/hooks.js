export const hooks = {
  'prompt.submit': async (event, $) => {
    if (event.text.trim() !== '/hello') return;
    await $.ui.notify('Hello from your plugin!');
    return {drop: 'hello command handled'};
  },
};
