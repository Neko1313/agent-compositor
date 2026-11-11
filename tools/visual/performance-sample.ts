import {monitorEventLoopDelay,performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const performanceProvider={name:'render-performance-fixture',async *complete(request:any){
  const prompt=request.messages.filter((m:any)=>m.role==='user').at(-1)?.content??'';
  const count=prompt.includes('LONG')?1200:160;
  yield{type:'text_delta' as const,text:'PERFORMANCE_STREAM_STARTED\n\n'};
  for(let i=0;i<count&&!request.signal.aborted;i++){
    yield{type:'text_delta' as const,text:`${i%4===0?'### Section '+i:'- **Entry '+i+'**: evidence'} · 日本語 👩‍💻 café e\u0301\n`};
    if(i%8===0)await new Promise(r=>setTimeout(r,4));
  }
  yield{type:'text_delta' as const,text:'\nPERFORMANCE_STREAM_FINISHED'};
  yield{type:'finish' as const,reason:'stop' as const};
}};

export function profilePerformanceFixture(){
  const lag=monitorEventLoopDelay({resolution:10});lag.enable();
  const start=performance.now(),cpu=process.cpuUsage();
  const save=()=>{lag.disable();writeFileSync(join(process.env.VISUAL_OUTPUT!,'app-performance.json'),JSON.stringify({durationMs:performance.now()-start,cpuUs:process.cpuUsage(cpu),eventLoopDelayMs:{p50:lag.percentile(50)/1e6,p95:lag.percentile(95)/1e6,max:lag.max/1e6},memory:process.memoryUsage()},null,2));};
  process.once('exit',save);process.once('SIGTERM',()=>process.exit(0));
}
