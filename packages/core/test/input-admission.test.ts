import {afterEach, expect, expectTypeOf, it} from 'vitest';
import {AgentCore, ScriptedProvider, type AgentCoreOptions, type CoreInputAdmission} from '../src/index.js';
import type {SessionEvent} from '@agent-compositor/session';

const cores: AgentCore[] = [], releases: (() => void)[] = [];
afterEach(async () => {
  for (const release of releases.splice(0))release();
  for (const core of cores.splice(0))await core.close();
});
function gate() {
  let release!: () => void, enter!: () => void;
  const pending = new Promise<void>(done => {release = done;}), entered = new Promise<void>(done => {enter = done;});
  releases.push(release);
  return {entered, release, wait: () => {enter();return pending;}};
}
function fixture(options: Partial<AgentCoreOptions> = {}) {
  const provider = new ScriptedProvider([{text: 'Completed'}]), journal: SessionEvent[] = [];
  const core = new AgentCore({cwd: process.cwd(), provider, tools: [], controlTools: [],
    sessions: {create: async () => {}, append: async (_id, events) => {journal.push(...events);}}, ...options});
  cores.push(core);return {core, provider, journal};
}

it('admits before a pending prompt hook consumes the input without a model turn or committed submit event', async () => {
  const hold = gate(), events: string[] = [];
  const f = fixture({plugins: [{manifest: {name: 'local-ui', version: '1.0.0', trust: 'trusted'}, hooks: {
    'prompt.submit': async () => {await hold.wait();return {drop: 'Local form handled'};},
  }}]});
  f.core.subscribe(event => {if (event.kind === 'catalog')events.push(event.event);});
  const receipt = f.core.dispatchInput('/local-form');
  expectTypeOf(receipt.admitted).toEqualTypeOf<Promise<CoreInputAdmission>>();
  expectTypeOf<ReturnType<AgentCore['submit']>>().toEqualTypeOf<Promise<void>>();
  expectTypeOf<ReturnType<AgentCore['steer']>>().toEqualTypeOf<Promise<void>>();
  expectTypeOf<ReturnType<AgentCore['invokeCommand']>>().toEqualTypeOf<Promise<boolean>>();
  let completed = false;void receipt.completion.then(() => {completed = true;});
  expect(await receipt.admitted).toBe('submitted');await hold.entered;
  expect(completed).toBe(false);expect(events).not.toContain('prompt.submit');expect(f.provider.requests).toHaveLength(0);
  hold.release();await receipt.completion;
  expect(await receipt.admitted).toBe('submitted');expect(f.provider.requests).toHaveLength(0);
  expect(f.journal.some(event => event.type === 'prompt.dropped')).toBe(true);
});

it.each(['submit', 'steer'] as const)('admits busy %s before its notification hook finishes and preserves its original queue semantics', async intent => {
  const hold = gate(), provider = new ScriptedProvider([
    {toolCalls: [{name: 'inspect', args: {}}], hold: true}, {text: 'Main completed'}, {text: 'Queued completed'},
  ]);
  const core = fixture({provider,
    tools: [{name: 'inspect', description: 'Read-only probe', parameters: {type: 'object'},
      describe: () => ({tool: 'inspect', readOnly: true}), execute: async () => ({ok: true, data: 'Inspected'})}],
    rules: [{tool: 'inspect', decision: 'allow'}],
    plugins: [{manifest: {name: 'notifications', version: '1.0.0', trust: 'trusted'},
      hooks: {[intent === 'submit' ? 'prompt.queued' : 'prompt.steer']: () => hold.wait()}}],
  }).core;
  const main = core.dispatchInput('Main');expect(await main.admitted).toBe('submitted');
  await expect.poll(() => provider.requests.length).toBe(1);
  const next = core.dispatchInput('Follow-up', intent);let completed = false;void next.completion.then(() => {completed = true;});
  expect(await next.admitted).toBe(intent === 'submit' ? 'queued' : 'steered');await hold.entered;
  expect(completed).toBe(false);expect(provider.requests).toHaveLength(1);
  hold.release();await next.completion;provider.release();await main.completion;
  expect(provider.requests).toHaveLength(intent === 'submit' ? 3 : 2);
  expect(provider.requests[intent === 'submit' ? 2 : 1].messages.some(message => message.role === 'user' && message.content === 'Follow-up')).toBe(true);
});

