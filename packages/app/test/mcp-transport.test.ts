import {afterEach, expect, it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const roots: string[] = [];
afterEach(async () => {
 for (const root of roots.splice(0)) {
  const pid = Number(await readFile(join(root, 'pid'), 'utf8').catch(() => ''));
  if (pid > 0) try {if (process.platform !== 'win32') process.kill(-pid, 'SIGKILL'); else process.kill(pid, 'SIGKILL');} catch {}
  await rm(root, {recursive: true, force: true});
 }
});
const unicode = 'Привет 👻 中文';
async function run(mode: string) {
 const root = await mkdtemp(join(tmpdir(), 'mcp-transport-'));roots.push(root);
 const server = join(root, 'server.cjs'), log = join(root, 'messages.jsonl');
 await writeFile(server, `const {createInterface}=require('node:readline'),fs=require('node:fs');
const mode=${JSON.stringify(mode)};let init,peerId;
fs.writeFileSync(${JSON.stringify(join(root, 'pid'))},String(process.pid));setInterval(()=>{},1000);
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const initialized=q=>send({jsonrpc:'2.0',id:q.id,result:{protocolVersion:q.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}});
createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(q)+'\\n');
 if(q.method===undefined){
  if(init&&q.id===peerId&&((mode.startsWith('ping')&&q.result)||(mode==='unsupported'&&q.error?.code===-32601))){const request=init;init=undefined;initialized(request);}
  return;
 }
 if(q.method==='initialize'){
  if(mode.startsWith('ping')||mode==='unsupported'){init=q;peerId=mode==='ping-string'?'server-ping':q.id;send({jsonrpc:'2.0',id:peerId,method:mode.startsWith('ping')?'ping':'sampling/createMessage',params:{}});return;}
  const bad={null:null,array:[],primitive:42,version:{jsonrpc:'1.0',id:q.id,result:{}},missing:{jsonrpc:'2.0',id:q.id},both:{jsonrpc:'2.0',id:q.id,result:{},error:{code:-32000,message:'ambiguous'}},error:{jsonrpc:'2.0',id:q.id,error:'invalid error'}};
  if(Object.hasOwn(bad,mode)){send(bad[mode]);initialized(q);return;}
  if(mode==='interleaved'){process.stdout.write('legacy server log\\n');send({jsonrpc:'2.0',method:'notifications/message',params:{level:'info',data:'fixture'}});send({jsonrpc:'2.0',id:999,result:{ignored:true}});}
  initialized(q);return;
 }
 if(q.method==='tools/call'){
  if((mode.startsWith('ping')||mode==='unsupported')&&init){send({jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'Server request not answered'}});return;}
  if(mode==='eof'){process.stdout.end();return;}
  if(mode==='oversize'){process.stdout.write('x'.repeat(2000001));return;}
  const result={content:[{type:'text',text:${JSON.stringify(unicode)}}]};
  const response={jsonrpc:'2.0',id:q.id,result};
  if(mode==='utf8'){
   const bytes=Buffer.from(JSON.stringify(response)+'\\n'),point=bytes.indexOf(Buffer.from('👻'))+1;
   process.stdout.write(bytes.subarray(0,point));setTimeout(()=>process.stdout.write(bytes.subarray(point)),50);return;
  }
  send(response);
 }
});`);
 const owner = join(root, 'owner.mjs');
 await writeFile(owner, `import{mcpCallTool,dispose}from ${JSON.stringify(pathToFileURL(resolve('plugins/mcp/tools.ts')).href)};
try{const result=await mcpCallTool.execute({cwd:${JSON.stringify(root)},settings:async()=>({mcpServers:{fixture:{command:process.execPath,args:[${JSON.stringify(server)}],timeoutMs:2000}}})},{action:'call',server:'fixture',tool:'probe'});console.log(JSON.stringify(result));}finally{dispose();}`);
 const {stdout} = await promisify(execFile)(process.execPath, ['--import', 'tsx', owner], {
  cwd: process.cwd(), timeout: 10000,
  env: {PATH: process.env.PATH, HOME: root, ...(process.env.SYSTEMROOT ? {SYSTEMROOT: process.env.SYSTEMROOT} : {})},
 });
 const messages = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
 return {result: JSON.parse(stdout.trim()), messages};
}

it('preserves a multibyte character split across stdout chunks', async () => {
 const {result} = await run('utf8');
 expect(result).toMatchObject({ok: true, data: {content: [{text: unicode}]}});
}, 15000);

it.each(['null', 'array', 'primitive', 'version', 'missing', 'both', 'error'])('turns invalid %s RPC envelopes into error values without crashing the owner', async mode => {
 const {result} = await run(mode);
 expect(result).toMatchObject({ok: false, error: expect.stringMatching(/MCP.*(invalid|malformed)/i)});
}, 15000);

it.each(['ping', 'ping-string', 'unsupported'])('answers a server %s request separately from pending client requests', async mode => {
 const {result, messages} = await run(mode);
 expect(result).toMatchObject({ok: true, data: {content: [{text: unicode}]}});
 expect(messages).toContainEqual(mode !== 'unsupported' ? {jsonrpc: '2.0', id: mode === 'ping-string' ? 'server-ping' : 1, result: {}} : {jsonrpc: '2.0', id: 1, error: {code: -32601, message: 'Method not found'}});
}, 15000);

it('keeps valid notifications and unmatched responses separate from pending calls', async () => {
 expect((await run('interleaved')).result).toMatchObject({ok: true, data: {content: [{text: unicode}]}});
}, 15000);

it('fails a closed stdout pipe without waiting for the live server request timeout', async () => {
 const {result} = await run('eof');
 expect(result).toMatchObject({ok: false, error: expect.stringMatching(/MCP.*(output|stdout).*closed/i)});
}, 15000);

it('retains the existing message bound for an oversized unterminated stdout line', async () => {
 expect((await run('oversize')).result).toMatchObject({ok: false, error: 'MCP message exceeds limit'});
}, 15000);
