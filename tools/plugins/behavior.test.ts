import {it} from 'vitest';
import {behavior} from './behavior/index.js';
const names=['resources','guard-scope','guard-secrets','memory','turn-log','checkpoints','export','slash-commands','output-style','btw','doctor','plan-mode','session-ctl','todos','ui-theme','cost','web','monty','mcp','auto-approve','mascot','plugin-author','workflows','checkpoint-history','callix','network-proxy','git-review','project-checks','ci-review'];
it.each(names)('plugin behavior: %s rejects faults and preserves its documented effects',async name=>{await behavior(name);},30000);