it('reports idle steering as a submitted turn', async () => {
  const f = fixture(), receipt = f.core.dispatchInput('Start from idle', 'steer');
  expect(await receipt.admitted).toBe('submitted');await receipt.completion;
  expect(f.provider.requests).toHaveLength(1);
});

it.each(['preparation', 'provider'] as const)('keeps admission accepted when %s fails later', async stage => {
  const provider = new ScriptedProvider([{error: 'Provider unavailable', finish: 'error'}]);
  const core = fixture({provider, ...(stage === 'preparation' ? {preparePrompt: async () => {throw Error('Preparation unavailable');}} : {})}).core;
  const receipt = core.dispatchInput('Accepted task');expect(await receipt.admitted).toBe('submitted');
  await receipt.completion;expect(await receipt.admitted).toBe('submitted');
  expect(core.failure).toContain(stage === 'preparation' ? 'Preparation unavailable' : 'Provider unavailable');
});

it('distinguishes a newly failed journal after admission from a previously failed journal before ownership', async () => {
  const core = fixture({sessions: {create: async () => {}, append: async (_id,events) => {if(events.some(event=>event.type==='prompt.submit'))throw Error('Storage unavailable');}}}).core;
  const first = core.dispatchInput('First');expect(await first.admitted).toBe('submitted');await first.completion;
  const next = core.dispatchInput('Never owned');expect(await next.admitted).toBe(false);await next.completion;
  expect(core.failure).toContain('Storage unavailable');
});

it('admits immediate commands before their handler finishes but rejects capacity and length before ownership', async () => {
  const hold = gate();let started = 0;
  const f = fixture({userCommands: () => [{name: '/control', plugin: 'controls'}],
    plugins: [{manifest: {name: 'controls', version: '1.0.0', trust: 'trusted'}, hooks: {
      'command.invoke': async () => {started++;await hold.wait();},
    }}]});
  const commands = Array.from({length: 4}, () => f.core.dispatchInput('/control'));
  expect(await Promise.all(commands.map(receipt => receipt.admitted))).toEqual(['command', 'command', 'command', 'command']);
  await expect.poll(() => started).toBe(4);
  const full = f.core.dispatchInput('/control');expect(await full.admitted).toBe(false);
  await expect(full.completion).rejects.toThrow('Four immediate commands');
  const oversized = f.core.dispatchInput('/control ' + 'x'.repeat(64000));expect(await oversized.admitted).toBe(false);
  await expect(oversized.completion).rejects.toThrow('64000');
  hold.release();await Promise.all(commands.map(receipt => receipt.completion));expect(f.provider.requests).toHaveLength(0);
});

it('keeps an accepted command failure separate and observes rejection when a caller only reads admission', async () => {
  const core = fixture({userCommands: () => [{name: '/fail', plugin: 'controls'}],
    plugins: [{manifest: {name: 'controls', version: '1.0.0', trust: 'trusted'}, hooks: {
      'command.invoke': () => {throw Error('Handler failed');},
    }}]}).core;
  const receipt = core.dispatchInput('/fail');expect(await receipt.admitted).toBe('command');
  await expect(receipt.completion).rejects.toThrow('Handler failed');expect(await receipt.admitted).toBe('command');
  expect(await core.dispatchInput('/fail').admitted).toBe('command');
  await new Promise<void>(done => setImmediate(done));
});

it.each(['submit', 'steer'] as const)('settles %s cancelled during a lifecycle reset without claiming ownership', async intent => {
  const hold = gate(), f = fixture({plugins: [{manifest: {name: 'lifecycle', version: '1.0.0', trust: 'trusted'},
    hooks: {'session.end': () => hold.wait()}}]});
  f.core.clear();await hold.entered;
  const receipt = f.core.dispatchInput('Cancelled while waiting', intent);let admission: CoreInputAdmission | undefined;
  void receipt.admitted.then(value => {admission = value;});await Promise.resolve();expect(admission).toBeUndefined();
  f.core.interrupt();hold.release();expect(await receipt.admitted).toBe(false);await receipt.completion;
  expect(f.provider.requests).toHaveLength(0);
});

