import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { contained } from './paths.js';

/** The stdio transport implemented by the shared MCP gateway. */
export const mcpServerSchema = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().trim().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(120000).optional(),
}).strict();
export const mcpServerMapSchema = z.record(z.string().min(1), mcpServerSchema);
const wrappedMapSchema = z.object({mcpServers:mcpServerMapSchema}).strict();
const sourceSchema = z.union([z.string().min(1), mcpServerMapSchema, wrappedMapSchema]);
export const pluginMcpSourcesSchema = z.union([sourceSchema, z.array(sourceSchema)]);
export type PluginMcpSources = z.infer<typeof pluginMcpSourcesSchema>;
export type PluginMcpServer = z.infer<typeof mcpServerSchema>;

function expand(value: string, root: string) {
  return value.replaceAll('${PLUGIN_ROOT}', () => root).replaceAll('${CLAUDE_PLUGIN_ROOT}', () => root);
}

/** Read declarations only. No module imports, process launch or config writes. */
export async function readPluginMcp(root: string, name: string, sources?: PluginMcpSources): Promise<Record<string, PluginMcpServer>> {
  const base = await realpath(root);
  const local = new Map<string, PluginMcpServer>();
  async function absorb(value: unknown) {
    const direct = mcpServerMapSchema.safeParse(value);
    const record = value as {mcpServers?: unknown} | null;
    const servers = direct.success ? direct.data : record && Object.hasOwn(record, 'mcpServers')
      ? wrappedMapSchema.parse(value).mcpServers : mcpServerMapSchema.parse(value);
    for (const [key, config] of Object.entries(servers)) {
      local.set(key, {
        ...config,
        command: expand(config.command, base),
        ...(config.args ? {args: config.args.map(value => expand(value, base))} : {}),
        ...(config.env ? {env:Object.fromEntries(Object.entries(config.env).map(([key,value]) => [key,expand(value,base)]))} : {}),
        ...(config.cwd ? {cwd:resolve(base,expand(config.cwd,base))} : {}),
      });
    }
  }
  async function file(path:string, optional=false) {
    try { await absorb(JSON.parse(await readFile(await contained(base,path),'utf8'))); }
    catch (error) { if (!optional || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await file('.mcp.json', true);
  if (sources !== undefined) {
    const parsed = pluginMcpSourcesSchema.parse(sources);
    for (const source of Array.isArray(parsed) ? parsed : [parsed]) {
      if (typeof source === 'string') await file(source);
      else await absorb(source);
    }
  }
  return Object.fromEntries([...local].map(([key,server]) => [`${name}-${key}`, server]));
}
