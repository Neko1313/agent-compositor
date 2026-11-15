import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestRendererSetup} from '@opentui/core/testing';
import type {NativeInputMessage,NativeReceiptMessage,WireMessage} from '@agent-compositor/protocol';

// Only the CLI terminal constructor is substituted. The installed SDK's parser,
// scene, textarea, React tree, capture queue and production wire adapters run.
const terminal=vi.hoisted(()=>({current:undefined as TestRendererSetup|undefined}));
vi.mock('@opentui/core',async original=>({...await original<typeof import('@opentui/core')>(),
  createCliRenderer:async()=>terminal.current!.renderer,
}));
const cleanup:(()=>unknown|Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();terminal.current=undefined;});

async function fixture(heldModel=false,selectedControllers=false){
  const [{createTestRenderer},sdk,{runConversationPrototype},{buildApp},{connectWindowLayout},{createOpenTuiHost},
    {createOpenTuiWireHost},{createNativePresentationClient},{ScriptedProvider},{decodeLine,encodeMessage}]=await Promise.all([
    import('@opentui/core/testing'),import('@opentui/core'),import('../src/run.js'),
    import('../../app/src/build.js'),import('../../app/src/opentui-windows.js'),import('../../app/src/opentui-host.js'),
    import('../../app/src/opentui-wire.js'),import('../src/native-client.js'),import('@agent-compositor/core'),import('@agent-compositor/protocol'),
  ]);
  const cwd=await mkdtemp(join(tmpdir(),'opentui-native-admission-'));cleanup.push(()=>rm(cwd,{recursive:true,force:true}));
  const controllerFixture=selectedControllers?await(async()=>{
    const [{seedOpenTuiControllersFixture},{storagePaths}]=await Promise.all([
      import('../../../tools/visual/opentui-controllers-fixture.mjs'),import('../../config/src/storage.js'),
    ]);
    return seedOpenTuiControllersFixture(cwd,storagePaths(cwd,{HOME:cwd}));
  })():undefined;
  const provider=new ScriptedProvider([{text:'First answer',hold:heldModel},{text:'Second answer'}]);
  const app=await buildApp({cwd,env:{HOME:cwd},provider,agentHub:false,fixedConfig:{enabledPlugins:controllerFixture?[controllerFixture.provider,controllerFixture.requester]:[],
    ...(controllerFixture?{ui:{controllers:controllerFixture.selected}}:{}),
    agent:{tools:[],builtinTools:[],controlTools:[],skills:false,projectContext:false,fileReferences:false,verifyCompletion:false},compaction:{enabled:false}}});
  cleanup.push(()=>app.close());
  const layout=await connectWindowLayout(app,{panes:[{id:'session',label:'Main'}],initial:['session']});cleanup.push(()=>layout.disconnect());
  const host=createOpenTuiHost(app,layout);cleanup.push(()=>host.close());await host.start();
  const inputs:NativeInputMessage[]=[],held:NativeReceiptMessage[]=[],admissionTrace:unknown[]=[];
  const rawFrames=()=>host.surfaces.snapshot().flatMap(source=>{const frame=source.snapshot().controller;return frame?[{
    pane:source.id,id:frame.id,revision:frame.revision,inputRevision:frame.inputRevision,
    name:frame.view.lines.find(line=>line.text.startsWith('Name: '))?.text,
  }]:[];});
  let hold:(input:NativeInputMessage)=>boolean=()=>false;
  let client:ReturnType<typeof createNativePresentationClient>;
  const copy=(message:WireMessage)=>decodeLine(encodeMessage(message));
  const broker=createOpenTuiWireHost({host,layout,onCtrlC(){
    if(host.core.getState()==='running'){host.core.interrupt();return 'handled';}return 'exit';
  }},message=>{
    const wire=copy(message);
    if(selectedControllers&&(wire.type==='native-receipt'||wire.type==='native-state'))admissionTrace.push({stage:'host-send',
      message:wire.type==='native-receipt'?wire:{type:wire.type,revision:wire.revision,surfaces:wire.state.surfaces.map(source=>({id:source.id,port:source.port,controller:source.snapshot.controller}))},raw:rawFrames()});
    if(wire.type==='native-receipt'&&hold(inputs.find(input=>input.id===wire.id)!)){held.push(wire);return;}
    queueMicrotask(()=>{if(selectedControllers)admissionTrace.push({stage:'client-receive',type:wire.type,...(wire.type==='native-receipt'?{receipt:wire}:{}),raw:rawFrames()});client.receive(wire);});
  });cleanup.push(()=>broker.close());
  client=createNativePresentationClient(message=>{
    const wire=copy(message);if(wire.type==='native-input')inputs.push(wire);
    queueMicrotask(()=>{if(selectedControllers&&wire.type==='native-input')admissionTrace.push({stage:'host-receive',input:wire,raw:rawFrames()});broker.receive(wire);});
  });cleanup.push(()=>client.close());client.hello();broker.hello();await client.ready;
  const test=terminal.current=await createTestRenderer({width:100,height:36,exitOnCtrlC:false});cleanup.push(()=>test.dispose());
  const stop=new AbortController();let exited=false;
  const running=runConversationPrototype([...client.sessions()],{animations:false,signal:stop.signal,windowLayout:client.windowLayout,
    navigation:client.navigation,surfaces:client.surfaces,conversationWindows:client.conversationWindows,
    appearance:client.appearance,publicRender:client.publicRender,inputAdmission:client,onCtrlC:client.onCtrlC})
    .finally(()=>{exited=true;});
  cleanup.push(async()=>{stop.abort();await running;});
  const descendants=(node:typeof test.renderer.root):typeof node[]=>[node,...node.getChildren().flatMap(descendants)];
  const editor=()=>descendants(test.renderer.root).find(node=>node instanceof sdk.TextareaRenderable) as InstanceType<typeof sdk.TextareaRenderable>;
  const until=async(check:()=>boolean)=>vi.waitFor(async()=>{await test.flush({maxPasses:30});expect(check()).toBe(true);},{timeout:5000,interval:5});
  await until(()=>Boolean(editor()));
  if(selectedControllers&&process.env.OPENTUI_FORM_PROBE_OUTPUT)cleanup.push(async()=>{
    const directory=process.env.OPENTUI_FORM_PROBE_OUTPUT!;await mkdir(directory,{recursive:true});
    await writeFile(join(directory,'setup-final.json'),JSON.stringify({surfaces:host.surfaces.snapshot().map(source=>({id:source.id,state:source.snapshot()})),notice:host.session.snapshot().notice,
      raw:rawFrames(),admission:admissionTrace,inputs,originalControllerTrace:await readFile(controllerFixture!.trace,'utf8'),frame:test.captureCharFrame()},null,2)+'\n');
  });
  return{app,host,provider,layout,client,test,inputs,held,editor,until,running,controllerFixture,admissionTrace,rawFrames,exited:()=>exited,
    holdWhen(predicate:typeof hold){hold=predicate;},
    release(){hold=()=>false;for(const receipt of held.splice(0))client.receive(receipt);},
    // One actual SDK parser packet, rather than separate synthetic key callbacks.
    packet(text:string){test.renderer.stdin.emit('data',Buffer.from(text));},
  };
}

