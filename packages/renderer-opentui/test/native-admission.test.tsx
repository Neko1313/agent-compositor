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
  const inputs:NativeInputMessage[]=[],receipts:NativeReceiptMessage[]=[],held:NativeReceiptMessage[]=[],heldInputs:NativeInputMessage[]=[],admissionTrace:unknown[]=[];
  const rawFrames=()=>host.surfaces.snapshot().flatMap(source=>{const frame=source.snapshot().controller;return frame?[{
    pane:source.id,id:frame.id,revision:frame.revision,inputRevision:frame.inputRevision,
    name:frame.view.lines.find(line=>line.text.startsWith('Name: '))?.text,
  }]:[];});
  let hold:(input:NativeInputMessage)=>boolean=()=>false;
  let holdInput:(input:NativeInputMessage)=>boolean=()=>false;
  let client:ReturnType<typeof createNativePresentationClient>;
  const copy=(message:WireMessage)=>decodeLine(encodeMessage(message));
  const broker=createOpenTuiWireHost({host,layout,onCtrlC(){
    if(host.core.getState()==='running'){host.core.interrupt();return 'handled';}return 'exit';
  }},message=>{
    const wire=copy(message);
    if(wire.type==='native-receipt')receipts.push(wire);
    if(selectedControllers&&(wire.type==='native-receipt'||wire.type==='native-state'))admissionTrace.push({stage:'host-send',
      message:wire.type==='native-receipt'?wire:{type:wire.type,revision:wire.revision,surfaces:wire.state.surfaces.map(source=>({id:source.id,port:source.port,controller:source.snapshot.controller}))},raw:rawFrames()});
    if(wire.type==='native-receipt'&&hold(inputs.find(input=>input.id===wire.id)!)){held.push(wire);return;}
    queueMicrotask(()=>{if(selectedControllers)admissionTrace.push({stage:'client-receive',type:wire.type,...(wire.type==='native-receipt'?{receipt:wire}:{}),raw:rawFrames()});client.receive(wire);});
  });cleanup.push(()=>broker.close());
  client=createNativePresentationClient(message=>{
    const wire=copy(message);if(wire.type==='native-input')inputs.push(wire);
    if(wire.type==='native-input'&&holdInput(wire)){heldInputs.push(wire);return;}
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
  return{app,host,provider,layout,client,test,inputs,receipts,held,heldInputs,editor,until,running,controllerFixture,admissionTrace,rawFrames,exited:()=>exited,
    holdWhen(predicate:typeof hold){hold=predicate;},
    release(){hold=()=>false;for(const receipt of held.splice(0))client.receive(receipt);},
    holdInputWhen(predicate:typeof holdInput){holdInput=predicate;},
    releaseInputs(){holdInput=()=>false;for(const input of heldInputs.splice(0))broker.receive(input);},
    // One actual SDK parser packet, rather than separate synthetic key callbacks.
    packet(text:string){test.renderer.stdin.emit('data',Buffer.from(text));},
  };
}

// Native Node FFI is supported from Node 26; Node 22 still runs the pure runner
// lifecycle and adapter tests without importing the SDK runtime.
describe.skipIf(Number(process.versions.node.split('.')[0])<26)('native production wire admission and resident input',()=>{
  it('retains the final draft character across a stale field revision and immediate focus switch',async()=>{
    const f=await fixture(true);let release!:()=>void,entered=false,value='';const gate=new Promise<void>(resolve=>{release=resolve;});
    const main=f.host.submit('MAIN_HOLD').catch(()=>{});await f.until(()=>f.host.core.getState()==='running');
    f.host.core.host.registerPlugin({name:'draft-revision',version:'1.0.0',trust:'trusted'}, {
      'ui.change':async(event,$)=>{if(event.value==='DRAF'){entered=true;await gate;}value=event.value;
        await $.ui.view('main','Draft revision',{input:{id:'reply',label:'Reply',value},lines:[]});},
    });
    await f.host.core.host.emit('service.ui.view',{plugin:'draft-revision',id:'main',title:'Draft revision',view:{input:{id:'reply',label:'Reply',value:''},lines:[]},options:{site:'split'}});
    const id='plugin-draft-revision-main';await f.until(()=>f.host.surfaces.snapshot().some(source=>source.id===id));
    f.layout.act({type:'focus',id});if(!f.layout.snapshot().fullscreen)f.layout.act({type:'zoom'});
    let stage='initial';try{
      await f.until(()=>f.test.captureCharFrame().includes('Reply:'));f.packet('\t\x1b[200~DRAF\x1b[201~');
      stage='prefix';await f.until(()=>entered&&f.test.captureCharFrame().includes('DRAF'));
      f.holdInputWhen(input=>input.operation.kind==='surface-change'&&input.operation.value==='DRAFT');f.packet('T');
      stage='held final';await f.until(()=>f.heldInputs.length===1);const stale=f.heldInputs[0];f.packet('\x1b0');
      release();stage='published prefix';await f.until(()=>f.client.surfaces.snapshot().find(source=>source.id===id)?.snapshot().view?.input?.value==='DRAF');
      expect(f.layout.snapshot().focused).toBe(id);f.releaseInputs();
      stage='recovered final';await f.until(()=>value==='DRAFT'&&f.layout.snapshot().focused==='session'&&!f.client.pending());
      const edits=f.inputs.filter(input=>input.operation.kind==='surface-change'&&input.operation.value==='DRAFT');
      expect(edits.length).toBeGreaterThanOrEqual(2);expect(edits[0].id).toBe(stale.id);
      expect(edits[1].operation).toMatchObject({kind:'surface-change',value:'DRAFT'});
      expect(edits[1].revision).toBeGreaterThan(edits[0].revision!);
      expect(f.receipts.find(receipt=>receipt.id===edits[0].id)?.status).toBe('rejected');
      expect(f.receipts.find(receipt=>receipt.id===edits[1].id)?.status).toBe('accepted');
      expect(f.host.core.getState()).toBe('running');
    }catch(error){throw Error(`Failed at ${stage}: value=${value}; inputs=${JSON.stringify(f.inputs)}\n${f.test.captureCharFrame()}`,{cause:error});}
    finally{release();f.releaseInputs();f.host.core.interrupt();await main;}
  },12000);
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
  it.each(['pane','tab'] as const)('keeps queued field input out of Main after a mouse %s focus change',async target=>{
    const f=await fixture();let value='';
    f.host.core.host.registerPlugin({name:'mouse-order',version:'1.0.0',trust:'trusted'}, {
      'ui.change':event=>{value=event.value;},
    });
    await f.host.core.host.emit('service.ui.view',{plugin:'mouse-order',id:'main',title:'Mouse order',view:{
      input:{id:'reply',label:'Reply',value:''},lines:[]},options:{site:'split'}});
    let stage='surface';try{
    const id='plugin-mouse-order-main';await f.until(()=>f.host.surfaces.snapshot().some(source=>source.id===id));
    f.layout.act({type:'focus',id});stage='visible';await f.until(()=>f.test.captureCharFrame().includes('Reply:'));
    f.holdWhen(input=>input?.operation.kind==='surface-change');f.packet('\t\x1b[200~FIRST\x1b[201~');
    stage='edit';await f.until(()=>f.held.length>0&&f.test.captureCharFrame().includes('FIRST'));
    f.packet('\x1b[200~_LATER\x1b[201~');
    const main=f.layout.snapshot().frames.find(frame=>frame.surface==='session')!;
    if(target==='pane')await f.test.mockMouse.click(main.x+5,main.y+7);
    else await f.test.mockMouse.click(2,2);
    expect(f.layout.snapshot().focused).toBe(id);
    f.packet('\x1b[200~MAIN_NEXT\x1b[201~');
    f.release();stage='settled';await f.until(()=>f.layout.snapshot().focused==='session'&&value==='FIRST_LATER'&&f.test.captureCharFrame().includes('MAIN_NEXT')&&!f.client.pending());
    expect(f.test.captureCharFrame()).not.toContain('MAIN_NEXT_LATER');expect(value).toBe('FIRST_LATER');
    }catch(error){throw Error(`Failed at ${stage}: value=${value}, editor=${f.editor().plainText}\n${f.test.captureCharFrame()}\n${JSON.stringify(f.inputs)}`,{cause:error});}
  },12000);
  it('keeps a queued pane selection on its original window after layout changes',async()=>{
    const f=await fixture();
    f.host.core.host.registerPlugin({name:'mouse-stale',version:'1.0.0',trust:'trusted'},{'ui.change':()=>{}});
    await f.host.core.host.emit('service.ui.view',{plugin:'mouse-stale',id:'main',title:'Mouse stale',view:{input:{id:'reply',label:'Reply',value:''},lines:[]},options:{site:'split'}});
    const id='plugin-mouse-stale-main';await f.until(()=>f.host.surfaces.snapshot().some(source=>source.id===id));
    f.layout.act({type:'focus',id});await f.until(()=>f.test.captureCharFrame().includes('Reply:'));
    f.holdWhen(input=>input?.operation.kind==='surface-change');f.packet('\t\x1b[200~FIRST\x1b[201~');
    await f.until(()=>f.held.length>0&&f.test.captureCharFrame().includes('FIRST'));
    const main=f.layout.snapshot().frames.find(frame=>frame.surface==='session')!;
    await f.test.mockMouse.click(main.x+5,main.y+7);
    f.packet('\x1b[200~FOR_MAIN\x1b[201~');
    const before=f.layout.snapshot().frames.find(frame=>frame.surface==='session')!;f.layout.act({type:'swap'});
    await f.until(()=>f.layout.snapshot().frames.find(frame=>frame.surface==='session')!.x!==before.x);
    f.release();await f.until(()=>f.layout.snapshot().focused==='session'&&f.test.captureCharFrame().includes('FOR_MAIN')&&!f.client.pending());
    expect(f.inputs.filter(input=>input.operation.kind==='layout-action'&&input.operation.action.type==='pointer')).toHaveLength(0);
    expect(f.layout.snapshot().focused).toBe('session');
  },12000);
  it('reopens a hidden selected window before replaying later input',async()=>{
    const f=await fixture();let value='';
    f.host.core.host.registerPlugin({name:'mouse-hidden',version:'1.0.0',trust:'trusted'},{'ui.change':event=>{value=event.value;}});
    await f.host.core.host.emit('service.ui.view',{plugin:'mouse-hidden',id:'main',title:'Mouse hidden',view:{input:{id:'reply',label:'Reply',value:''},lines:[]},options:{site:'split'}});
    const id='plugin-mouse-hidden-main';await f.until(()=>f.host.surfaces.snapshot().some(source=>source.id===id));
    f.layout.act({type:'focus',id});await f.until(()=>f.test.captureCharFrame().includes('Reply:'));
    f.holdWhen(input=>input?.operation.kind==='surface-change');f.packet('\t\x1b[200~FIRST\x1b[201~');
    await f.until(()=>f.held.length>0&&f.test.captureCharFrame().includes('FIRST'));
    const main=f.layout.snapshot().frames.find(frame=>frame.surface==='session')!;
    await f.test.mockMouse.click(main.x+5,main.y+7);f.packet('\x1b[200~FOR_MAIN\x1b[201~');
    f.layout.act({type:'focus',id:'session'});f.layout.act({type:'close'});
    await f.until(()=>!f.layout.snapshot().frames.some(frame=>frame.surface==='session'));
    f.release();await f.until(()=>f.layout.snapshot().focused==='session'&&f.test.captureCharFrame().includes('FOR_MAIN')&&!f.client.pending());
    expect(value).toBe('FIRST');
  },12000);
  it.each(['removed','replaced','discarded','discard_inflight','narrow','keyboard','noninput','typing','recovery_replaced','field_replaced','private','main_private'] as const)('holds later text and cancels Enter when the selected plugin is %s',async mode=>{
    const f=await fixture(false,mode==='private');let value='',submitted=0;
    f.host.core.host.registerPlugin({name:'mouse-origin',version:'1.0.0',trust:'trusted'}, {
      'ui.change':async(event,$)=>{value=event.value;await $.ui.view('main','Origin',{
        input:{id:'reply',label:'Reply',value,submitAction:'send'},lines:[{text:'Send',action:'send'}]});},
      'ui.press':event=>{if(event.key==='send')submitted++;},
    });
    f.host.core.host.registerPlugin({name:'mouse-target',version:'1.0.0',trust:'trusted'},{});
    const view={input:{id:'reply',label:'Reply',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]};
    await f.host.core.host.emit('service.ui.view',{plugin:'mouse-origin',id:'main',title:'Origin',view,options:{site:'split'}});
    await f.host.core.host.emit('service.ui.view',{plugin:'mouse-target',id:'main',title:'Target',view,options:{site:'split'}});
    const origin='plugin-mouse-origin-main',target='plugin-mouse-target-main';
    await f.until(()=>f.layout.snapshot().frames.some(frame=>frame.surface===target));f.layout.act({type:'focus',id:origin});
    await f.until(()=>f.test.captureCharFrame().includes('Origin · focused'));
    f.holdWhen(input=>input?.operation.kind==='surface-change');f.packet('\t\x1b[200~FIRST\x1b[201~');
    await f.until(()=>f.held.length>0&&f.test.captureCharFrame().includes('FIRST'));
    const frame=f.layout.snapshot().frames.find(item=>item.surface===target)!;
    await f.test.mockMouse.click(frame.x+5,frame.y+7);f.packet('\x1b[200~FOR_TARGET\x1b[201~\r');
    f.host.core.host.unregisterPlugin('mouse-target');await f.until(()=>!f.host.surfaces.snapshot().some(source=>source.id===target));
    if(mode==='replaced'){
      f.host.core.host.registerPlugin({name:'mouse-target',version:'2.0.0',trust:'trusted'},{});
      await f.host.core.host.emit('service.ui.view',{plugin:'mouse-target',id:'main',title:'Replacement',view,options:{site:'split'}});
      await f.until(()=>f.host.surfaces.snapshot().some(source=>source.id===target));
    }
    f.release();await f.until(()=>f.test.captureCharFrame().includes('Click input or Alt+0'));
    expect(value).toBe('FIRST');expect(submitted).toBe(0);
    if(mode==='main_private'){
      f.host.core.host.registerPlugin({name:'private-recovery',version:'1.0.0',trust:'trusted'}, {
        'ui.press':async(event,$)=>{if(event.site==='private-recovery-trigger')await $.ui.form({title:'PRIVATE_RECOVERY_FORM',
          fields:[{id:'value',label:'Secret',type:'text',value:'ORIGINAL'}],actions:[{id:'cancel',label:'Cancel'}]});},
      });
      const pending=f.host.core.host.emit('ui.press',{site:'private-recovery-trigger',key:'open'});
      await f.until(()=>f.host.session.snapshot().interaction?.kind==='form');f.packet('\x1b0');
      await f.until(()=>f.layout.snapshot().focused==='session'&&f.test.captureCharFrame().includes('PRIVATE_RECOVERY_FORM'));
      expect(f.test.captureCharFrame()).toContain('Click input or Alt+0');
      expect(f.test.captureCharFrame()).not.toContain('FOR_TARGET');expect(value).toBe('FIRST');expect(submitted).toBe(0);
      f.host.session.cancelInteraction!(f.host.session.snapshot().interaction!.id);await pending;return;
    }
    if(mode==='private'){
      void f.host.submit('/controller-probe form');
      await f.until(()=>f.host.surfaces.snapshot().some(source=>source.snapshot().controller?.kind==='form'));
      const form=f.host.surfaces.snapshot().find(source=>source.snapshot().controller?.kind==='form')!;
      f.layout.act({type:'focus',id:form.id});if(!f.layout.snapshot().fullscreen)f.layout.act({type:'zoom'});
      await f.until(()=>f.test.captureCharFrame().includes('Name: FORMvalue|'));
      const rows=f.test.captureCharFrame().split('\n'),row=rows.findIndex(line=>line.includes('Name: FORMvalue|'));
      await f.test.mockMouse.click(rows[row].indexOf('Name: ')+9,row);await f.test.flush({maxPasses:30});
      expect(f.test.captureCharFrame()).toContain('Click input or Alt+0');
      const trace=(await readFile(f.controllerFixture!.trace,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
      expect(trace.filter((entry:{event:string;input:string})=>entry.event==='input'&&entry.input==='text')).toHaveLength(0);
      expect(value).toBe('FIRST');expect(submitted).toBe(0);return;
    }
    if(mode==='typing'){f.packet('NEW');await f.test.flush({maxPasses:30});}
    if(mode==='keyboard'){
      f.packet('\x1b0');await f.until(()=>f.layout.snapshot().focused==='session'&&f.test.captureCharFrame().includes('FOR_TARGET')&&!f.client.pending());
      expect(value).toBe('FIRST');expect(submitted).toBe(0);return;
    }
    if(mode==='noninput'){
      const rows=f.test.captureCharFrame().split('\n'),tabRow=rows.findIndex(line=>line.includes('Main')&&line.includes('Origin'));
      await f.test.mockMouse.click(rows[tabRow].indexOf('Main')+1,tabRow);
      await f.until(()=>f.layout.snapshot().focused==='session');
      expect(f.test.captureCharFrame()).toContain('Click input or Alt+0');expect(value).toBe('FIRST');
    }
    if(mode==='narrow'){
      f.test.resize(40,18);try{await f.until(()=>f.test.captureCharFrame().replace(/\s+/g,' ').includes('Esc discards')&&f.test.captureCharFrame().replace(/\s+/g,' ').includes('actions cancelled'));}
      catch(error){throw Error(f.test.captureCharFrame(),{cause:error});}
      f.test.resize(100,36);await f.until(()=>f.layout.snapshot().frames.some(item=>item.surface===origin));
    }
    if(mode==='discarded'){
      f.test.mockInput.pressEscape();await f.until(()=>!f.test.captureCharFrame().includes('Click input or Alt+0'));
      const current=f.layout.snapshot().frames.find(item=>item.surface===origin)!;await f.test.mockMouse.click(current.x+5,current.y+7);
      await f.until(()=>!f.client.pending());expect(value).toBe('FIRST');expect(submitted).toBe(0);return;
    }
    const lines=f.test.captureCharFrame().split('\n'),row=lines.findIndex(line=>line.includes('Reply: FIRST')),col=lines[row].indexOf('Reply: FIRST')+12;
    if(mode==='recovery_replaced'||mode==='field_replaced'||mode==='discard_inflight')f.holdWhen(input=>input?.operation.kind==='layout-action');
    await f.test.mockMouse.click(col,row);
    if(mode==='discard_inflight'){
      await f.until(()=>f.held.length>0);f.test.mockInput.pressEscape();
      await f.until(()=>!f.test.captureCharFrame().includes('Click input or Alt+0'));
      f.release();await f.until(()=>!f.client.pending());expect(value).toBe('FIRST');expect(submitted).toBe(0);return;
    }
    if(mode==='field_replaced'){
      await f.until(()=>f.held.length>0);
      await f.host.core.host.emit('service.ui.view',{plugin:'mouse-origin',id:'main',title:'Origin',view:{
        input:{id:'replacement',label:'Replacement',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]}});
      await f.until(()=>f.client.surfaces.snapshot().find(source=>source.id===origin)?.snapshot().view?.input?.id==='replacement');
      f.release();await f.until(()=>!f.client.pending());expect(f.test.captureCharFrame()).toContain('Click input or Alt+0');
      expect(value).toBe('FIRST');expect(submitted).toBe(0);return;
    }
    if(mode==='recovery_replaced'){
      await f.until(()=>f.held.length>0);const previous=f.client.surfaces.snapshot().find(source=>source.id===origin);
      f.host.core.host.unregisterPlugin('mouse-origin');await f.until(()=>!f.host.surfaces.snapshot().some(source=>source.id===origin));
      f.host.core.host.registerPlugin({name:'mouse-origin',version:'2.0.0',trust:'trusted'},{});
      await f.host.core.host.emit('service.ui.view',{plugin:'mouse-origin',id:'main',title:'Replacement origin',view,options:{site:'split'}});
      await f.until(()=>Boolean(f.client.surfaces.snapshot().find(source=>source.id===origin&&source!==previous)));
      f.release();await f.until(()=>!f.client.pending());expect(f.test.captureCharFrame()).toContain('Click input or Alt+0');
      expect(value).toBe('FIRST');expect(submitted).toBe(0);return;
    }
    await f.until(()=>value===(mode==='typing'?'FIRSTFOR_TARGETNEW':'FIRSTFOR_TARGET')&&!f.client.pending());expect(submitted).toBe(0);
  },12000);
  it('replays a queued drag through its own geometry updates and releases the gesture',async()=>{
    const f=await fixture();
    f.host.core.host.registerPlugin({name:'mouse-drag',version:'1.0.0',trust:'trusted'},{'ui.change':()=>{}});
    await f.host.core.host.emit('service.ui.view',{plugin:'mouse-drag',id:'main',title:'Mouse drag',view:{input:{id:'reply',label:'Reply',value:''},lines:[]},options:{site:'split'}});
    const id='plugin-mouse-drag-main';await f.until(()=>f.host.surfaces.snapshot().some(source=>source.id===id));
    f.layout.act({type:'focus',id});await f.until(()=>f.test.captureCharFrame().includes('Reply:'));
    f.holdWhen(input=>input?.operation.kind==='surface-change');f.packet('\t\x1b[200~FIRST\x1b[201~');
    await f.until(()=>f.held.length>0&&f.test.captureCharFrame().includes('FIRST'));
    const side=f.layout.snapshot().frames.find(frame=>frame.surface===id)!,main=f.layout.snapshot().frames.find(frame=>frame.surface==='session')!;
    await f.test.mockMouse.pressDown(side.x+5,side.y+3);await f.test.mockMouse.moveTo(main.x+5,main.y+8);
    await f.test.mockMouse.moveTo(main.x+6,main.y+9);await f.test.mockMouse.release(main.x+6,main.y+9);
    f.release();await f.until(()=>f.inputs.some(input=>input.operation.kind==='layout-action'&&input.operation.action.type==='pointer'&&input.operation.action.phase==='up')&&!f.client.pending());
    expect(f.layout.snapshot().gesture).toBeUndefined();
    const actions=f.inputs.flatMap(input=>input.operation.kind==='layout-action'&&input.operation.action.type==='pointer'?[input.operation.action.phase]:[]);
    expect(actions).toEqual(expect.arrayContaining(['down','move','up']));
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
  it.each(['local','saved'] as const)('requires an explicit %s choice when a carried input differs from the resumed session draft',async choice=>{
    const f=await fixture(),{MainDraftStore}=await import('../../app/src/main-drafts.js');
    const cwd=f.app.storage.paths.project,old=f.host.core,fork=await f.app.store.fork(old.sessionId,{},cwd);
    await MainDraftStore.open(f.app.storage.paths.state).save(fork.id,{text:'SAVED_TARGET'});
    await f.test.mockInput.pasteBracketedText('LOCAL_UNSENT');await f.until(()=>f.editor().plainText==='LOCAL_UNSENT'&&!f.client.pending());
    await old.host.emit('service.session.control',{action:'resume',id:fork.id});
    await f.until(()=>f.test.captureCharFrame().includes('Preview: local'));
    expect(f.editor().plainText).toBe('LOCAL_UNSENT');expect(f.provider.requests).toHaveLength(0);
    f.packet('\x05');await f.until(()=>f.editor().plainText==='SAVED_TARGET');
    f.packet(choice==='local'?'\x0c':'\x12');const expected=choice==='local'?'LOCAL_UNSENT':'SAVED_TARGET';
    await f.until(()=>f.editor().plainText===expected&&!f.test.captureCharFrame().includes('Preview: local'));
    await f.until(()=>f.host.session.snapshot().draft?.text===expected);expect(f.provider.requests).toHaveLength(0);
  },12000);

  it('keeps window navigation usable while a draft save receipt is delayed',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='draft-change');
    await f.test.mockInput.pasteBracketedText('BACKGROUND_DRAFT');await f.until(()=>f.held.length>0&&f.editor().plainText==='BACKGROUND_DRAFT');
    expect(f.client.pending()).toBe(false);f.packet('\x1bw');
    await f.until(()=>f.client.navigation.snapshot().mode==='arrange');
    expect(f.provider.requests).toHaveLength(0);expect(f.held.length).toBeGreaterThan(0);f.release();
  },12000);

  it('saves later typing after returning from navigation during a delayed draft receipt',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='draft-change');
    await f.test.mockInput.pasteBracketedText('PREFIX');await f.until(()=>f.held.length>0&&f.editor().plainText==='PREFIX');
    await f.test.mockInput.pasteBracketedText('_LATER');await f.until(()=>f.editor().plainText==='PREFIX_LATER');
    f.packet('\x1bw');await f.until(()=>f.client.navigation.snapshot().mode==='arrange');f.release();
    await f.until(()=>f.test.captureCharFrame().includes('Draft not saved'));
    f.packet('\x1b');await f.until(()=>f.client.navigation.snapshot().mode==='normal');
    await f.until(()=>f.host.session.snapshot().draft?.text==='PREFIX_LATER');expect(f.provider.requests).toHaveLength(0);
  },12000);

  it('waits for queued draft edits before a normal Ctrl+C exit',async()=>{
    const f=await fixture(),{MainDraftStore}=await import('../../app/src/main-drafts.js');
    f.holdWhen(input=>input?.operation.kind==='draft-change');
    await f.test.mockInput.pasteBracketedText('BEFORE');await f.until(()=>f.held.length>0&&f.editor().plainText==='BEFORE');
    await f.test.mockInput.pasteBracketedText('_EXIT');await f.until(()=>f.editor().plainText==='BEFORE_EXIT');
    f.packet('\x03');await f.test.flush({maxPasses:30});expect(f.exited()).toBe(false);
    f.release();await f.until(()=>f.exited());
    expect(await MainDraftStore.open(f.app.storage.paths.state).load(f.host.core.sessionId,[])).toEqual({kind:'draft',text:'BEFORE_EXIT'});
    expect(f.provider.requests).toHaveLength(0);
  },12000);

  it('lets the user cancel or explicitly force an exit while draft saving waits',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='draft-change');
    await f.test.mockInput.pasteBracketedText('KEEP_WAITING');await f.until(()=>f.held.length>0);
    f.packet('\x03');await f.until(()=>f.test.captureCharFrame().includes('Ctrl+C again exits without waiting'));
    f.packet('\x1b[D');await f.until(()=>!f.test.captureCharFrame().includes('Ctrl+C again exits without waiting'));
    f.release();await f.until(()=>!f.client.pending());expect(f.exited()).toBe(false);
    f.holdWhen(input=>input?.operation.kind==='draft-change');await f.test.mockInput.pasteBracketedText('X');await f.until(()=>f.held.length>0);
    f.packet('\x03');await f.until(()=>f.test.captureCharFrame().includes('Ctrl+C again exits without waiting'));
    f.packet('\x03');await f.until(()=>f.exited());f.release();expect(f.provider.requests).toHaveLength(0);
  },12000);

  it('cancels a pending graceful exit when the user clicks elsewhere',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='draft-change');
    await f.test.mockInput.pasteBracketedText('KEEP_ON_CLICK');await f.until(()=>f.held.length>0);
    f.packet('\x03');await f.until(()=>f.test.captureCharFrame().includes('Ctrl+C again exits without waiting'));
    await f.test.mockMouse.click(5,5);await f.until(()=>!f.test.captureCharFrame().includes('Ctrl+C again exits without waiting'));
    f.release();await f.until(()=>!f.client.pending());expect(f.exited()).toBe(false);
  },12000);

  it('cancels a pending graceful exit when the user pastes more input',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='draft-change');
    await f.test.mockInput.pasteBracketedText('KEEP_ON_PASTE');await f.until(()=>f.held.length>0);
    f.packet('\x03');await f.until(()=>f.test.captureCharFrame().includes('Ctrl+C again exits without waiting'));
    await f.test.mockInput.pasteBracketedText('_MORE');await f.until(()=>!f.test.captureCharFrame().includes('Ctrl+C again exits without waiting'));
    f.release();await f.until(()=>f.editor().plainText==='KEEP_ON_PASTE_MORE');expect(f.exited()).toBe(false);
  },12000);

  it('does not exit if new input arrives before the Ctrl+C decision',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='ctrl-c');
    f.packet('\x03');await f.until(()=>f.held.length>0);
    await f.test.mockInput.pasteBracketedText('AFTER_EXIT_REQUEST');f.release();
    await f.until(()=>f.editor().plainText==='AFTER_EXIT_REQUEST'&&!f.client.pending());
    expect(f.exited()).toBe(false);expect(f.provider.requests).toHaveLength(0);
  },12000);

  it('keeps the application open after an unacknowledged draft save until the user retries',async()=>{
    const f=await fixture();f.holdWhen(input=>input?.operation.kind==='draft-change');
    await f.test.mockInput.pasteBracketedText('UNACKNOWLEDGED');await f.until(()=>f.held.length>0);
    const receipt=f.held.shift()!;f.holdWhen(()=>false);f.client.receive({...receipt,status:'rejected'});
    await f.until(()=>f.test.captureCharFrame().includes('Draft not saved'));
    f.packet('\x03');await f.until(()=>f.test.captureCharFrame().includes('Draft not saved · Ctrl+C again exits without saving'));
    expect(f.exited()).toBe(false);f.packet('X');await f.until(()=>f.editor().plainText==='UNACKNOWLEDGEDX');
    await f.until(()=>f.host.session.snapshot().draft?.text==='UNACKNOWLEDGEDX');f.packet('\x03');await f.until(()=>f.exited());
  },12000);

});
