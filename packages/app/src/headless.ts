import { readFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import type { BuiltApp } from './build.js';
export async function runHeadless(app: BuiltApp, prompt: string, format: 'text' | 'json' | 'stream-json', write: (text: string) => void, schemaFile?: string): Promise<number> {
  const core = app.createCore(async () => false);
  const usage = { inputTokens: 0, outputTokens: 0 };
  let error: string | undefined, response = '',commandOwner:string|undefined;
  const unsubscribe = core.subscribe(event => {
    if (format === 'stream-json') write(JSON.stringify(event) + '\n');
    if(event.kind==='catalog'&&event.event==='command.operation')commandOwner=event.input.phase==='started'?String(event.input.plugin):undefined;
    if(commandOwner&&event.kind==='catalog'&&event.event==='ui.notification'&&event.input.plugin===commandOwner&&typeof event.input.message==='string'){
      const message=(response?'\n':'')+event.input.message;response+=message;
      if(format==='text')write(message);
      if(event.input.level==='error')error=event.input.message;
    }
    if(commandOwner&&event.kind==='catalog'&&event.event==='model.usage'){
      usage.inputTokens+=Number(event.input.inputTokens??0);usage.outputTokens+=Number(event.input.outputTokens??0);
    }
    if (event.kind === 'catalog' && event.event === 'turn.usage') {
      usage.inputTokens += Number(event.input.inputTokens ?? 0); usage.outputTokens += Number(event.input.outputTokens ?? 0);
    }
    // Interrupted text is not committed to the transcript. Collect only live
    // output, and let a completed turn supply its authoritative final response.
    if (event.kind === 'text') {
      response += event.delta;
      if (format === 'text') write(event.delta);
    }
    if (event.kind === 'catalog' && event.event === 'turn.complete' && typeof event.input.text === 'string') {
      response = event.input.text;
    }
  });
  try {
    await core.start(); await core.submit(prompt);
    error ??= core.failure ?? (core.getState() === 'interrupted' ? 'Interrupted' : undefined);
    if (schemaFile && !error) {
      const schema = JSON.parse(await readFile(schemaFile, 'utf8'));
      const ajv = new Ajv({ allErrors: true, strict: true });
      const validate = ajv.compile(schema);
      if (!validate(JSON.parse(response))) error = `Output schema mismatch: ${ajv.errorsText(validate.errors)}`;
    }
  } catch (caught) { error = String(caught); }
  finally { unsubscribe(); }
  const result = { type: 'result', sessionId: core.sessionId, response, usage, ...(error ? { error } : {}) };
  if (format !== 'text') write(JSON.stringify(result) + '\n');
  else { write('\n'); if (error) write(`Error: ${error}\n`); }
  return error ? 1 : 0;
}
