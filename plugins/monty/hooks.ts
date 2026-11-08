import { runSandbox } from './adapter.ts';
export default {
  'service.sandbox.run': async (event: any, $: any) => {
    try { return { value: await runSandbox(event, $.signal) }; }
    catch (error) { return { deny: error instanceof Error ? error.message : String(error) }; }
  },
};
