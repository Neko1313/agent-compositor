import {describe,it,expect,vi} from 'vitest';
import {createPublicRenderMeasurements} from '../src/public-render.js';

describe('public render measurements',()=>{
  it('reports only finite public cell geometry and deduplicates identical native frames',()=>{
    const measure=vi.fn(),port=createPublicRenderMeasurements({measure});
    expect(port.publish({columns:71.9,rows:12.8,visible:true,scrollOffset:4.2})).toBe(true);
    expect(measure).toHaveBeenLastCalledWith({columns:71,rows:12,visible:true,scrollOffset:4,scrollOrigin:'layout'});
    expect(port.publish({columns:71,rows:12,visible:true,scrollOffset:4})).toBe(false);
    expect(port.publish({columns:NaN,rows:12,visible:true,scrollOffset:4})).toBe(false);
    expect(port.publish({columns:71,rows:Infinity,visible:true,scrollOffset:4})).toBe(false);
    expect(port.publish({columns:71,rows:12,visible:true,scrollOffset:-1})).toBe(false);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(measure.mock.calls[0][0])).toBe(true);
  });

  it('keeps differently sized copies and native scroll projections independent',()=>{
    const a=vi.fn(),b=vi.fn(),first=createPublicRenderMeasurements({measure:a}),second=createPublicRenderMeasurements({measure:b});
    first.publish({columns:80,rows:20,visible:true,scrollOffset:0});
    second.publish({columns:38,rows:8,visible:true,scrollOffset:12});
    first.publish({columns:80,rows:20,visible:true,scrollOffset:1});
    expect(a).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenLastCalledWith({columns:38,rows:8,visible:true,scrollOffset:12,scrollOrigin:'layout'});
  });

  it('revokes visibility on hide or detach and rejects callbacks from a detached widget',()=>{
    const measure=vi.fn(),port=createPublicRenderMeasurements({measure});
    port.publish({columns:60,rows:10,visible:true,scrollOffset:7});port.hide();port.hide();
    expect(measure).toHaveBeenCalledTimes(2);
    expect(measure).toHaveBeenLastCalledWith({columns:60,rows:10,visible:false,scrollOffset:7,scrollOrigin:'layout'});
    port.publish({columns:60,rows:10,visible:true,scrollOffset:7});port.dispose();port.dispose();
    expect(port.publish({columns:90,rows:20,visible:true,scrollOffset:0})).toBe(false);
    expect(measure).toHaveBeenCalledTimes(4);
    expect(measure).toHaveBeenLastCalledWith({columns:60,rows:10,visible:false,scrollOffset:7,scrollOrigin:'layout'});
  });

  it('does not mark an unmeasured or zero-sized public region visible',()=>{
    const measure=vi.fn(),port=createPublicRenderMeasurements({measure});
    port.hide();expect(measure).toHaveBeenLastCalledWith({columns:0,rows:0,visible:false,scrollOffset:0,scrollOrigin:'layout'});
    port.publish({columns:30,rows:0,visible:true,scrollOffset:0});
    expect(measure).toHaveBeenLastCalledWith({columns:30,rows:0,visible:false,scrollOffset:0,scrollOrigin:'layout'});
    expect(port.publish({columns:Number.MAX_VALUE,rows:10,visible:true,scrollOffset:0})).toBe(false);
  });

  it('forwards explicit input even when the clamped native offset matches a layout observation',()=>{
    const measure=vi.fn(),port=createPublicRenderMeasurements({measure});
    const geometry={columns:60,rows:10,visible:true,scrollOffset:0};
    port.publish(geometry);
    expect(port.publish({...geometry,scrollOrigin:'input'})).toBe(true);
    expect(port.publish(geometry)).toBe(false);
    expect(port.publish({...geometry,scrollOrigin:'input'})).toBe(true);
    expect(measure).toHaveBeenCalledTimes(3);
    expect(measure).toHaveBeenLastCalledWith({...geometry,scrollOrigin:'input'});
  });
});
