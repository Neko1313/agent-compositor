// CI search prerequisite, independent of Ubuntu package mirror availability.
import {mkdtemp,mkdir,readFile,writeFile,rename,rm,appendFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const RIPGREP_VERSION='15.1.0';
export const RIPGREP_SHA256='1c9297be4a084eea7ecaedf93eb03d058d6faae29bbc57ecdaf5063921491599';
const name=`ripgrep-${RIPGREP_VERSION}-x86_64-unknown-linux-musl`;
export async function installCiRipgrep({destination,archivePath}={}){
 if(process.platform!=='linux'||process.arch!=='x64')throw Error('This prerequisite installer targets Linux x64 CI jobs only');
 if(!destination)throw Error('An isolated destination is required');
 const temp=await mkdtemp(join(tmpdir(),'compositor-ci-rg-'));
 try{
  const archive=join(temp,'ripgrep.tar.gz');
  if(archivePath)await writeFile(archive,await readFile(archivePath));
  else await exec('curl',['--fail','--location','--silent','--show-error','--retry','2','--retry-all-errors','--max-time','120','--max-filesize','16777216','--output',archive,`https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${name}.tar.gz`],{timeout:370000});
  const bytes=await readFile(archive);
  if(createHash('sha256').update(bytes).digest('hex')!==RIPGREP_SHA256)throw Error('Ripgrep archive checksum mismatch');
  // Extract only known files to memory, never trust archive paths on disk.
  const extract=async file=>(await exec('tar',['-xOzf',archive,'--',`${name}/${file}`],{encoding:'buffer',maxBuffer:16777216,timeout:30000})).stdout;
  const binary=await extract('rg'),license=await extract('LICENSE-MIT');
  await writeFile(join(temp,'rg'),binary,{mode:0o755});
  const version=(await exec(join(temp,'rg'),['--version'],{timeout:5000})).stdout;
  if(version.trim().split(/\s+/).slice(0,2).join(' ')!==`ripgrep ${RIPGREP_VERSION}`)throw Error('Unexpected ripgrep binary version');
  await mkdir(destination,{recursive:true});
  const staged=await mkdtemp(join(destination,'.ripgrep-'));
  try{
   await writeFile(join(staged,'rg'),binary,{mode:0o755});await writeFile(join(staged,'LICENSE-MIT'),license);
   await rename(join(staged,'LICENSE-MIT'),join(destination,'ripgrep-LICENSE-MIT'));
   await rename(join(staged,'rg'),join(destination,'rg'));
  }finally{await rm(staged,{recursive:true,force:true});}
  return{version:RIPGREP_VERSION,sha256:RIPGREP_SHA256,directory:resolve(destination)};
 }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(!process.env.RUNNER_TEMP)throw Error('RUNNER_TEMP is required');
 const result=await installCiRipgrep({destination:join(process.env.RUNNER_TEMP,'compositor-ci-tools',RIPGREP_VERSION,'bin')});
 if(process.env.GITHUB_PATH)await appendFile(process.env.GITHUB_PATH,result.directory+'\n');
 console.log(JSON.stringify(result));
}
