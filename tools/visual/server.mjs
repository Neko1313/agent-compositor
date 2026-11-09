import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const root = resolve(import.meta.dir, '../..');
const cwd = await mkdtemp(join(tmpdir(), 'compositor-visual-'));
const output = resolve(process.env.VISUAL_OUTPUT ?? join(root, 'dist/visual-proof'));
await mkdir(output, { recursive: true });
await writeFile(join(output, 'terminal.ansi'), '');
await writeFile(join(output, 'input.jsonl'), '');
await mkdir(join(cwd, 'plugins'));
for (const name of ['todos', 'slash-commands', 'ui-theme']) await cp(join(root, 'plugins', name), join(cwd, 'plugins', name), { recursive: true });
await mkdir(join(cwd, '.agent-compositor'));
await writeFile(join(cwd, '.agent-compositor/todos.json'), JSON.stringify([
  { content: 'Inspect project', status: 'pending' }, { content: 'Build interactive UI', status: 'pending' },
  { content: 'Verify drag and persistence', status: 'pending' },
]));
const token = crypto.randomUUID();
let active;
let terminalSize={cols:100,rows:30};
async function start(ws) {
  const command = process.env.VISUAL_EXECUTABLE
    ? [resolve(process.env.VISUAL_EXECUTABLE), '--cwd', cwd]
    : ['bun', join(import.meta.dir, 'fixture.ts'), cwd];
  const proc = Bun.spawn([process.env.PYTHON ?? 'python3', '-u', join(import.meta.dir, 'pty_bridge.py'), ...command],
    { cwd: root, env:{...process.env,HOME:cwd,AGENT_HOME:join(cwd, ".agent-compositor"),XDG_CONFIG_HOME:join(cwd,"xdg"),VISUAL_COLS:String(terminalSize.cols),VISUAL_ROWS:String(terminalSize.rows)},stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
  active = { ws, proc };
  const sendLines = async () => {
    let pending = '';
    for await (const chunk of proc.stdout) {
      pending += new TextDecoder().decode(chunk);
      let index;
      while ((index = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        const message = JSON.parse(line);
        if (message.type === 'data') appendFileSync(join(output, 'terminal.ansi'), message.data);
        if (active?.proc === proc) ws.send(line);
      }
    }
  };
  void sendLines().catch(error => ws.send(JSON.stringify({ type: 'error', data: String(error) })));
  void proc.exited.then(code => { if (active?.proc === proc) ws.send(JSON.stringify({ type: 'exit', code })); });
}
async function stop() { if (!active) return; const previous = active; active = undefined; previous.proc.kill(); await previous.proc.exited; }
const server = Bun.serve({
  hostname: '127.0.0.1', port: Number(process.env.PORT ?? 0),
  async fetch(request, server) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (url.searchParams.get('token') !== token || request.headers.get('origin') !== `http://127.0.0.1:${server.port}`) return new Response('Forbidden', { status: 403 });
      if (server.upgrade(request)) return;
      return new Response('Upgrade required', { status: 400 });
    }
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
    const files = { '/': join(import.meta.dir, 'terminal.html'), '/xterm.js': join(root, 'node_modules/@xterm/xterm/lib/xterm.js'), '/graphics.js': join(root, 'tools/visual/graphics.js'), '/xterm.css': join(root, 'node_modules/@xterm/xterm/css/xterm.css') };
    return files[url.pathname] ? new Response(Bun.file(files[url.pathname])) : new Response('Not found', { status: 404 });
  },
  websocket: {
    async open(ws) { await stop(); await start(ws); },
    async message(ws, data) {
      const message = JSON.parse(String(data));
      if (message.type === 'restart') { await stop(); ws.send(JSON.stringify({ type: 'reset' })); await start(ws); return; }
      if (active?.ws === ws && ['input', 'resize'].includes(message.type)) {
        if(message.type==='resize')terminalSize={cols:Math.max(16,Math.min(240,Number(message.cols)||100)),rows:Math.max(12,Math.min(100,Number(message.rows)||30))};
        appendFileSync(join(output, 'input.jsonl'), JSON.stringify({ time: Date.now(), ...message }) + '\n');
        active.proc.stdin.write(JSON.stringify(message) + '\n'); active.proc.stdin.flush();
      }
    },
    async close(ws) { if (active?.ws === ws) await stop(); },
  },
});
let closing = false;
async function shutdown() { if (closing) return; closing = true; await stop(); server.stop(true); await rm(cwd, { recursive: true, force: true }); process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
console.log(`VISUAL_URL=http://127.0.0.1:${server.port}/?token=${token}${process.env.VISUAL_GRAPHICS === "kitty" ? "&graphics=kitty" : ""}${process.env.VISUAL_EXECUTABLE ? "&mode=binary" : ""}`);
