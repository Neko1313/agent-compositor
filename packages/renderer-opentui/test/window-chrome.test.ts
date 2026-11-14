import {expect,it} from 'vitest';
import {contains,finderRectangle,titleControls,titleSegments} from '../src/window-chrome.js';

it('uses exactly the six painted control cells and leaves title borders draggable',()=>{
  const frame={surface:'copy-7',x:31,y:4,width:31,height:12},controls=titleControls(frame,true);
  expect(controls).toEqual([{surface:'copy-7',action:'zoom',x:55,y:4,width:3,height:1},{surface:'copy-7',action:'close',x:58,y:4,width:3,height:1}]);
  expect(controls.filter(control=>contains(control,57,4)).map(control=>control.action)).toEqual(['zoom']);
  expect(controls.filter(control=>contains(control,58,4)).map(control=>control.action)).toEqual(['close']);
  for(const [x,y]of [[31,4],[54,4],[61,4],[58,5]])expect(controls.some(control=>contains(control,x,y))).toBe(false);
});

it('moves controls with the actual frame and omits unavailable or unreadable title actions',()=>{
  const frame={surface:'session',x:0,y:0,width:14,height:5};
  expect(titleControls(frame,false)).toEqual([]);
  expect(titleControls({...frame,width:13},true)).toEqual([]);
  expect(titleControls({...frame,height:0},true)).toEqual([]);
  expect(titleControls({...frame,x:100,y:20},true)[0]).toMatchObject({x:107,y:20,surface:'session'});
});

it('shares bounded Finder geometry between native layout and chrome occlusion',()=>{
  expect(finderRectangle(180,46)).toEqual({x:44,y:8,width:92,height:22});
  expect(finderRectangle(38,15)).toEqual({x:0,y:0,width:38,height:15});
  expect(finderRectangle(1,1)).toEqual({x:0,y:0,width:1,height:1});
});

it('clips title painting around a private Finder without exposing any of its cells',()=>{
  const frame={x:0,y:10,width:180,height:20},finder=finderRectangle(180,46),segments=titleSegments(frame,finder);
  expect(segments).toEqual([{x:0,y:10,width:44,height:1},{x:136,y:10,width:44,height:1}]);
  for(const segment of segments)for(let x=segment.x;x<segment.x+segment.width;x++)expect(contains(finder,x,segment.y)).toBe(false);
  expect(titleSegments({...frame,x:50,width:10},finder)).toEqual([]);
  expect(titleSegments({...frame,x:30,width:30},finder)).toEqual([{x:30,y:10,width:14,height:1}]);
});

it('does not clip unaffected title rows and respects the modal bottom/right boundary',()=>{
  const frame={x:10,y:0,width:60,height:20},finder={x:20,y:2,width:10,height:10};
  expect(titleSegments(frame,finder)).toEqual([{x:10,y:0,width:60,height:1}]);
  expect(titleSegments({...frame,y:12},finder)).toEqual([{x:10,y:12,width:60,height:1}]);
  expect(titleSegments({...frame,x:30,y:3,width:10},finder)).toEqual([{x:30,y:3,width:10,height:1}]);
  expect(titleSegments({...frame,width:0},finder)).toEqual([]);
});
