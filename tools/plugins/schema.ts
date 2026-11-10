import {z} from 'zod';
import {readFile,writeFile} from 'node:fs/promises';
import {pluginTestPlanSchema,pluginStandardSchema} from '@agent-compositor/loader';
for(const [file,schema]of Object.entries({'schema/plugin-test.json':pluginTestPlanSchema,'schema/plugin-standard.json':pluginStandardSchema})){
 const text=JSON.stringify(z.toJSONSchema(schema),null,2)+'\n';
 if(process.argv.includes('--check')){if(await readFile(file,'utf8')!==text)throw Error(`Regenerate ${file} with npm run plugin:schema`);}
 else await writeFile(file,text);
}
