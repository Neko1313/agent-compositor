import {appendFileSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {decodeLine,encodeMessage,hello} from '../../packages/protocol/src/index.ts';

const cells=(text,style={})=>Array.from(text,ch=>({ch,...style}));
const sha=value=>createHash('sha256').update(value).digest('hex');
const theme={border:'#64748b',accent:'#7dd3fc',text:'#e2e8f0',muted:'#94a3b8',titleBackground:'#223344',warning:'#fbbf24',borderStyle:'double',controls:'focus'};
export function wireFixtureLayout(columns=100,rows=30){const left=Math.floor(columns*.62),height=rows-4;return{type:'layout',width:columns,height:rows,frames:[{surface:'main',x:0,y:0,width:left,height,controls:true,chrome:theme},{surface:'side',x:left,y:0,width:columns-left,height,controls:true,chrome:{...theme,borderStyle:'round'}},{surface:'status',x:0,y:height,width:columns,height:4}]};}
export function wireFixtureLog(columns=100,rows=30){return[
 {...hello('core',{surfaces:['terminal'],sites:[],elements:['Text','Box','Layout','Pointer','Raster'],encodings:['jsonl']}),version:'0.6.0'},
 {type:'declare',surfaces:[{id:'main',kind:'pane',title:'Legacy Main\u001b\u202e'},{id:'side',kind:'pane',title:'Legacy Side'},{id:'status',kind:'status-bar'}]},
 wireFixtureLayout(columns,rows),
 {type:'render',surface:'main',mode:'full',flush:false,focused:true,grid:[cells('WIRE_FULL_06'),cells('WIRE_RGB',{fg:'#7dd3fc',bg:'#223344',bold:true,italic:true,underline:true}),cells('WIRE_RASTER_FALLBACK'),cells('WIRE_SCROLL_SOURCE'),[...cells('WIRE_LITERAL:'),{ch:'\u001b',fg:'#7dd3fc'},{ch:'\u202e',bg:'#223344'}],cells('n unflush / f flush / F2 focus')],raster:{width:1,height:1,rgba:'/wAA/w==',column:0,row:2,columns:2,rows:1,alt:'WIRE_RASTER_FALLBACK'}},
 {type:'render',surface:'side',mode:'full',flush:true,grid:[cells('WIRE_SIDE_06'),cells('Paste Unicode here after F2')]},
 {type:'render',surface:'status',mode:'full',flush:true,grid:[cells('WIRE_READY_06'),cells('n unflush · f flush · F2 focus · p pointer'),cells('q EOF · s stop blocked source')]},
];}

if(process.argv.includes('--preflight')){
 const messages=wireFixtureLog().map(value=>decodeLine(encodeMessage(value)));console.log(JSON.stringify({ok:true,messages:messages.length,types:messages.map(value=>value.type)}));
}else if(resolve(process.argv[1]??'')===resolve(import.meta.filename))await run();

async function run(){
 const output=resolve(process.env.VISUAL_OUTPUT??'dist/visual-opentui-wire'),variant=process.env.VISUAL_WIRE_CASE??'normal';
 const modulePath=process.env.VISUAL_RENDERER_MODULE?resolve(process.env.VISUAL_RENDERER_MODULE):resolve(import.meta.dirname,'../../packages/renderer-opentui/src/run.tsx');
 const identity={mode:process.env.VISUAL_RENDERER_MODULE?'archive-module':'source-module',module:modulePath,sha256:sha(readFileSync(modulePath)),variant,protocol:'0.6.0',zeroModelCalls:true};
 writeFileSync(join(output,'wire-identity.json'),JSON.stringify(identity,null,2));
 for(const name of ['wire-in.jsonl','wire-out.jsonl','wire-trace.jsonl'])writeFileSync(join(output,name),'');
 const trace=(event,extra={})=>appendFileSync(join(output,'wire-trace.jsonl'),JSON.stringify({event,...extra})+'\n');
 const values=[];let pull,ended=false,handle;let sidePaste='',sideKey='',sideMouse='',sideCount=0;
 const push=value=>{const line=encodeMessage(value);appendFileSync(join(output,'wire-in.jsonl'),line);values.push(decodeLine(line));pull?.();};
 const source={ [Symbol.asyncIterator](){return{async next(){while(!values.length&&!ended)await new Promise(resolve=>{pull=resolve;});return values.length?{done:false,value:values.shift()}:{done:true};},return(){trace('iterator-return');return new Promise(()=>{});}};}};
 const end=()=>{ended=true;pull?.();};
 const side=()=>push({type:'render',surface:'side',mode:'full',flush:true,grid:[cells('WIRE_SIDE_06'),cells(sidePaste),cells(sideKey),cells(sideMouse),cells('INPUT_COUNT:'+sideCount)]});
 const send=message=>{
  const line=encodeMessage(message),value=decodeLine(line);appendFileSync(join(output,'wire-out.jsonl'),line);
  if(value.type!=='input')return;
  const data=value.data;trace('input',{surface:value.surface,data});
  if(data.kind==='text'&&!data.paste&&data.text==='q'){trace('eof-request');end();return;}
  if(data.kind==='text'&&!data.paste&&data.text==='s'){trace('stop-request');void handle.stop();return;}
  if(data.kind==='text'&&!data.paste&&data.text==='n'){
   push({type:'render',surface:'main',mode:'diff',flush:false,ops:[{op:'set',row:0,col:0,cells:cells('WIRE_PENDING_06')}]});
   push({type:'invalidate',surface:'main',regions:[{row:0,col:0,rows:1,cols:16}]});push({type:'pointer',shape:'text'});trace('unflushed');return;
  }
  if(data.kind==='text'&&!data.paste&&data.text==='f'){
   push({type:'render',surface:'main',mode:'diff',flush:true,ops:[{op:'scroll',rows:1},{op:'set',row:0,col:0,cells:cells('WIRE_FLUSHED_06')},{op:'set',row:2,col:0,cells:cells('SCROLLED_ROW_06')},{op:'cursor',row:0,col:0}]});trace('flushed');return;
  }
  if(data.kind==='key'&&data.key==='f2'){push({type:'focus',surface:'side'});trace('focus-side');return;}
  if(data.kind==='text'&&!data.paste&&data.text==='p'){push({type:'pointer',shape:'ew-resize'});trace('pointer');return;}
  if(value.surface==='side'){
   sideCount++;if(data.kind==='text')sidePaste='PASTE:'+JSON.stringify(data.text);else if(data.kind==='key')sideKey='KEY:'+data.key+':'+(data.modifiers??[]).join(',');else sideMouse='MOUSE:'+data.action+' '+data.col+','+data.row;
   side();
  }
 };
 try{
  const module=await import(pathToFileURL(modulePath).href);if(typeof module.runOpenTuiWireRenderer!=='function')throw Error('Public runOpenTuiWireRenderer export is missing');
  handle=await module.runOpenTuiWireRenderer({source,send,hostControlsExit:true,graphics:process.env.VISUAL_WIRE_GRAPHICS??'off',localHello:{...hello('renderer',{surfaces:['terminal'],sites:[],elements:['Text','Box','Layout','Pointer'],encodings:['jsonl']}),version:'0.6.0'},
   onResize(columns,rows){push(wireFixtureLayout(columns,rows));trace('resize',{columns,rows});}});
  if(variant==='bad-ack')push({type:'hello-ack',ok:false,reason:'WIRE_BAD_ACK_06'});else for(const message of wireFixtureLog(Number(process.env.VISUAL_COLS??100),Number(process.env.VISUAL_ROWS??30)))push(message);
  await handle.waitUntilExit;
  if(variant==='bad-ack')throw Error('Negative ACK unexpectedly completed successfully');
  trace('exit',{ok:true,raw:Boolean(process.stdin.isRaw)});process.stdout.write('WIRE_EXIT_OK '+variant+' raw='+Boolean(process.stdin.isRaw)+'\n');
 }catch(error){
  const expected=variant==='bad-ack'&&String(error).includes('WIRE_BAD_ACK_06');trace('exit',{ok:expected,raw:Boolean(process.stdin.isRaw),error:String(error)});
  process.stdout.write((expected?'WIRE_EXIT_EXPECTED_BAD_ACK':'WIRE_EXIT_UNEXPECTED')+' raw='+Boolean(process.stdin.isRaw)+' '+String(error)+'\n');if(!expected)process.exitCode=1;
 }finally{await handle?.stop();end();}
}
