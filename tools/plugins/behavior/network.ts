import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {OpenAICompatProvider} from '@agent-compositor/provider';
import {Fixture,Casebook} from './fixture.js';
export async function localServer(){
 let mode='success',hits=0,closed=0,started:()=>void=()=>{};
 const server=createServer((req,res)=>{hits++;started();res.on('close',()=>closed++);
  if(mode==='hang'){res.writeHead(200,{'content-type':req.url?.startsWith('/model')?'text/event-stream':'text/plain'});res.write(' ');return;}
  if(mode==='status'){res.writeHead(503);res.end('unavailable');return;}
  if(req.url?.startsWith('/model')){res.setHeader('content-type','text/event-stream');res.end(mode==='malformed'?'data: broken-json\n\n':`data: ${JSON.stringify({choices:[{delta:{content:'pong'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);return;}
  if(req.url?.startsWith('/search')){res.setHeader('content-type','application/json');res.end(mode==='malformed'?'broken-json':JSON.stringify({results:[{title:'Local docs',url:'https://example.test/docs',content:'Fixture search evidence'}]}));return;}
  res.setHeader('content-type','text/html');res.end('<title>Local source</title><h1>NETWORK_EVIDENCE</h1><a href="/next">Next</a>');
 });await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const url=`http://127.0.0.1:${(server.address() as any).port}`;
 return{url,setMode:(value:string)=>{mode=value;},get hits(){return hits;},get closed(){return closed;},nextRequest:()=>new Promise<void>(done=>{started=done;}),close:async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}};
}
export function network(f:Fixture,b:Casebook){
 if(f.name==='web'){
  const tool=(name:string)=>f.module.tools.find((t:any)=>t.name===name);
  const context=(url:string,signal=new AbortController().signal)=>({cwd:f.cwd,signal,fetch,settings:async()=>({provider:'searxng',searchUrl:url+'/search'}),request:async()=>undefined});
  b.add(['tool.success','network.success'],async()=>{const s=await localServer();try{const page=await tool('web_fetch').execute(context(s.url),{url:s.url});assert.equal(page.ok,true);assert.match(page.data.text,/NETWORK_EVIDENCE/);assert.equal(page.data.title,'Local source');assert.equal(page.data.links[0].url,s.url+'/next');const search=await tool('web_search').execute(context(s.url),{query:'docs'});assert.equal(search.ok,true);assert.equal(search.data.results[0].snippet,'Fixture search evidence');assert.equal(s.hits,2);}finally{await s.close();}});
  b.add('tool.invalid',async()=>{const s=await localServer();try{for(const args of [{},{url:'file:///etc/passwd'},{url:'https://user:secret@example.test/'}])assert.equal((await tool('web_fetch').execute(context(s.url),args)).ok,false);for(const args of [{},{query:''},{query:'docs',count:100}])assert.equal((await tool('web_search').execute(context(s.url),args)).ok,false);assert.equal(s.hits,0);}finally{await s.close();}});
  b.add('tool.denied',async()=>{const s=await localServer();try{const app=await f.app({permissions:{rules:[{tool:'web_fetch',decision:'deny'},{tool:'web_search',decision:'deny'}]}});for(const[name,args]of [['web_fetch',{url:s.url}],['web_search',{query:'docs'}]] as const)assert.equal((await app.createCore(async()=>true).invokeTool(name,args)).ok,false);assert.equal(s.hits,0);}finally{await s.close();}});
  b.add(['tool.failure','network.status'],async()=>{const s=await localServer();try{s.setMode('status');const r=await tool('web_fetch').execute(context(s.url),{url:s.url});assert.equal(r.ok,false);assert.match(r.error,/503/);assert.equal(r.data,undefined);}finally{await s.close();}});
  b.add('network.malformed',async()=>{const s=await localServer();try{s.setMode('malformed');const r=await tool('web_search').execute(context(s.url),{query:'docs'});assert.equal(r.ok,false);assert.equal(r.data,undefined);}finally{await s.close();}});
  b.add('network.unavailable',async()=>{const s=await localServer();await s.close();const r=await tool('web_fetch').execute(context(s.url),{url:s.url});assert.equal(r.ok,false);assert.equal(r.data,undefined);});
  b.add('network.timeout',async()=>{const s=await localServer();try{s.setMode('hang');const start=Date.now();const r=await tool('web_fetch').execute(context(s.url,AbortSignal.timeout(150)),{url:s.url});assert.equal(r.ok,false);assert.ok(Date.now()-start<2000);}finally{await s.close();}});
  b.add(['tool.cancel','network.cancel'],async()=>{const s=await localServer();try{s.setMode('hang');const controller=new AbortController(),request=s.nextRequest(),pending=tool('web_fetch').execute(context(s.url,controller.signal),{url:s.url});await request;controller.abort(Error('cancelled by user'));const r=await pending;assert.equal(r.ok,false);assert.equal(r.data,undefined);}finally{await s.close();}});
  b.add('hook.repeat',async()=>{const before=f.notices.length;await f.prompt('/web');await f.prompt('/web');assert.equal(f.notices.length-before,2);assert.match(f.notices.at(-1).message,/Internet tools/);});
  b.add(['hook.failure','command.failure'],async()=>{await writeFile(join(f.cwd,'.agent-compositor/web.json'),'bad json');assert.equal((await f.prompt('/web',true)).faults.length,1);await writeFile(join(f.cwd,'.agent-compositor/web.json'),'{}');await f.prompt('/web');assert.match(f.notices.at(-1).message,/Internet tools/);});
 }
 if(f.name==='doctor'){
  const configure=(url:string,timeoutMs=1000)=>{
   f.model=async request=>{let text='';const provider=new OpenAICompatProvider({baseUrl:url+'/model',apiKey:'fixture',model:'local',timeoutMs});for await(const event of provider.complete({...request,messages:request.messages,tools:[],signal:f.abort.signal})){if(event.type==='text_delta')text+=event.text;if(event.type==='finish'&&event.reason==='error')throw Error((event as any).error??'model failed');}return text;};
  };
  b.add('network.success',async()=>{const s=await localServer();try{configure(s.url);await f.prompt('/doctor');assert.match(f.notices.at(-1).message,/ping: OK/);assert.equal(s.hits,1);}finally{await s.close();}});
  for(const mode of ['status','malformed'] as const)b.add('network.'+mode,async()=>{const s=await localServer();try{configure(s.url);s.setMode(mode);await f.prompt('/doctor');assert.match(f.notices.at(-1).message,/ping: FAIL/);}finally{await s.close();}});
  b.add('network.unavailable',async()=>{const s=await localServer();configure(s.url);await s.close();await f.prompt('/doctor');assert.match(f.notices.at(-1).message,/ping: FAIL/);});
  b.add('network.timeout',async()=>{const s=await localServer();try{s.setMode('hang');configure(s.url,150);await f.prompt('/doctor');assert.match(f.notices.at(-1).message,/ping: FAIL/);}finally{await s.close();}});
  b.add('network.cancel',async()=>{const s=await localServer();try{s.setMode('hang');const provider=new OpenAICompatProvider({baseUrl:s.url+'/model',apiKey:'fixture',model:'local',timeoutMs:2000});f.model=async request=>{for await(const event of provider.complete({...request,tools:[],signal:f.abort.signal})){if(event.type==='finish'&&event.reason==='error')throw Error('request cancelled');}return'';};const seen=s.nextRequest(),work=f.prompt('/doctor',true);await seen;f.abort.abort(Error('cancelled'));const result=await work;assert.ok(result.faults.length>0||/FAIL/.test(f.notices.at(-1)?.message??''));}finally{await s.close();}});
 }
}
