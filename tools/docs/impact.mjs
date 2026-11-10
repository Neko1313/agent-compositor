import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {root} from './structure.mjs';

const baseline=process.argv[2]??'HEAD';
const paths=execFileSync('git',['diff','--name-only','--diff-filter=ACMR',baseline,'--'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const coverage=JSON.parse(await readFile(resolve(root,'tools/docs/coverage.json'),'utf8'));
const targets=new Set();
for(const file of paths) {
  const packageName=/^packages\/([^/]+)\//.exec(file)?.[1];
  for(const target of coverage.packages[packageName]??[])targets.add(target);
  const plugin=/^plugins\/([^/]+)\//.exec(file)?.[1];
  if(plugin)targets.add(`plugins/${plugin}/README.md`);
  for(const [prefix,list]of Object.entries(coverage.paths))if(file.startsWith(prefix))for(const target of list)targets.add(target);
}
console.log(`Documentation impact against ${baseline} (${paths.length} changed files):`);
for(const target of [...targets].sort())console.log(`  ${target}${paths.includes(target)?' [updated]':' [review]'}`);
console.log(targets.size?'Review behavior, examples, defaults and limitations; explain unaffected pages in the PR.':'No mapped implementation paths changed. Review new capabilities for missing coverage.');
