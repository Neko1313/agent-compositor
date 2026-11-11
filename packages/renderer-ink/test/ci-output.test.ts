import {it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const fixture=fileURLToPath(new URL('./fixtures/ci-output.mjs',import.meta.url));
for(const mode of ['tty','pipe'])it(`paints ${mode} output correctly with inherited CI flags`,()=>{
 // Ink caches CI detection when imported; a fresh process must see the flags.
 const result=execFileSync(process.execPath,['--import','tsx',fixture,mode],{
  env:{...process.env,CI:'1',CONTINUOUS_INTEGRATION:'1'},encoding:'utf8',timeout:5000,stdio:'pipe',
 });
 expect(JSON.parse(result)).toEqual({tty:mode==='tty',beforeExit:mode==='tty',afterExit:true});
});
