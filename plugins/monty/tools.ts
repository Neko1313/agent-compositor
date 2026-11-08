export default [{
  name: 'run_python',
  description: 'Execute Python in the configured sandbox. No host files, environment, shell or network are exposed. The final expression is the result; print output is captured.',
  parameters: { type: 'object', properties: { code: { type: 'string' }, inputs: { type: 'object' } }, required: ['code'] },
  describe: () => ({ tool: 'run_python' }),
  execute: async (ctx: any, args: any) => {
    try { return { ok: true, data: await ctx.request('service.sandbox.run', { language: 'python', code: args.code, inputs: args.inputs }) }; }
    catch (error) { return { ok: false, error: String(error) }; }
  },
}];
