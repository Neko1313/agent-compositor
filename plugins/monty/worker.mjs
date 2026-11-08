// Trusted bridge process. Only Python source is executed inside Monty.
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { Monty, CollectString } from '@pydantic/monty';
const lines = createInterface({ input: process.stdin });
const pending = new Map(); let nextId = 0, started = false;
function send(value) {
  const text = JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item instanceof Map ? Object.fromEntries(item) : item instanceof Set ? [...item] : item);
  if (Buffer.byteLength(text) > 1000000) throw new Error('Sandbox message exceeds 1 MB');
  process.stdout.write(text + '\n');
}
lines.on('line', line => {
  const message = JSON.parse(line);
  if (!started) { started = true; void run(message); return; }
  const reply = pending.get(message.id);
  if (reply) { pending.delete(message.id); message.error ? reply.reject(new Error(message.error)) : reply.resolve(message.value); }
});
async function run(input) {
  let pool, session;
  try {
    const triple = { 'linux-x64': 'linux-x64-gnu', 'linux-arm64': 'linux-arm64-gnu', 'darwin-x64': 'darwin-x64', 'darwin-arm64': 'darwin-arm64', 'win32-x64': 'win32-x64-msvc' }[`${process.platform}-${process.arch}`];
    if (!triple) throw new Error('Unsupported Monty platform');
    // Use the pinned pure-Monty worker, not a user-selected CPython worker.
    const binaryPath = createRequire(import.meta.url).resolve(`@pydantic/monty-${triple}/${process.platform === 'win32' ? 'monty.exe' : 'monty'}`);
    pool = await Monty.create({ binaryPath, minProcesses: 1, maxProcesses: 1, requestTimeout: input.timeoutMs / 1000 });
    session = await pool.checkout({ limits: { maxMemory: input.memoryBytes, maxFeedDurationSecs: 10, maxRecursionDepth: 100, maxSuspensions: 1000, maxTotalSleepSecs: 0 } });
    const externalLookup = Object.create(null);
    for (const name of input.names) externalLookup[name] = (...args) => new Promise((resolve, reject) => {
      const id = ++nextId; pending.set(id, { resolve, reject });
      try { send({ kind: 'call', id, name, args }); } catch (error) { pending.delete(id); reject(error); }
    });
    const print = new CollectString(64000);
    const output = await session.feedRun(input.code, { inputs: input.inputs, externalLookup, printCallback: print });
    send({ kind: 'result', value: { output: output ?? null, stdout: print.output } });
  } catch (error) { send({ kind: 'error', error: error instanceof Error ? error.message : String(error) }); }
  finally {
    await session?.close().catch(() => {}); await pool?.close().catch(() => {}); lines.close(); process.stdin.destroy();
  }
}
