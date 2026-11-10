import {readFile,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const DEFAULT_MARKETPLACE='agent-compositor';
export const DEFAULT_MARKETPLACE_REPOSITORY='https://github.com/Neko1313/agent-compositor.git';
/** Locate the shipped snapshot without trusting the working directory or using the network. */
export async function bundledMarketplaceRoot(){
  const candidates=[dirname(await realpath(process.execPath))];
  let directory=dirname(fileURLToPath(import.meta.url));
  while(true){candidates.push(directory);const parent=dirname(directory);if(parent===directory)break;directory=parent;}
  for(const root of candidates){
    const path=join(root,'.claude-plugin/marketplace.json');
    try{const catalog=JSON.parse(await readFile(path,'utf8'));if(catalog.name===DEFAULT_MARKETPLACE)return root;}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  return undefined;
}
