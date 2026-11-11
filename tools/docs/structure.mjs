import {readdirSync, readFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const repository = 'https://github.com/Neko1313/agent-compositor';
export const baseUrl = '/agent-compositor/';

export const sections = [
  ['Start here', ['overview', 'getting-started', 'first-plugin']],
  ['Use Compositor', ['agent-features', 'workspaces-and-web', 'state-and-network', 'marketplace']],
  ['Build extensions', ['plugin-authoring', 'plugin-standard', 'plugin-testing', 'ui-theming', 'ui-controllers', 'core-customization']],
  ['Understand the architecture', ['architecture', '01-concept', '02-ui', '03-contracts', '04-motivation', 'tui-design']],
  ['Reference', ['events', 'reference/cli', 'reference/plugins', 'reference/packages']],
  ['Contribute', ['contributing', 'documentation', 'readiness', 'evals', 'dependencies', 'releases']],
  ['Design history', ['05-prior-art', '06-core-blueprint', 'harness-research-2026-11', 'INDEX']],
];

export function pluginManifests() {
  return readdirSync(resolve(root, 'plugins'), {withFileTypes:true})
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      try { return [{directory:entry.name, ...JSON.parse(readFileSync(resolve(root, 'plugins', entry.name, 'plugin.json'), 'utf8'))}]; }
      catch(error) { if(error.code === 'ENOENT') return []; throw error; }
    }).sort((a,b) => a.name.localeCompare(b.name));
}

export function pages() {
  const result = sections.flatMap(([group, names]) => names.map(name => ({
    source:`docs/${name}.md`, id:`docs/${name}`, slug:name === 'overview' ? '/' : name === 'INDEX' ? '/design-history' : `/${name}`, group,
    ...(name==='overview'?{label:'Overview'}:name==='INDEX'?{label:'Decisions and milestones'}:{}),
  })));
  for(const plugin of pluginManifests()) {
    result.push({source:`plugins/${plugin.directory}/README.md`, id:`plugins/${plugin.directory}/README`, slug:`/plugins/${plugin.name}`, group:'Plugins', label:plugin.name});
    result.push({source:`plugins/${plugin.directory}/CHANGELOG.md`, id:`plugins/${plugin.directory}/CHANGELOG`, slug:`/plugins/${plugin.name}/changelog`});
  }
  result.push({source:'packages/app/README.md',id:'packages/app/README',slug:'/reference/terminal',group:'Reference',label:'Terminal manual'});
  result.push({source:'tools/visual/README.md',id:'tools/visual/README',slug:'/contributing/visual-bench',group:'Contribute',label:'Visual verification bench'});
  result.push({source:'CHANGELOG.md',id:'CHANGELOG',slug:'/changelog',group:'Contribute',label:'Changelog'});
  for(const name of ['SKILL', 'references/composition', 'references/contracts', 'references/patterns', 'references/standard', 'references/testing']) {
    result.push({source:`plugins/plugin-author/skills/create-plugin/${name}.md`,id:`plugins/plugin-author/skills/create-plugin/${name}`,slug:`/authoring/${name.toLowerCase()}`,group:'Authoring cookbook'});
  }
  return result;
}