it('admits after an uncancelled lifecycle reset finishes', async () => {
  const hold = gate(), f = fixture({plugins: [{manifest: {name: 'lifecycle', version: '1.0.0', trust: 'trusted'},
    hooks: {'session.end': () => hold.wait()}}]});
  f.core.clear();await hold.entered;const receipt = f.core.dispatchInput('After reset');
  hold.release();expect(await receipt.admitted).toBe('submitted');await receipt.completion;
  expect(f.provider.requests).toHaveLength(1);
});

it.each(['submit', 'steer'] as const)('rejects %s on a closed Core before admission and retains its completion error', async intent => {
  const f = fixture();await f.core.close();const receipt = f.core.dispatchInput('Closed', intent);
  expect(await receipt.admitted).toBe(false);await expect(receipt.completion).rejects.toThrow('Session is closed');
  expect(f.provider.requests).toHaveLength(0);
});

it('acknowledges queued user input only after its recovery intent is saved, without waiting for notification hooks', async () => {
  const write=gate(),hook=gate(),journal:SessionEvent[]=[];
  const provider=new ScriptedProvider([{text:'Working',hold:true},{text:'Completed'}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.queue.intent'))await write.wait();journal.push(...events);
  }},plugins:[{manifest:{name:'notify',version:'1.0.0',trust:'trusted'},hooks:{'prompt.queued':()=>hook.wait()}}]});
  const main=f.core.dispatchInput('Main');expect(await main.admitted).toBe('submitted');await expect.poll(()=>provider.requests.length).toBe(1);
  const next=f.core.dispatchInput('Retain this');let admission:CoreInputAdmission|undefined;void next.admitted.then(value=>{admission=value;});
  await write.entered;await Promise.resolve();expect(admission).toBeUndefined();
  write.release();expect(await next.admitted).toBe('queued');await hook.entered;
  const intent=journal.find(event=>event.type==='prompt.queue.intent');expect(intent).toMatchObject({text:'Retain this',recoveryId:expect.any(String)});
  const resumed=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([])},structuredClone(journal));cores.push(resumed);
  expect(resumed.getRecoveredInputs()).toEqual([{id:intent!.recoveryId,text:'Retain this'}]);
  hook.release();await next.completion;provider.release();await main.completion;
});

it('rejects queued admission if its recovery intent cannot be saved', async () => {
  const provider=new ScriptedProvider([{text:'Working',hold:true}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.queue.intent'))throw Error('disk unavailable');
  }}});
  const main=f.core.dispatchInput('Main');expect(await main.admitted).toBe('submitted');await expect.poll(()=>provider.requests.length).toBe(1);
  const next=f.core.dispatchInput('Keep my draft');expect(await next.admitted).toBe(false);
  await expect(next.completion).rejects.toThrow('Session journal failed');provider.release();await main.completion;
  expect(provider.requests).toHaveLength(1);
});

it('does not accept a new user turn until its recovery intent is saved', async () => {
  const write=gate(),hook=gate(),journal:SessionEvent[]=[];
  const f=fixture({sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.input.intent'))await write.wait();journal.push(...events);
  }},plugins:[{manifest:{name:'prompt-handler',version:'1.0.0',trust:'trusted'},hooks:{'prompt.submit':async()=>{await hook.wait();return {drop:'Handled'};}}}]});
  const receipt=f.core.dispatchInput('New input');let admitted:CoreInputAdmission|undefined;void receipt.admitted.then(value=>{admitted=value;});
  await write.entered;await Promise.resolve();expect(admitted).toBeUndefined();expect(f.provider.requests).toHaveLength(0);
  write.release();expect(await receipt.admitted).toBe('submitted');await hook.entered;
  const resumed=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([])},structuredClone(journal));cores.push(resumed);
  expect(resumed.getRecoveredInputs()).toMatchObject([{text:'New input'}]);
  hook.release();await receipt.completion;
  const after=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([])},structuredClone(journal));cores.push(after);
  expect(after.getRecoveredInputs()).toEqual([]);
});

