import {afterEach, expect, it} from 'vitest';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ScriptedProvider, type ScriptedStep} from '@agent-compositor/core';
import {buildApp, type BuiltApp} from '../src/build.js';
import {mcpCallTool} from '../../../plugins/mcp/tools.js';

const roots: string[] = [], apps: BuiltApp[] = [];
const savedConfig = process.env.AGENT_MCP_CONFIG;
afterEach(async () => {
 for (const app of apps.splice(0)) await app.close();
 for (const root of roots.splice(0)) await rm(root, {recursive: true, force: true});
 if (savedConfig === undefined) delete process.env.AGENT_MCP_CONFIG; else process.env.AGENT_MCP_CONFIG = savedConfig;
});
const cursor = 'opaque/page-2+==';
const definition = {
 name: 'lookup', title: 'Lookup a ticket', description: 'Read one ticket',
 inputSchema: {type: 'object', properties: {ticket: {type: 'string', pattern: '^PROJECT-[0-9]+$'}}, required: ['ticket'], additionalProperties: false},
 outputSchema: {type: 'object', properties: {title: {type: 'string'}}, required: ['title']},
 annotations: {readOnlyHint: true}, _meta: {fixture: 'preserved'},
};
async function fixture(pages: unknown[], callResult: unknown = {content: [{type: 'text', text: 'Ticket found'}], structuredContent: {title: 'Implement discovery'}}, steps: ScriptedStep[] = []) {
 delete process.env.AGENT_MCP_CONFIG;
 const cwd = await mkdtemp(join(tmpdir(), 'mcp-discovery-'));roots.push(cwd);
 const server = join(cwd, 'server.cjs'), log = join(cwd, 'requests.jsonl');
 await writeFile(server, `const {createInterface}=require('node:readline'),fs=require('node:fs');
const pages=${JSON.stringify(pages)},callResult=${JSON.stringify(callResult)};
createInterface({input:process.stdin}).on('line',line=>{
 const r=JSON.parse(line);if(r.id===undefined)return;
 fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({method:r.method,params:r.params})+'\\n');
 const result=r.method==='initialize'?{protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:r.method==='tools/list'?pages[r.params.cursor===${JSON.stringify(cursor)}?1:0]:callResult;
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
});`);
 await mkdir(join(cwd, '.agent-compositor'));
 await writeFile(join(cwd, '.agent-compositor/mcp.json'), JSON.stringify({mcpServers: {
  catalog: {command: process.execPath, args: [server]},
  unrelated: {command: join(cwd, 'must-not-start')},
 }}));
 await writeFile(join(cwd, 'agent-compositor.json'), JSON.stringify({enabledPlugins: ['mcp'], agent: {projectContext: false, fileReferences: false, skills: false}}));
 const provider = new ScriptedProvider(steps);
 const app = await buildApp({cwd, env: {HOME: cwd}, provider, pluginDirs: [join(process.cwd(), 'plugins/mcp')], agentHub: false});apps.push(app);
 const core = app.createCore(async () => true);
 const requests = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
 return {core, provider, requests};
}

it('preserves complete discovered schemas and cursors without fetching later pages or unrelated servers', async () => {
 const f = await fixture([{tools: [definition], nextCursor: cursor}, {tools: [{name: 'second', inputSchema: {type: 'object'}}]}]);
 const first = await f.core.invokeTool('mcp_call', {action: 'list', server: 'catalog'});
 expect(first).toMatchObject({ok: true, output: {servers: [{name: 'catalog', tools: [definition], nextCursor: cursor}]}});
 expect((first.output as any).servers).toHaveLength(1);
 expect((await f.requests()).filter(r => r.method === 'tools/list')).toEqual([{method: 'tools/list', params: {}}]);
 const second = await f.core.invokeTool('mcp_call', {action: 'list', server: 'catalog', cursor});
 expect(second).toMatchObject({ok: true, output: {servers: [{name: 'catalog', tools: [{name: 'second', inputSchema: {type: 'object'}}]}]}});
 expect((second.output as any).servers[0]).not.toHaveProperty('nextCursor');
 expect((await f.requests()).filter(r => r.method === 'tools/list')).toHaveLength(2);
 expect((await f.requests()).at(-1)).toEqual({method: 'tools/list', params: {cursor}});
 expect(f.provider.requests).toHaveLength(0);
});

it('reports MCP execution errors as failures and retains structured diagnostics for correction', async () => {
 const result = {isError: true, content: [{type: 'text', text: 'Ticket does not exist'}], structuredContent: {field: 'ticket', code: 'NOT_FOUND'}};
 const f = await fixture([{tools: [definition]}], result);
 const response = await f.core.invokeTool('mcp_call', {action: 'call', server: 'catalog', tool: 'lookup', arguments: {ticket: 'PROJECT-42'}});
 expect(response).toMatchObject({ok: false, error: expect.stringContaining('NOT_FOUND')});
 expect(response.error).toContain('Ticket does not exist');
 expect(response.error).toContain('catalog');
});

