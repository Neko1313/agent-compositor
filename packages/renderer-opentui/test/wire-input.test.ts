import {it,expect} from 'vitest';
import {wireKey,wireMouse} from '../src/wire-input.js';

it('preserves Unicode text, named controls, function modifiers and shifted legacy workspaces',()=>{
 expect(wireKey({name:'a',sequence:'A😀窗',shift:true})).toEqual({kind:'text',text:'A😀窗'});
 expect(wireKey({name:'return',sequence:'\r'})).toEqual({kind:'key',key:'enter',modifiers:[]});
 expect(wireKey({name:'linefeed',sequence:'\n'})).toEqual({kind:'key',key:'j',modifiers:['ctrl']});
 expect(wireKey({name:'f4',sequence:'\x1b[1;6S',ctrl:true,shift:true})).toEqual({kind:'key',key:'f4',modifiers:['ctrl','shift']});
 expect(wireKey({name:'unknown',sequence:'\x1b!'})).toEqual({kind:'key',key:'1',modifiers:['meta','shift']});
 expect(wireKey({name:'shift',sequence:''})).toBeUndefined();
});
it('sends terminal-global zero-based mouse coordinates and wheel/drag/release without geometry mutation',()=>{
 expect(wireMouse({type:'down',button:0,x:17,y:4})).toEqual({kind:'mouse',col:17,row:4,button:'left',action:'press'});
 expect(wireMouse({type:'drag',button:0,x:18,y:5})).toEqual({kind:'mouse',col:18,row:5,button:'left',action:'move'});
 expect(wireMouse({type:'up',button:0,x:18,y:5})).toEqual({kind:'mouse',col:18,row:5,button:'left',action:'release'});
 expect(wireMouse({type:'scroll',button:5,x:1,y:2,scroll:{direction:'down',delta:1}})).toEqual({kind:'mouse',col:1,row:2,button:'wheel-down',action:'press'});
 expect(wireMouse({type:'over',button:0,x:0,y:0})).toBeUndefined();expect(wireMouse({type:'down',button:0,x:-1,y:0})).toBeUndefined();
});
