import {queryObservation} from './query-progress.js';

/** Recognize a narrow set of foreground check commands; do not run or cache them. */
export function failedCheckObservation(args:unknown,result:unknown):string|undefined {
 if(!args||typeof args!=='object'||Array.isArray(args)||!result||typeof result!=='object'||Array.isArray(result))return;
 const input=args as Record<string,unknown>,output=result as Record<string,unknown>,command=input.command;
 if(typeof command!=='string'||input.background===true||/[;&|<>`\r\n]/.test(command)||command.includes('$('))return;
 const check=/^(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|typecheck|lint|check|build|verify)(?::[a-z0-9_-]+)?|(?:npx|bunx)\s+(?:vitest|jest|tsc|eslint|pytest)|(?:vitest|jest|tsc|eslint|pytest)|node\s+[^\s/]*checks?\.[cm]?js)(?:\s|$)/i;
 if(!check.test(command.trim())||!Number.isInteger(output.exitCode)||(output.exitCode as number)<=0||typeof output.stdout!=='string'||typeof output.stderr!=='string')return;
 try{return queryObservation('failed-check',input,JSON.stringify([output.exitCode,output.stdout,output.stderr]));}
 catch{return; /* A diagnostic must never change the result of an executed command. */}
}

/** One reminder per unchanged failure streak; neutral observations do not reset it. */
export class CheckProgress {
 private previous?:string;
 private reminded=false;
 reset():void {this.previous=undefined;this.reminded=false;}
 observe(key:string):boolean {
  if(key!==this.previous){this.previous=key;this.reminded=false;return false;}
  if(this.reminded)return false;
  this.reminded=true;return true;
 }
}
