import {expect,it} from 'vitest';
import {surfaceActions} from '../src/surface-actions.js';

it('keeps advertised targets unique across native tabs, lines and expanded table details',()=>{
  expect(surfaceActions({
    tabs:[{id:'all',label:'All',action:'show-all'},{id:'disabled',label:'Unavailable',action:'disabled',disabled:true}],
    lines:[{text:'Overview',action:'show-all'},{text:'Add',action:'add'},{text:'Read only'}],
    table:{columns:[{label:'Name'}],rows:[
      {id:'expanded',cells:['Expanded'],action:'expand',expanded:true,details:[{text:'Configure',action:'configure'},{text:'Add',action:'add'}]},
      {id:'collapsed',cells:['Collapsed'],action:'toggle',expanded:false,details:[{text:'Hidden action',action:'hidden'}]},
    ]},
  })).toEqual(['show-all','add','expand','configure','toggle']);
  expect(surfaceActions()).toEqual([]);
});
