import {afterEach, expect, it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {mcpCallTool, __mcpShutdown} from '../../../plugins/mcp/tools.js';

const roots: string[] = [], pids: number[] = [];
const savedConfig = process.env.AGENT_MCP_CONFIG;
afterEach(async () => {
 __mcpShutdown();
 for (const pid of pids.splice(0)) {
  try {if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL'); else process.kill(pid, 'SIGKILL');} catch {}
 }
 for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
 if (savedConfig === undefined) delete process.env.AGENT_MCP_CONFIG; else process.env.AGENT_MCP_CONFIG = savedConfig;
});

async function alive(pid: number) {
 try {process.kill(pid, 0);} catch {return false;}
 // An orphan zombie has already stopped; its reaping belongs to the host init.
 if (process.platform === 'linux') {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
  if (!stat || /\)\s+Z\s/.test(stat)) return false;
 }
 return true;
}

it('kills a cached detached MCP server synchronously when the owning process exits', async () => {
 const root = await mkdtemp(join(tmpdir(), 'mcp-exit-'));roots.push(root);
 const server = join(root, 'server.cjs');
 await writeFile(server, `const {createInterface}=require('node:readline');
setInterval(()=>{},1000);
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.id===undefined)return;
 const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{pid:process.pid,content:[]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
});`);
 const launcher = join(root, 'launcher.mjs');
 const module = pathToFileURL(resolve('plugins/mcp/tools.ts')).href;
 await writeFile(launcher, `import {mcpCallTool} from ${JSON.stringify(module)};
const response=await mcpCallTool.execute({cwd:${JSON.stringify(root)},settings:async()=>({mcpServers:{local:{command:process.execPath,args:[${JSON.stringify(server)}]}}})},{action:'call',server:'local',tool:'pid'});
if(!response.ok)throw Error(response.error);
console.log(response.data.pid);
process.exit(0);`);
 const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', launcher], {
  cwd: process.cwd(), timeout: 10000,
  env: {PATH: process.env.PATH, HOME: root, ...(process.env.SYSTEMROOT ? {SYSTEMROOT: process.env.SYSTEMROOT} : {})},
 });
 const pid = Number(result.stdout.trim());expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);pids.push(pid);
 await expect.poll(() => alive(pid), {timeout: 1500}).toBe(false);
}, 15000);

it('does not read configuration or create a connection for an already cancelled operation', async () => {
 delete process.env.AGENT_MCP_CONFIG;
 const controller = new AbortController();controller.abort(new Error('cancelled before MCP launch'));
 let reads = 0;
 const result = await mcpCallTool.execute({cwd: '.', signal: controller.signal, settings: async () => {reads++;return {mcpServers: {}};}}, {action: 'list'});
 expect(result).toMatchObject({ok: false, error: expect.stringContaining('cancelled before MCP launch')});
 expect(reads).toBe(0);
});

it('rejects cancellation that arrives while configuration is loading', async () => {
 delete process.env.AGENT_MCP_CONFIG;
 const controller = new AbortController();
 const result = await mcpCallTool.execute({cwd: '.', signal: controller.signal, settings: async () => {
  controller.abort(new Error('cancelled during MCP configuration'));
  return {mcpServers: {}};
 }}, {action: 'list'});
 expect(result).toMatchObject({ok: false, error: expect.stringContaining('cancelled during MCP configuration')});
});

it.each(['call', 'list'] as const)('kills a server cancelled during %s initialization and reconnects on the next operation', async action => {
 delete process.env.AGENT_MCP_CONFIG;
 const root = await mkdtemp(join(tmpdir(), 'mcp-cancel-'));roots.push(root);
 const marker = join(root, 'pid'), first = join(root, 'stall-once'), server = join(root, 'server.cjs');
 await writeFile(first, 'stall');
 await writeFile(server, `const fs=require('node:fs'),{createInterface}=require('node:readline');
const stall=fs.existsSync(${JSON.stringify(first)});if(stall)fs.unlinkSync(${JSON.stringify(first)});
fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));
setInterval(()=>{},1000);
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.id===undefined||stall)return;
 const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:{pid:process.pid,content:[]};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
});`);
 const settings = async () => ({mcpServers: {local: {command: process.execPath, args: [server], timeoutMs: 4000}}});
 const controller = new AbortController();
 const operation = mcpCallTool.execute({cwd: root, signal: controller.signal, settings}, {action, server: 'local', tool: 'pid'});
 let firstPid = 0;
 await expect.poll(async () => {firstPid = Number(await readFile(marker, 'utf8').catch(() => ''));return firstPid > 0;}, {timeout: 5000}).toBe(true);
 pids.push(firstPid);
 controller.abort();
 expect(await operation).toMatchObject({ok: false, error: expect.stringMatching(/cancelled|aborted/i)});
 await expect.poll(() => alive(firstPid)).toBe(false);
 const response = await mcpCallTool.execute({cwd: root, settings}, {action: 'call', server: 'local', tool: 'pid'});
 expect(response).toMatchObject({ok: true});
 const secondPid = Number(await readFile(marker, 'utf8'));pids.push(secondPid);
 expect(secondPid).not.toBe(firstPid);
 expect(await alive(secondPid)).toBe(true);
 __mcpShutdown();
 await expect.poll(() => alive(secondPid)).toBe(false);
}, 15000);
