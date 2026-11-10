import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {contained} from './paths.js';
import {components,traits,requirementIds} from './testing.js';
export const pluginStandardSchema=z.object({standard:z.literal(1),apiVersion:z.literal(1)}).strict();
const suite=z.object({layer:z.enum(['unit','integration']),files:z.array(z.string().min(1)).min(1),pattern:z.string().optional()}).strict();
const legacy={plugin:z.string().regex(/^[a-z][a-z0-9-]*$/),tests:z.array(suite).min(1),visual:z.string().optional(),evals:z.array(z.string()).optional()};
export const certificationCaseSchema=z.object({
 id:z.string().regex(/^[a-z][a-z0-9.-]*$/),
 requirements:z.array(z.enum(requirementIds as [string,...string[]])).min(1),
 kind:z.enum(['deterministic','visual','live','artifact','upgrade']),
 // The fixture, expected effects and oracle are reviewed with the test, rather than inferred from its title.
 setup:z.string().min(12),expect:z.array(z.string().min(8)).min(1),forbidden:z.array(z.string().min(8)).min(1),
 timeoutMs:z.number().int().min(100).max(600000),
 run:z.discriminatedUnion('runner',[
  z.object({runner:z.literal('vitest'),file:z.string().min(1),test:z.string().min(1)}).strict(),
  z.object({runner:z.literal('scenario'),file:z.string().min(1),args:z.array(z.string()).default([])}).strict(),
 ]),
}).strict();
export const certifiedTestPlanSchema=z.object({
 ...legacy,schemaVersion:z.literal(2),
 profiles:z.object({components:z.array(z.enum(components)).min(1),traits:z.array(z.enum(traits))}).strict(),
 platforms:z.array(z.enum(['linux-x64','linux-arm64','darwin-x64','darwin-arm64'])).min(1),
 modelPolicy:z.object({provider:z.string().min(1),name:z.string().min(1),repeats:z.number().int().min(2),successFloor:z.number().gt(0).max(1),baseline:z.string().min(12),taskSet:z.string().min(1),taskSetSha256:z.string().regex(/^[a-f0-9]{64}$/),configuration:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()]))}).strict().optional(),
 previousVersion:z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+].+)?$/).nullable(),
 previousArtifacts:z.record(z.enum(['linux-x64','linux-arm64','darwin-x64','darwin-arm64']),z.object({url:z.string().url(),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).optional(),
 cases:z.array(certificationCaseSchema),
}).strict().superRefine((plan,ctx)=>{
 for(const [key,values]of Object.entries({components:plan.profiles.components,traits:plan.profiles.traits,platforms:plan.platforms,cases:plan.cases.map(c=>c.id)})){
  if(new Set(values).size!==values.length)ctx.addIssue({code:'custom',message:'Duplicate '+key});
 }
 for(const c of plan.cases){
  if(new Set(c.requirements).size!==c.requirements.length)ctx.addIssue({code:'custom',message:'Duplicate case requirements: '+c.id});
  if(c.kind!=='deterministic' && c.run.runner!=='scenario')ctx.addIssue({code:'custom',message:'UI, model, migration and artifact evidence require a scenario'});
 }
 if(plan.previousVersion!==null&&!plan.previousArtifacts)ctx.addIssue({code:'custom',message:'Previous releases need pinned artifact checksums'});
 if(plan.profiles.traits.includes('model')&&!plan.modelPolicy)ctx.addIssue({code:'custom',message:'Model profile requires a declared policy before evaluation'});
 if(plan.profiles.components.includes('skill')&&!plan.profiles.traits.includes('model'))ctx.addIssue({code:'custom',message:'Skills require model evaluation'});
 if(plan.profiles.components.includes('agent-service')&&!plan.profiles.traits.includes('model'))ctx.addIssue({code:'custom',message:'Agent services require model evaluation'});
 if(plan.profiles.components.includes('interactive-ui')&&!plan.profiles.components.includes('view'))ctx.addIssue({code:'custom',message:'Interactive UI requires view checks'});
});
export const pluginTestPlanSchema=z.union([z.object({...legacy,schemaVersion:z.literal(1)}).strict(),certifiedTestPlanSchema]);
export type CertifiedTestPlan=z.infer<typeof certifiedTestPlanSchema>;
export type CertificationCase=z.infer<typeof certificationCaseSchema>;
export async function readPluginTestPlan(root:string,name:string){
 const plan=pluginTestPlanSchema.parse(JSON.parse(await readFile(await contained(root,'plugin.test.json'),'utf8')));
 if(plan.plugin!==name)throw Error('Test plan identity does not match plugin');
 return plan;
}
