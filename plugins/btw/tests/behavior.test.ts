import {it,expect,vi} from 'vitest';
import hooks from '../hooks.js';
it('leaves similarly prefixed commands untouched and handles a side question once',async()=>{
 const complete=vi.fn(async()=>'four'),notify=vi.fn();const api={model:{complete},ui:{notify}};
 for(const name of ['/btw-unrelated','/btwOther','/btwhat'])expect(await hooks['command.invoke']({name,args:''},api)).toBeUndefined();
 expect(complete).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();
 await hooks['command.invoke']({name:'/btw',args:'--once what is two plus two?'},api);
 expect(complete).toHaveBeenCalledTimes(1);expect(notify).toHaveBeenCalledExactlyOnceWith('four','info');
});
