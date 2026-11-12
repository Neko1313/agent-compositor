import type { Readable, Writable } from "node:stream";
import { AgentCore } from "@agent-compositor/core";
import { decodeKeys, type DecoderState } from "./keys.js";
import { TerminalRenderer } from "./renderer.js";
import {StringDecoder} from 'node:string_decoder';
import {questionInput} from './question-input.js';

export interface ReplDeps {
  /** factory so the approval/ask bridges can be injected into core options */
  createCore: (
    onApproval: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onApproval"]>,
    onAsk?: NonNullable<ConstructorParameters<typeof AgentCore>[0]["onAsk"]>,
  ) => AgentCore;
  stdin: Readable & { isTTY?: boolean; setRawMode?: (mode: boolean) => void };
  stdout: Writable;
  /** line-based input source for approvals/questions (raw-mode stdin or test stub) */
  promptKey?: (question: string) => Promise<string>;
}

/**
 * The interactive REPL: raw-mode keystrokes → loop intents. One-directional
 * by design — the renderer owns output, this owns input, the core owns state.
 */
export async function runRepl(deps: ReplDeps): Promise<void> {
  const useRaw = deps.stdin.isTTY === true && typeof deps.stdin.setRawMode === "function";
  const questions=questionInput(text=>{deps.stdout.write(text);});
  const renderer = new TerminalRenderer(deps.stdout, deps.promptKey??questions.read);
  // the ask channel only exists when a human is actually at the keyboard;
  // piped/headless sessions stay fail-closed (ask_user → deny)
  const core = deps.createCore(
    (req) => useRaw||deps.promptKey?renderer.askApproval({ tool: req.tool, args: req.descriptor, reason: req.reason,signal:req.signal }):Promise.resolve(false),
    useRaw ? (req) => renderer.askUser(req) : undefined,
  );
  const detachRenderer=renderer.attach(core);

  const state: DecoderState = { line: "", running: false };

  deps.stdout.write("agent-compositor — Enter submit · Tab steer · Ctrl+C interrupt/exit\n");

  const pending=new Set<Promise<void>>();
  let dispatch=Promise.resolve(),setup=Promise.resolve(),queued=0,generation=0,accepting=true;
  const reportError=(error:unknown)=>{deps.stdout.write(`\n[input error: ${String(error).replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300)}]\n`);};
  const track=(work:Promise<unknown>)=>{
    const safe=work.then(()=>{},reportError);pending.add(safe);
    void safe.finally(()=>pending.delete(safe));return safe;
  };
  const schedule=(text:string,steer=false)=>{
    const accepted=generation;queued++;
    dispatch=dispatch.then(()=>{
      if(accepted!==generation)return;
      if(core.hasImmediateCommand(text)){
        const busy=core.getState()==='running';
        const command=track(core.invokeCommand(text));
        // Prompts wait for preceding setup; controls never wait for other controls.
        if(!busy)setup=Promise.all([setup,command]).then(()=>{});
      }else{
        track(setup.then(()=>{
          if(accepted!==generation)return;
          if(steer)deps.stdout.write(`\n[steer] ${text}\n`);
          return steer?core.steer(text):core.submit(text);
        }));
      }
    }).catch(reportError).finally(()=>{queued--;});
  };
  let removeInputListeners=()=>{};
  try{
    await core.start();
    if(useRaw)deps.stdin.setRawMode?.(true);
    await new Promise<void>((resolve,reject)=>{
      const decoder=new StringDecoder('utf8');
      let previousCR=false;
      let finishing:Promise<void>|undefined;
      const finish=()=>{
        if(finishing)return finishing;
        accepting=false;
        finishing=(async()=>{
          await dispatch;
          // EOF waits for both the model and every accepted independent control.
          while(pending.size)await Promise.all([...pending]);
          resolve();
        })();
        void finishing.catch(reject);return finishing;
      };
      const onData=(chunk:Buffer|string)=>{
        if(!accepting)return;
        const text=typeof chunk==='string'?chunk:decoder.write(chunk);
        for(const character of text){
          const skipLF=previousCR&&character==='\n';previousCR=character==='\r';if(skipLF)continue;
          const answer=questions.consume(character);
          if(answer){if(answer==='interrupt'){generation++;core.cancelOperations();core.interrupt();}continue;}
          state.running=core.getState()==='running'||core.hasActiveOperations||queued>0;
          for(const command of decodeKeys(character,state)){
            switch(command.type){
              case 'submit':schedule(command.text);break;
              case 'steer':schedule(command.text,true);break;
              case 'interrupt':generation++;core.cancelOperations();core.interrupt();break;
              case 'exit':deps.stdout.write('\nbye\n');void finish();return;
              case 'char':deps.stdout.write(command.ch);break;
              case 'ignore':break;
            }
          }
        }
      };
      const onEnd=()=>{const tail=decoder.end();if(tail)onData(tail);questions.close();void finish();};
      const onError=(error:Error)=>{accepting=false;generation++;questions.close();core.cancelOperations();core.interrupt();reject(error);};
      deps.stdin.on('data',onData);deps.stdin.once('end',onEnd);deps.stdin.once('error',onError);
      removeInputListeners=()=>{deps.stdin.off('data',onData);deps.stdin.off('end',onEnd);deps.stdin.off('error',onError);};
      deps.stdin.resume();
    });
  }finally{
    if(useRaw)deps.stdin.setRawMode?.(false);
    questions.close();removeInputListeners();deps.stdin.pause();detachRenderer();
  }
}
