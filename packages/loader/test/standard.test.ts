import {it,expect} from 'vitest';
import {SEMVER,compareVersions,pluginTestPlanSchema,diskManifestSchema} from '../src/index.js';
it('accepts optional local UI command sites and rejects path or transport escapes',()=>{
 const command=(ui?:unknown)=>({name:'probe',version:'1.0.0',commands:[{name:'/probe',description:'Open probe',...(ui===undefined?{}:{ui})}]});
 expect(diskManifestSchema.parse(command()).commands?.[0].ui).toBeUndefined();
 expect(diskManifestSchema.parse(command({site:'main-view'})).commands?.[0].ui).toEqual({site:'main-view'});
 for(const site of ['','../other','other/site','UPPER','a'.repeat(65)])expect(diskManifestSchema.safeParse(command({site})).success).toBe(false);
 expect(diskManifestSchema.safeParse(command({site:'main',plugin:'other'})).success).toBe(false);
});
it('orders independent versions according to SemVer precedence',()=>{
 const ordered=['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0','1.0.1','1.1.0','2.0.0'];
 for(let i=1;i<ordered.length;i++){expect(compareVersions(ordered[i-1],ordered[i])).toBeLessThan(0);expect(compareVersions(ordered[i],ordered[i-1])).toBeGreaterThan(0);}
 expect(compareVersions('1.0.0+one','1.0.0+two')).toBe(0);
});
it.each(['1.0','v1.0.0','01.2.3','1.0.0-01','1.0.0-','1.0.0+'])('refuses invalid package version %s',value=>{expect(SEMVER.test(value)).toBe(false);expect(()=>compareVersions(value,'1.0.0')).toThrow();});
it('rejects unsupported compatibility declarations and empty or unknown test layers',()=>{
 const base={name:'probe',version:'1.0.0',trust:'trusted'};
 expect(diskManifestSchema.safeParse({...base,compositor:{standard:1,apiVersion:1}}).success).toBe(true);
 expect(diskManifestSchema.safeParse({...base,compositor:{standard:2,apiVersion:1}}).success).toBe(false);
 expect(diskManifestSchema.safeParse({...base,compositor:{standard:1,apiVersion:2}}).success).toBe(false);
 expect(pluginTestPlanSchema.safeParse({schemaVersion:1,plugin:'probe',tests:[]}).success).toBe(false);
 expect(pluginTestPlanSchema.safeParse({schemaVersion:1,plugin:'probe',tests:[{layer:'fake',files:['x']}]}).success).toBe(false);
});