it('rejects a new user turn when saving its recovery intent fails', async () => {
  const f=fixture({sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.input.intent'))throw Error('disk unavailable');
  }}});
  const receipt=f.core.dispatchInput('Keep this draft');expect(await receipt.admitted).toBe(false);await receipt.completion;
  expect(f.provider.requests).toHaveLength(0);expect(f.core.failure).toContain('disk unavailable');
});

it('releases an interrupted new input without waiting for a held intent write', async () => {
  const hold=gate(),f=fixture({sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.input.intent'))await hold.wait();
  }}});
  const receipt=f.core.dispatchInput('Stopped before admission');await hold.entered;f.core.interrupt();
  try{
    expect(await Promise.race([receipt.admitted,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('input still blocked')),500))])).toBe(false);
    expect(f.provider.requests).toHaveLength(0);
  }finally{hold.release();await receipt.completion;}
});

it('records steering intent before admission and makes unapplied steering reviewable', async () => {
  const journal:SessionEvent[]=[],write=gate(),provider=new ScriptedProvider([{text:'Final answer',hold:true}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.steer.intent'))await write.wait();journal.push(...events);
  }}});
  const main=f.core.dispatchInput('First');expect(await main.admitted).toBe('submitted');await expect.poll(()=>provider.requests.length).toBe(1);
  const steer=f.core.dispatchInput('Correction','steer');let accepted:CoreInputAdmission|undefined;void steer.admitted.then(value=>{accepted=value;});
  await write.entered;await Promise.resolve();expect(accepted).toBeUndefined();write.release();expect(await steer.admitted).toBe('steered');await steer.completion;
  provider.release();await main.completion;
  expect(f.core.getMessages().some(message=>message.content==='Correction')).toBe(false);
  expect(f.core.getRecoveredInputs()).toMatchObject([{text:'Correction'}]);
  const resumed=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([])},structuredClone(journal));cores.push(resumed);
  expect(resumed.getRecoveredInputs()).toMatchObject([{text:'Correction'}]);
  expect(resumed.getMessages().some(message=>message.content==='Correction')).toBe(false);
});

it('rejects steering when its intent cannot be saved', async () => {
  const provider=new ScriptedProvider([{text:'Working',hold:true}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.steer.intent'))throw Error('disk unavailable');
  }}});
  const main=f.core.dispatchInput('First');expect(await main.admitted).toBe('submitted');await expect.poll(()=>provider.requests.length).toBe(1);
  const steer=f.core.dispatchInput('Keep this correction','steer');expect(await steer.admitted).toBe(false);
  await expect(steer.completion).rejects.toThrow('Session journal failed');provider.release();await main.completion;
  expect(provider.requests).toHaveLength(1);
});

it('releases interrupted steering while its intent write is held', async () => {
  const write=gate(),provider=new ScriptedProvider([{text:'Working',hold:true}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.steer.intent'))await write.wait();
  }}});
  const main=f.core.dispatchInput('First');await main.admitted;await expect.poll(()=>provider.requests.length).toBe(1);
  const steer=f.core.dispatchInput('Stopped correction','steer');await write.entered;f.core.interrupt();
  try {expect(await Promise.race([steer.admitted,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('steering still blocked')),500))])).toBe(false);}
  finally {write.release();provider.release();await steer.completion;await main.completion;}
});

it('submits steering as a new turn if the running turn finishes while its intent is being saved', async () => {
  const write=gate(),provider=new ScriptedProvider([{text:'First done',hold:true},{text:'Correction handled'}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.steer.intent'))await write.wait();
  }}});
  const main=f.core.dispatchInput('First');await main.admitted;await expect.poll(()=>provider.requests.length).toBe(1);
  const steer=f.core.dispatchInput('Late correction','steer');await write.entered;provider.release();await main.completion;
  write.release();expect(await steer.admitted).toBe('submitted');await steer.completion;
  expect(provider.requests).toHaveLength(2);expect(provider.requests[1].messages.at(-1)?.content).toBe('Late correction');
});

