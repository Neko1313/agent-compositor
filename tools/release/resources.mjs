import { access, cp, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, posix } from 'node:path';

/** Copy declared data/config files without following resources outside a package. */
export async function copyPluginResources(source, destination, manifest) {
  const root = await realpath(source);
  const inside = async path => {
    const value = relative(root, await realpath(path));
    if (value === '..' || value.startsWith('../') || isAbsolute(value)) throw Error('Plugin resource escapes root');
    return true;
  };
  const references = (Array.isArray(manifest.mcpServers) ? manifest.mcpServers : [manifest.mcpServers]).filter(item => typeof item === 'string');
  const declared = [...(manifest.resources ?? []), ...references];
  for (const resource of new Set(['assets','skills','.mcp.json','worker.mjs','install.mjs','distribution.mjs','README.md',...declared])) {
    const name = posix.normalize(resource.replaceAll('\\', '/')).replace(/\/$/, '');
    if (name === '.' || isAbsolute(name) || resource.split(/[\\/]/).includes('..')) throw Error('Bundle resources must use package-relative paths');
    // The bundle owns its generated entries and host dependency distribution.
    if (/^(?:plugin\.json|hooks\.js|tools\.js|compositor|VERSION|node_modules|bin)(?:\/|$)/.test(name)) throw Error('Resource collides with a generated bundle entry');
    try { await access(join(source,name)); }
    catch (error) { if (!declared.includes(resource) && error.code === 'ENOENT') continue; throw error; }
    await inside(join(source,name));
    await cp(join(source,name),join(destination,name),{recursive:true,dereference:true,filter:inside});
  }
}
