import {afterEach, describe, expect, it} from 'vitest';
import {mkdtemp, mkdir, writeFile, rm, realpath, symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Runtime} from '@agent-compositor/runtime';
import {attach} from '@agent-compositor/hooks';
import {PluginLoader, readPluginMcp, loadClaudePlugin} from '../src/index.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(name='package',extra:Record<string,unknown>={}){
  const temporary=await mkdtemp(join(tmpdir(),'ac-mcp-package-'));roots.push(temporary);
  const root=join(await realpath(temporary),name);await mkdir(root);
  await writeFile(join(root,'plugin.json'),JSON.stringify({name:'native-package',version:'0.1.0',trust:'trusted',...extra}));
  return root;
}
const loader=(root:string)=>new PluginLoader(attach(new Runtime(),{session:{id:'test',cwd:root}}),{dirs:[root]});

describe('declarative plugin MCP',()=>{
  it('combines default files, explicit files and inline declarations with stable names and literal root expansion',async()=>{
    const root=await fixture('quoted " $& \\ package');
    await writeFile(join(root,'.mcp.json'),JSON.stringify({mcpServers:{one:{command:'node',args:['default']}}}));
    await writeFile(join(root,'extra.json'),JSON.stringify({two:{command:'${PLUGIN_ROOT}/server',args:['${PLUGIN_ROOT}/args'],env:{ROOT:'${CLAUDE_PLUGIN_ROOT}'},cwd:'.'}}));
    const servers=await readPluginMcp(root,'owner',['extra.json',{one:{command:'node',args:['override']}}]);
    expect(servers).toEqual({'owner-one':{command:'node',args:['override']},'owner-two':{command:join(root,'server'),args:[join(root,'args')],env:{ROOT:root},cwd:root}});
  });
  it('loads MCP-only and skill-only packages without requiring a dummy executable entry',async()=>{
    const root=await fixture();
    await writeFile(join(root,'.mcp.json'),JSON.stringify({mcpServers:{local:{command:'node'}}}));
    const report=await loader(root).loadAll();
    expect(report.failed).toEqual([]);expect(report.loaded[0]).toMatchObject({hookCount:0,mcpServers:{'native-package-local':{command:'node'}}});
    const skill=await fixture('skills');await mkdir(join(skill,'skills','workflow'),{recursive:true});
    await writeFile(join(skill,'skills/workflow/SKILL.md'),'---\nname: workflow\ndescription: Local workflow\n---\nUse it.');
    expect((await loader(skill).loadAll()).failed).toEqual([]);
  });
  it.each([
    {local:{type:'http',url:'https://example.invalid/mcp'}},
    {local:{command:'node',args:[42]}},
    {local:{command:'node',env:{TOKEN:42}}},
    {local:{command:'node',timeoutMs:-1}},
  ])('rejects unsupported or invalid transports before native code import: %j',async value=>{
    const root=await fixture();
    await writeFile(join(root,'.mcp.json'),JSON.stringify({mcpServers:value}));
    await writeFile(join(root,'hooks.ts'),"throw Error('MUST_NOT_IMPORT');");
    const report=await loader(root).loadAll();
    expect(report.loaded).toEqual([]);expect(report.failed).toHaveLength(1);expect(report.failed[0].reason).not.toContain('MUST_NOT_IMPORT');
  });
  it('supports inline manifest maps and refuses render-only MCP before executable import',async()=>{
    const root=await fixture('view',{trust:'render-only',mcpServers:{local:{command:'node'}}});
    await writeFile(join(root,'hooks.ts'),"throw Error('MUST_NOT_IMPORT');");
    const report=await loader(root).loadAll();expect(report.failed[0].reason).toContain('render-only');
  });
  it('refuses config path traversal and symlink escapes',async()=>{
    const root=await fixture(),external=await fixture('outside');
    await writeFile(join(external,'config.json'),JSON.stringify({mcpServers:{local:{command:'node'}}}));
    await symlink(join(external,'config.json'),join(root,'.mcp.json'));
    await expect(readPluginMcp(root,'owner')).rejects.toThrow('escapes');
    await rm(join(root,'.mcp.json'));
    await expect(readPluginMcp(root,'owner','../outside/config.json')).rejects.toThrow();
    await expect(readPluginMcp(root,'owner','missing.json')).rejects.toMatchObject({code:'ENOENT'});
  });
  it('keeps Claude declarations on the same parser and preserves legacy IDs',async()=>{
    const root=await fixture();await rm(join(root,'plugin.json'));await mkdir(join(root,'.claude-plugin'));
    await writeFile(join(root,'.claude-plugin/plugin.json'),JSON.stringify({name:'portable',version:'1.0.0',mcpServers:[{mcpServers:{local:{command:'node',args:['${CLAUDE_PLUGIN_ROOT}/server.mjs']}}}]}));
    expect((await loadClaudePlugin(root)).mcpServers).toEqual({'portable-local':{command:'node',args:[join(root,'server.mjs')]}});
  });
  it('reports ambiguous server IDs across owners instead of silently shadowing one',async()=>{
    const root=await fixture('market-root');
    await rm(join(root,'plugin.json'));
    for(const [name,local] of [['a','b-c'],['a-b','c']]){
      const path=join(root,name);await mkdir(path);
      await writeFile(join(path,'plugin.json'),JSON.stringify({name,version:'1.0.0',trust:'trusted',mcpServers:{[local]:{command:'node'}}}));
    }
    const report=await loader(root).loadAll();expect(report.loaded).toHaveLength(1);expect(report.failed).toHaveLength(1);expect(report.failed[0].reason).toContain('collision');
  });
  it('validates resource containment before imports',async()=>{
    const root=await fixture('resource',{resources:['../outside']});
    await writeFile(join(root,'hooks.ts'),"throw Error('MUST_NOT_IMPORT');");
    const report=await loader(root).loadAll();expect(report.failed).toHaveLength(1);expect(report.failed[0].reason).not.toContain('MUST_NOT_IMPORT');
  });
});
