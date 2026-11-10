import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {generate} from './generate.mjs';
import {pages, pluginManifests, root} from './structure.mjs';

await generate({check:true});
const inventory=pages(), sources=new Set(inventory.map(page=>page.source));
assert.equal(sources.size,inventory.length,'Duplicate documentation source');
assert.equal(new Set(inventory.map(page=>page.slug)).size,inventory.length,'Duplicate documentation route');
assert.equal(new Set(inventory.map(page=>page.id)).size,inventory.length,'Duplicate documentation ID');
for(const page of inventory)await readFile(resolve(root,page.source),'utf8');
for(const entry of await readdir(resolve(root,'docs'),{recursive:true}))
  if(entry.endsWith('.md'))assert(sources.has(`docs/${entry}`),`Page missing from navigation inventory: docs/${entry}`);
const coverage=JSON.parse(await readFile(resolve(root,'tools/docs/coverage.json'),'utf8'));
const packageNames=(await readdir(resolve(root,'packages'))).sort();
assert.deepEqual(Object.keys(coverage.packages).sort(),packageNames,'Maintain documentation coverage for every package');
for(const list of [...Object.values(coverage.packages),...Object.values(coverage.paths)]) {
  assert(list.length>0,'Documentation coverage must have targets');
  for(const source of list)assert(sources.has(source),`Coverage points outside published documentation: ${source}`);
}
for(const plugin of pluginManifests())
  for(const name of ['README','CHANGELOG'])assert(sources.has(`plugins/${plugin.directory}/${name}.md`),`Missing plugin documentation: ${plugin.name}/${name}`);
const tutorial=await readFile(resolve(root,'docs/first-plugin.md'),'utf8');
const matches=[...tutorial.matchAll(/<!-- include-example: ([\w./-]+) -->\s*```\w+\n([\s\S]*?)\n```\s*<!-- end-example -->/g)];
assert(matches.length>0,'First-plugin tutorial lost its executable example');
for(const [,file,code]of matches)assert.equal(code.trim(),(await readFile(resolve(root,file),'utf8')).trim(),`Tutorial differs from tested source: ${file}`);
const manifest=JSON.parse(await readFile(resolve(root,'tools/docs/examples/hello/plugin.json'),'utf8'));
const shownManifest=JSON.parse(/```json\n([\s\S]*?)\n```/.exec(tutorial)[1]);
assert.deepEqual(shownManifest,manifest,'Tutorial manifest differs from tested package');
console.log(`Documentation coverage checked: ${inventory.length} pages, ${packageNames.length} packages, ${pluginManifests().length} plugins and ${matches.length} executable example.`);
