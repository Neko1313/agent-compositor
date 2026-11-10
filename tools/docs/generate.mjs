import {execFileSync} from 'node:child_process';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pluginManifests, repository, root} from './structure.mjs';

const notice='> Generated from repository sources. Run `npm run docs:gen`; do not edit by hand.\n';
const cell=value=>String(value??'—').replaceAll('|','\\|').replaceAll('\n',' ');
export async function generate({check=false}={}) {
  const help=execFileSync('bun',['packages/app/src/bin.ts','--help'],{cwd:root,encoding:'utf8',timeout:30000});
  const host=JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
  const cli=`# CLI reference\n\n${notice}\nThis reference describes the main branch. The host package version is **${host.version}**.\n\n\`\`\`text\n${help.trim()}\n\`\`\`\n\nSee [getting started](../getting-started.md) for complete examples and [the terminal manual](../../packages/app/README.md) for keyboard and mouse controls.\n`;
  const plugins=pluginManifests();
  const inventory=`# Plugin reference\n\n${notice}\nAll ${plugins.length} filesystem plugins start inactive. [Install and explicitly enable](../marketplace.md) a package in user or project scope before using it. Plugin versions are independent of the host.\n\n| Plugin | Version | Purpose |\n| --- | --- | --- |\n${plugins.map(p=>`| [${p.name}](../../plugins/${p.directory}/README.md) | ${p.version} | ${cell(p.description)} |`).join('\n')}\n\nEach plugin page links to its own changelog. Bundled source availability does not imply an independently published plugin archive.\n`;
  const roles={app:'Assembles the interactive and headless product.',core:'Active multi-turn agent engine and replaceable execution strategies.',agent:'Historical reference loop and pane demo; not the active product engine.',events:'Versioned event schemas and generated catalog.',runtime:'Onion event dispatcher, ordering, deadlines and fault handling.',hooks:'Public plugin API, guarded services and private UI controllers.',loader:'Manifest validation, module loading and lifecycle.',plugins:'Compatibility facade over the shared loader.',protocol:'Versioned JSONL messages and capability negotiation.','renderer-ink':'Reference terminal renderer consuming protocol frames.',provider:'Model adapters, routing, capabilities and network transport.',config:'Layered configuration, scoped storage and placement settings.',permissions:'Tool policy rules and approval decisions.',session:'Conversation journal, history and replaceable repository routing.',context:'Token budgets and transcript compaction.',tools:'Standard tools, execution and attached-workspace access.',skills:'Progressive skill discovery and loading.',cli:'Line-based compatibility interface.'};
  const packages=[];
  for(const name of (await readdir(resolve(root,'packages'))).sort()) {
    const metadata=JSON.parse(await readFile(resolve(root,'packages',name,'package.json'),'utf8'));
    packages.push(`| [\`${metadata.name}\`](${repository}/tree/main/packages/${name}) | ${cell(roles[name]??metadata.description)} |`);
  }
  const overview=`# Package map\n\n${notice}\nThe monorepo contains ${packages.length} packages. Public extension contracts live in their exported entry points; internal application modules are implementation details.\n\n| Package | Responsibility |\n| --- | --- |\n${packages.join('\n')}\n\nRead [the architecture guide](../architecture.md), [kernel customization](../core-customization.md), and [UI controller contracts](../ui-controllers.md) before changing composition boundaries.\n`;
  const targets=new Map([['docs/reference/cli.md',cli],['docs/reference/plugins.md',inventory],['docs/reference/packages.md',overview]]);
  const stale=[];
  for(const [name,content]of targets) {
    const file=resolve(root,name),current=await readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
    if(content===current)continue;
    if(check)stale.push(name);
    else {await mkdir(dirname(file),{recursive:true});await writeFile(file,content);}
  }
  if(stale.length)throw new Error(`Generated documentation is stale: ${stale.join(', ')}. Run npm run docs:gen and commit the result.`);
  console.log(`Documentation references ${check?'checked':'generated'}: CLI, ${plugins.length} plugins, ${packages.length} packages.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await generate({check:process.argv.includes('--check')});
