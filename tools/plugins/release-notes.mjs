import {readFile,writeFile} from 'node:fs/promises';
export function releaseNotes(changelog,version){
 const headers=[...changelog.matchAll(/^##\s+([^\s]+).*$/gm)],header=headers.find(item=>item[1]===version);
 if(!header)throw Error('Missing changelog entry for '+version);
 return changelog.slice(header.index,headers.find(item=>item.index>header.index)?.index??changelog.length).replace(/<!-- plugin-release:auto:(?:start|end) -->\n?/g,'').trim()+'\n';
}
if(import.meta.main){
 const[name,output]=process.argv.slice(2);if(!/^[a-z][a-z0-9-]*$/.test(name??'')||!output)throw Error('Usage: bun tools/plugins/release-notes.mjs <plugin> <output>');
 const manifest=JSON.parse(await readFile(`plugins/${name}/plugin.json`,'utf8'));
 await writeFile(output,releaseNotes(await readFile(`plugins/${name}/CHANGELOG.md`,'utf8'),manifest.version));
}
