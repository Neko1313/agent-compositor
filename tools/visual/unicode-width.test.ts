import {createRequire} from 'node:module';
import {expect,it} from 'vitest';

const require=createRequire(import.meta.url);
const {Terminal}=require('@xterm/xterm');
const {Unicode11Addon}=require('@xterm/addon-unicode11');

it('uses the modern scalar width profile for unchanged native cursor-diff ANSI',async()=>{
  // Moving the marker past a width-two emoji reuses the neighboring cells.
  // Unicode6 leaves the old one-cell emoji behind on these exact same writes.
  const ansi='\x1b[1;1HDraft: |A😀窗éZ\x1b[1;8HA😀\x1b[1;11H|窗éZ';
  const replay=async(modern:boolean)=>{
    const terminal=new Terminal({cols:40,rows:2,allowProposedApi:true});
    try{
      if(modern){terminal.loadAddon(new Unicode11Addon());terminal.unicode.activeVersion='11';}
      await new Promise<void>(done=>terminal.write(ansi,done));
      const row=terminal.buffer.active.getLine(0);
      return{version:terminal.unicode.activeVersion,text:row.translateToString(true),
        emoji:{ch:row.getCell(8).getChars(),width:row.getCell(8).getWidth()},
        ideograph:{ch:row.getCell(11).getChars(),width:row.getCell(11).getWidth()},
        combining:{ch:row.getCell(13).getChars(),width:row.getCell(13).getWidth()}};
    }finally{terminal.dispose();}
  };
  const legacy=await replay(false),modern=await replay(true);
  expect(legacy.version).toBe('6');expect(legacy.text).toContain('😀😀');
  expect(modern).toEqual({version:'11',text:'Draft: A😀|窗éZ',
    emoji:{ch:'😀',width:2},ideograph:{ch:'窗',width:2},combining:{ch:'é',width:1}});
});
