import { readFile } from 'node:fs/promises';
import { Ajv } from 'ajv';
import type { BuiltApp } from './build.js';
export async function runHeadless(app: BuiltApp, prompt: string, format: 'text' | 'json' | 'stream-json', write: (text: string) => void, schemaFile?: string): Promise<number> {
  const core = app.createCore(async () => false);
  const usage = { inputTokens: 0, outputTokens: 0 };
  const unsubscribe = core.subscribe(event => {
    if (format === 'stream-json') write(JSON.stringify(event) + '\n');
    if (event.kind === 'catalog' && event.event === 'turn.usage') {
      usage.inputTokens += Number(event.input.inputTokens ?? 0); usage.outputTokens += Number(event.input.outputTokens ?? 0);
    }
    if (format === 'text' && event.kind === 'text') write(event.delta);
  });
  let error: string | undefined, response = '';
  try {
    await core.start(); await core.submit(prompt);
    response = [...core.getMessages()].reverse().find(m => m.role === 'assistant')?.content ?? '';
    error = core.failure;
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
