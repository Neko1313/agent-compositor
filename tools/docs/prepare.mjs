import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pages, repository, root, sections} from './structure.mjs';
import {generate} from './generate.mjs';

await generate({check:true});
const output = resolve(root, 'website/.content');
await mkdir(output, {recursive:true});
const inventory = pages();
const sources=new Set(inventory.map(page=>page.source));
for(const name of await readdir(output,{recursive:true}))
  if(name.endsWith('.md')&&!sources.has(name))await rm(resolve(output,name));
async function writeChanged(target,content) {
  if(await readFile(target,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;})!==content)
    await writeFile(target,content);
}
for(const page of inventory) {
  let content = await readFile(resolve(root,page.source), 'utf8');
  content = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const metadata = {
    slug:page.slug,
    custom_edit_url:`${repository}/edit/main/${page.source}`,
    ...(page.label ? {sidebar_label:page.label} : {}),
  };
  const header = Object.entries(metadata).map(([key,value])=>`${key}: ${JSON.stringify(value)}`).join('\n');
  const target = resolve(output,page.source);
  await mkdir(dirname(target),{recursive:true});
  await writeChanged(target,`---\n${header}\n---\n\n${content}`);
}
const groups = [...sections.map(([name])=>name), 'Plugins', 'Authoring cookbook'];
const sidebar = groups.map(group=>({type:'category',label:group,collapsed:group!=='Start here',items:inventory.filter(page=>page.group===group).map(page=>({type:'doc',id:page.id,...(page.label?{label:page.label}:{})}))}));
await writeChanged(resolve(output,'sidebars.json'),JSON.stringify({manual:sidebar},null,2)+'\n');
console.log(`Prepared ${inventory.length} pages from canonical repository sources.`);