it('keeps untargeted discovery compatible while isolating a failed server', async () => {
 const f = await fixture([{tools: [definition], nextCursor: cursor}]);
 const response = await f.core.invokeTool('mcp_call', {action: 'list'});
 expect(response).toMatchObject({ok: true, output: {servers: [
  {name: 'catalog', tools: [definition], nextCursor: cursor},
  {name: 'unrelated', error: expect.any(String)},
 ]}});
});

it.each([null, {tools: 'invalid'}, {tools: [{name: 4}]}, {tools: [], nextCursor: 42}])('reports malformed discovery data %j inline', async page => {
 const f = await fixture([page]);
 expect(await f.core.invokeTool('mcp_call', {action: 'list', server: 'catalog'})).toMatchObject({ok: true, output: {servers: [{name: 'catalog', error: expect.stringContaining('MCP tools/list')}]}});
});

it.each([
 null, [], {action: 'list', cursor}, {action: 'list', server: 'catalog', cursor: 42},
 {action: 'call', server: 'catalog', tool: 'lookup', cursor},
].map(args => ({args})))('rejects invalid gateway arguments $args before reading configuration', async ({args}) => {
 delete process.env.AGENT_MCP_CONFIG;
 let reads = 0;
 const result = await mcpCallTool.execute({cwd: '.', settings: async () => {reads++;return {mcpServers: {}};}}, args);
 expect(result).toMatchObject({ok: false});
 expect(reads).toBe(0);
});

it('delivers discovery schemas, an explicitly requested later page and structured results through the agent model contract', async () => {
 const value = {content: [{type: 'text', text: 'Ticket found'}], structuredContent: {title: 'Implement discovery'}, isError: false};
 const f = await fixture([{tools: [definition], nextCursor: cursor}, {tools: [{name: 'second', inputSchema: {type: 'object'}}]}], value, [
  {toolCalls: [{name: 'mcp_call', args: {action: 'list', server: 'catalog'}}]},
  {toolCalls: [{name: 'mcp_call', args: {action: 'list', server: 'catalog', cursor}}]},
  {toolCalls: [{name: 'mcp_call', args: {action: 'call', server: 'catalog', tool: 'lookup', arguments: {ticket: 'PROJECT-42'}}}]},
  {text: 'Found the ticket.'},
 ]);
 await f.core.submit('Find the ticket using the configured MCP server.');
 expect(f.core.failure).toBeUndefined();
 expect(f.provider.requests).toHaveLength(4);
 const toolData = (request: number) => JSON.parse(f.provider.requests[request].messages.filter(m => m.role === 'tool').at(-1)!.content);
 expect(toolData(1)).toEqual({servers: [{name: 'catalog', tools: [definition], nextCursor: cursor}]});
 expect(toolData(2)).toEqual({servers: [{name: 'catalog', tools: [{name: 'second', inputSchema: {type: 'object'}}]}]});
 expect(toolData(3)).toEqual(value);
 expect((await f.requests()).filter(r => r.method === 'tools/list')).toHaveLength(2);
 expect((await f.requests()).at(-1)).toEqual({method: 'tools/call', params: {name: 'lookup', arguments: {ticket: 'PROJECT-42'}}});
});

it.each([null, 42, {isError: 'false'}])('rejects malformed call results %j', async result => {
 const f = await fixture([{tools: [definition]}], result);
 expect(await f.core.invokeTool('mcp_call', {action: 'call', server: 'catalog', tool: 'lookup'})).toMatchObject({ok: false, error: expect.stringContaining('MCP tools/call')});
});

it('records an MCP execution error as failed and supplies its diagnostics to the next model step', async () => {
 const f = await fixture([{tools: [definition]}], {isError: true, content: [{type: 'text', text: 'Ticket does not exist'}], structuredContent: {code: 'NOT_FOUND'}}, [
  {toolCalls: [{name: 'mcp_call', args: {action: 'call', server: 'catalog', tool: 'lookup', arguments: {ticket: 'PROJECT-42'}}}]},
  {text: 'The ticket lookup failed.'},
 ]);
 const results: unknown[] = [];
 f.core.subscribe(event => {if (event.kind === 'catalog' && event.event === 'tool.result') results.push(event.input);});
 await f.core.submit('Find the ticket.');
 expect(results).toContainEqual(expect.objectContaining({tool: 'mcp_call', ok: false}));
 expect(f.provider.requests).toHaveLength(2);
 const feedback = f.provider.requests[1].messages.filter(m => m.role === 'tool').at(-1)!.content;
 expect(feedback).toContain('NOT_FOUND');
 expect(feedback).toContain('Ticket does not exist');
});
