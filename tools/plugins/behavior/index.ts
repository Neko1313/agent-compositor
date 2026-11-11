import {ciReview} from './ci-review.js';
import {projectChecks} from './project-checks.js';
import {gitReview} from './git-review.js';
import {Fixture,Casebook} from './fixture.js';
import {persisted} from './persisted.js';
import {network} from './network.js';
import {processes} from './processes.js';
import {optionalUi} from './optional-ui.js';
import {author} from './author.js';
import {workflows} from './workflows.js';
import {checkpoints} from './checkpoints.js';
import {callix} from './callix.js';
import {proxy} from './proxy.js';
import {simple} from './simple.js';
import {backgroundJobs} from './background-jobs.js';
export function registerBehavior(f:Fixture,book:Casebook){simple(f,book);persisted(f,book);network(f,book);processes(f,book);optionalUi(f,book);author(f,book);workflows(f,book);checkpoints(f,book);callix(f,book);proxy(f,book);backgroundJobs(f,book);gitReview(f,book);projectChecks(f,book);ciReview(f,book);}
export async function behavior(name:string,directory?:string){
 const f=await new Fixture(name,directory).init(),book=new Casebook(f);
 try{registerBehavior(f,book);if(!book.checks.size)throw Error('No domain oracles for '+name);await book.run();return book.observations;}finally{await f.close();}
}
export async function behaviorRequirements(name:string){const f=await new Fixture(name).init(),book=new Casebook(f);try{registerBehavior(f,book);return[...book.checks.keys()];}finally{await f.close();}}
