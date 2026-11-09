import { expect, it } from 'vitest';
import { diskManifestSchema } from '../src/manifest.js';
it('preserves the default trust and validates dynamic hook timeout maps',()=>{
  const base={name:'example',version:'1.0.0'};
  expect(diskManifestSchema.parse(base)).toEqual({...base,trust:'trusted'});
  expect(diskManifestSchema.parse({...base,hookTimeouts:{'service.ui.ask':600000}}).hookTimeouts).toEqual({'service.ui.ask':600000});
  for(const hookTimeouts of [{event:0},{event:600001},{event:'100'}])
    expect(diskManifestSchema.safeParse({...base,hookTimeouts}).success).toBe(false);
  expect(diskManifestSchema.safeParse({...base,trust:'invalid'}).success).toBe(false);
});