// Native Node FFI is supported from Node 26; Node 22 still runs the pure runner
// lifecycle and adapter tests without importing the SDK runtime.
describe.skipIf(Number(process.versions.node.split('.')[0])<26)('native production wire admission and resident input',()=>{
  it('buffers Enter and later typing until a held plugin-field edit is admitted',async()=>{
    const f=await fixture();let value='';const events:string[]=[];
    f.host.core.host.registerPlugin({name:'input-order',version:'1.0.0',trust:'trusted'}, {
      'ui.change':event=>{value=event.value;events.push('change:'+value);},
      'ui.press':event=>{if(event.key==='send')events.push('send:'+value);},
    });
    await f.host.core.host.emit('service.ui.view',{plugin:'input-order',id:'main',title:'Input order',view:{
      input:{id:'reply',label:'Reply',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]},options:{site:'split'}});
    let stage='surface';try{
    const id='plugin-input-order-main';await f.until(()=>f.host.surfaces.snapshot().some(source=>source.id===id));
    f.layout.act({type:'focus',id});if(!f.layout.snapshot().fullscreen)f.layout.act({type:'zoom'});
    stage='visible';await f.until(()=>f.test.captureCharFrame().includes('Reply:'));
    f.holdWhen(input=>input?.operation.kind==='surface-change');f.packet('\t\x1b[200~FIRST\x1b[201~');
    stage='first edit';await f.until(()=>f.held.length>0&&f.test.captureCharFrame().includes('FIRST'));
    stage='revision';await f.until(()=>f.client.surfaces.snapshot().find(source=>source.id===id)?.snapshot().revision===f.host.surfaces.snapshot().find(source=>source.id===id)?.snapshot().revision);
    f.packet('\r');await f.test.flush({maxPasses:30});f.packet('\x1b[200~_LATER\x1b[201~');
    expect(f.test.captureCharFrame()).toContain('FIRST');expect(events).not.toContain('send:FIRST');
    f.release();stage='settled';await f.until(()=>events.includes('send:FIRST')&&events.includes('change:FIRST_LATER')&&!f.client.pending());
    expect(events.indexOf('send:FIRST')).toBeLessThan(events.indexOf('change:FIRST_LATER'));
    expect(f.test.captureCharFrame()).toContain('FIRST_LATER');
    }catch(error){throw Error(`Failed at ${stage}: ${f.test.captureCharFrame()}\n${JSON.stringify(f.inputs)}`,{cause:error});}
  },12000);
  it('preserves selected-form paste after mouse press/release in one real parser packet',async()=>{
    const f=await fixture(false,true);
    void f.host.submit('/controller-probe form');
    await f.until(()=>f.host.surfaces.snapshot().some(source=>source.snapshot().controller?.kind==='form'));
    const form=f.host.surfaces.snapshot().find(source=>source.snapshot().controller?.kind==='form')!;
    // Establish the unit seam's requested private window through the canonical
    // layout source; the regression itself uses only the real parser packet.
    f.layout.act({type:'focus',id:form.id});if(!f.layout.snapshot().fullscreen)f.layout.act({type:'zoom'});
    await f.until(()=>f.test.captureCharFrame().includes('CUSTOM PRIVATE FORM')&&f.test.captureCharFrame().includes('Name: FORMvalue|'));
    const trace=async()=>(await readFile(f.controllerFixture!.trace,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const lease=(await trace()).findLast(row=>row.event==='created'&&row.kind==='form').id;
    const lines=f.test.captureCharFrame().split('\n'),row=lines.findIndex(line=>line.includes('Name: ')),col=lines[row].indexOf('Name: ')+10;
    const packet=`\x1b[<35;${col+1};${row+1}M\x1b[<0;${col+1};${row+1}M\x1b[<0;${col+1};${row+1}m\x1b[200~_P\x1b[201~`;
    try{
      f.packet(packet);
      const pasteRejected=()=>{
        const input=f.inputs.findLast(value=>value.operation.kind==='controller-input'&&value.operation.input.kind==='text'&&value.operation.input.paste===true);
        return input&&f.admissionTrace.some(value=>{const row=value as{stage:string;message?:NativeReceiptMessage};return row.stage==='host-send'&&row.message?.id===input.id&&row.message.status==='rejected';});
      };
      // A concrete rejection is conclusive evidence; do not wait for a frame
      // that this same paste can no longer produce.
      await f.until(()=>Boolean(pasteRejected())||f.test.captureCharFrame().includes('Name: FORM_P|value'));
      expect(f.test.captureCharFrame()).toContain('Name: FORM_P|value');
      const calls=(await trace()).filter(entry=>entry.id===lease&&entry.event==='input');
      expect(calls.filter(entry=>entry.input==='text'&&entry.paste&&entry.length===2)).toHaveLength(1);
      expect(calls).toContainEqual(expect.objectContaining({input:'mouse',action:'press',row:3,col:10}));
      expect(f.provider.requests).toEqual([]);
    }finally{
      if(process.env.OPENTUI_FORM_PROBE_OUTPUT){
        const directory=process.env.OPENTUI_FORM_PROBE_OUTPUT;await mkdir(directory,{recursive:true});
        await writeFile(join(directory,'diagnostics.json'),JSON.stringify({packet,lease,trace:await trace(),inputs:f.inputs,admission:f.admissionTrace,raw:f.rawFrames()},null,2)+'\n');
        await writeFile(join(directory,'frame.txt'),f.test.captureCharFrame());
      }
    }
  });

  it('preserves immediate Unicode paste after accepted Enter without awaiting a held Main, and awaits Ctrl+C decisions',async()=>{
    const f=await fixture(true);f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('TASK');await f.until(()=>f.editor().plainText==='TASK');
    f.packet('\r\x1b[200~NEXT_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    const widget=f.editor();expect(widget.plainText).toBe('TASK');expect(f.held[0].status).toBe('accepted');
    // Admission precedes asynchronous model startup; check the held model independently.
    await f.until(()=>f.provider.requests.length===1&&f.host.core.getState()==='running');
    f.release();await f.until(()=>widget.plainText==='NEXT_😀窗');
    expect(f.editor()).toBe(widget);expect(f.provider.requests).toHaveLength(1);expect(f.host.core.getState()).toBe('running');
    f.holdWhen(input=>input?.operation.kind==='ctrl-c');f.test.mockInput.pressCtrlC();await f.until(()=>f.held.length===1);
    expect(f.held[0]).toMatchObject({status:'accepted',ctrlC:'handled'});expect(f.exited()).toBe(false);
    f.release();await f.until(()=>f.host.core.getState()!=='running'&&!f.client.pending());
    expect(f.exited()).toBe(false);expect(widget.plainText).toBe('NEXT_😀窗');
    f.holdWhen(input=>input?.operation.kind==='ctrl-c');f.test.mockInput.pressCtrlC();await f.until(()=>f.held.length===1);
    expect(f.held[0]).toMatchObject({status:'accepted',ctrlC:'exit'});expect(f.exited()).toBe(false);
    f.release();await f.running;expect(f.exited()).toBe(true);
  });

  it('routes paste following /windows in the same parser packet to the native Finder field',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('/windows');await f.until(()=>f.editor().plainText==='/windows');
    f.packet('\r\x1b[200~Help_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    expect(f.client.navigation.snapshot()).toMatchObject({mode:'finder',query:''});expect(f.editor().plainText).toBe('/windows');
    f.release();await f.until(()=>f.client.navigation.snapshot().query==='Help_😀窗');
    expect(f.editor().plainText).toBe('');expect(f.provider.requests).toEqual([]);
    expect(f.test.captureCharFrame()).toContain('Help_😀窗');
  });

  it('does not send the same native draft twice while admission is pending',async()=>{
    const f=await fixture(true);f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('ONE_TASK');await f.until(()=>f.editor().plainText==='ONE_TASK');
    f.packet('\r\r');await f.until(()=>f.held.length===1);f.release();
    await f.until(()=>f.provider.requests.length===1&&!f.client.pending());
    expect(f.inputs.filter(value=>value.operation.kind==='submit')).toHaveLength(1);
    expect(f.provider.requests).toHaveLength(1);
  });

  it('retains the native draft when Core cannot journal the new input',async()=>{
    const f=await fixture();
    f.host.core.runtime.setResolver('service.session.append',async({sessionId,cwd,event,data}:any)=>{
      if(event==='prompt.input.intent')return {deny:'fixture disk unavailable'};
      await f.app.store.create(cwd,{id:sessionId});await f.app.store.append(sessionId,[{type:event,...data}],cwd);return {value:true};
    });
    await f.test.mockInput.pasteBracketedText('KEEP_NATIVE_DRAFT');await f.until(()=>f.editor().plainText==='KEEP_NATIVE_DRAFT');
    f.packet('\r');await f.until(()=>f.inputs.some(value=>value.operation.kind==='submit')&&!f.client.pending());
    expect(f.editor().plainText).toBe('KEEP_NATIVE_DRAFT');expect(f.provider.requests).toHaveLength(0);
  });

  it('retains rejected draft and subsequent typing through a genuine failed replacement startup',async()=>{
    const f=await fixture();await f.host.submit('Seed');const resume=f.app.resume;
    f.app.resume=async(...args)=>{const next=await resume(...args);next.start=async()=>{throw Error('Controlled startup failure');};return next;};
    await f.host.core.host.emit('service.session.control',{action:'resume',id:f.host.core.sessionId});
    await f.until(()=>f.client.sessions()[0].snapshot().notice?.includes('Retry /reload')===true);
    f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('REJECTED');await f.until(()=>f.editor().plainText==='REJECTED');
    f.packet('\r\x1b[200~_NEXT_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    expect(f.held[0].status).toBe('rejected');expect(f.editor().plainText).toBe('REJECTED');
    f.release();await f.until(()=>f.editor().plainText==='REJECTED_NEXT_😀窗');
    expect(f.provider.requests).toHaveLength(1);expect(JSON.stringify(f.provider.requests)).not.toContain('REJECTED');
  });

  it('revokes queued old-generation input before a replacement Core receives new typing',async()=>{
    const f=await fixture();await f.host.submit('Saved context');
    const oldGeneration=f.client.generation();f.holdWhen(input=>input?.operation.kind==='submit');
    await f.test.mockInput.pasteBracketedText('/windows');await f.until(()=>f.editor().plainText==='/windows');
    f.packet('\r\x1b[200~OLD_😀窗\x1b[201~');await f.until(()=>f.held.length===1);
    await f.host.core.host.emit('service.session.control',{action:'resume',id:f.host.core.sessionId});
    await f.until(()=>f.client.generation()!==oldGeneration);f.release();await f.until(()=>!f.client.pending());
    expect(f.editor().plainText).not.toContain('OLD_😀窗');expect(f.client.navigation.snapshot().query).not.toContain('OLD_😀窗');
    // Resume preserves the user's current Finder mode. New input belongs to
    // that current native field, while the older packet must never reach it.
    expect(f.client.navigation.snapshot().mode).toBe('finder');
    await f.test.mockInput.pasteBracketedText('NEW_😀窗');await f.until(()=>f.client.navigation.snapshot().query==='NEW_😀窗');
    expect(f.editor().plainText).not.toContain('OLD_😀窗');expect(f.provider.requests).toHaveLength(1);
  });
});
