import {it,expect,vi} from 'vitest';
import hooks from '../hooks.js';
it('leaves similarly prefixed commands untouched and handles a side question once',async()=>{
 const complete=vi.fn(async()=>'four'),notify=vi.fn();const api={model:{complete},ui:{notify}};
 for(const text of ['/btw-unrelated','/btwOther','/btwhat'])expect(await hooks['prompt.submit']({text},api)).toBeUndefined();
 expect(complete).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();
 expect(await hooks['prompt.submit']({text:'/btw what is two plus two?'},api)).toEqual({drop:'btw: answered on the side'});
 expect(complete).toHaveBeenCalledTimes(1);expect(notify).toHaveBeenCalledExactlyOnceWith('four','info');
});