it('replays a steering message that reached the next model step and excludes it from recovery', async () => {
  const journal:SessionEvent[]=[];
  const provider=new ScriptedProvider([{toolCalls:[{name:'probe',args:{}}],hold:true},{text:'Done'}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{journal.push(...events);}},
    tools:[{name:'probe',description:'Read-only probe',parameters:{type:'object'},describe:()=>({tool:'probe',readOnly:true}),execute:async()=>({ok:true,data:'ok'})}],
    rules:[{tool:'probe',decision:'allow'}]});
  const main=f.core.dispatchInput('First');await main.admitted;await expect.poll(()=>provider.requests.length).toBe(1);
  const steer=f.core.dispatchInput('Applied correction','steer');expect(await steer.admitted).toBe('steered');await steer.completion;
  provider.release();await main.completion;
  expect(provider.requests[1].messages.some(message=>message.content==='Applied correction')).toBe(true);
  expect(journal.some(event=>event.type==='prompt.steer.applied')).toBe(true);
  const resumed=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([])},structuredClone(journal));cores.push(resumed);
  expect(resumed.getRecoveredInputs()).toEqual([]);
  expect(resumed.getMessages().filter(message=>message.content==='Applied correction')).toHaveLength(1);
});

it('keeps a steer consistent when interruption races its applied journal write', async () => {
  const journal:SessionEvent[]=[],applied=gate();
  const provider=new ScriptedProvider([{toolCalls:[{name:'probe',args:{}}],hold:true},{text:'Must not run'}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.steer.applied'))await applied.wait();journal.push(...events);
  }},tools:[{name:'probe',description:'Read-only probe',parameters:{type:'object'},describe:()=>({tool:'probe',readOnly:true}),execute:async()=>({ok:true,data:'ok'})}],
    rules:[{tool:'probe',decision:'allow'}]});
  const main=f.core.dispatchInput('First');await main.admitted;await expect.poll(()=>provider.requests.length).toBe(1);
  const steer=f.core.dispatchInput('Applied as stopping','steer');await steer.admitted;await steer.completion;
  provider.release();await applied.entered;f.core.interrupt();applied.release();await main.completion;
  expect(provider.requests).toHaveLength(1);
  expect(f.core.getMessages().filter(message=>message.content==='Applied as stopping')).toHaveLength(1);
  expect(f.core.getRecoveredInputs()).toEqual([]);
  const resumed=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([])},structuredClone(journal));cores.push(resumed);
  expect(resumed.getMessages().filter(message=>message.content==='Applied as stopping')).toHaveLength(1);
  expect(resumed.getRecoveredInputs()).toEqual([]);
});

it('releases an interrupted queued input while its intent write is held', async () => {
  const write=gate(),journal:SessionEvent[]=[],provider=new ScriptedProvider([{text:'Working',hold:true}]);
  const f=fixture({provider,sessions:{create:async()=>{},append:async(_id,events)=>{
    if(events.some(event=>event.type==='prompt.queue.intent'))await write.wait();journal.push(...events);
  }}});
  const main=f.core.dispatchInput('First');await main.admitted;await expect.poll(()=>provider.requests.length).toBe(1);
  const queued=f.core.dispatchInput('Keep this draft');await write.entered;f.core.interrupt();
  try {expect(await Promise.race([queued.admitted,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('queued input still blocked')),500))])).toBe(false);}
  finally {write.release();provider.release();await queued.completion;await main.completion;}
  await expect.poll(()=>journal.some(event=>event.type==='prompt.queue.intent')).toBe(true);
  const resumed=AgentCore.resume({cwd:process.cwd(),provider:new ScriptedProvider([])},structuredClone(journal));cores.push(resumed);
  expect(resumed.getRecoveredInputs()).toMatchObject([{text:'Keep this draft'}]);
  expect(provider.requests).toHaveLength(1);
});
