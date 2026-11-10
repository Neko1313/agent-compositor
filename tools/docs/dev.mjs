import {spawn,execFileSync} from 'node:child_process';
import {watch} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {pages,root} from './structure.mjs';

const prepare=()=>execFileSync(process.execPath,[resolve(root,'tools/docs/prepare.mjs')],{cwd:root,stdio:'inherit'});
prepare();
const server=spawn('npm',['run','start','-w','@agent-compositor/docs','--',...process.argv.slice(2)],{cwd:root,stdio:'inherit'});
let timer;
const watchers=[];
const directories=new Set([...pages().map(page=>dirname(resolve(root,page.source))),resolve(root,'tools/docs'),resolve(root,'plugins'),root]);
for(const directory of directories)watchers.push(watch(directory,(_event,name)=>{
  if(!name||!(/\.(?:md|json)$/.test(String(name))||String(name)==='structure.mjs'))return;
  clearTimeout(timer);
  timer=setTimeout(()=>{try{prepare();}catch{console.error('Documentation projection was not refreshed. Fix the reported issue or run npm run docs:gen.');}},150);
}));
function stop(){clearTimeout(timer);for(const watcher of watchers)watcher.close();server.kill('SIGTERM');}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
server.once('exit',code=>{clearTimeout(timer);for(const watcher of watchers)watcher.close();process.exitCode=code??0;});
