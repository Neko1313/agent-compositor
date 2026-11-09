import {access} from 'node:fs/promises';import {constants} from 'node:fs';import {resolve} from 'node:path';import {spawn} from 'node:child_process';
const binary=resolve(process.env.CALLIX_TEST_BIN??'plugins/callix/bin/callix');
try{await access(binary,constants.X_OK);}catch{throw Error('Install the pinned native binary first: node plugins/callix/install.mjs, or set CALLIX_TEST_BIN.');}
const proc=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','packages/app/test/callix.test.ts','packages/app/test/callix-navigation.test.ts','packages/app/test/callix-background.test.ts','packages/tools/test/navigation-edit.test.ts'],{stdio:'inherit',env:{...process.env,CALLIX_TEST_BIN:binary}});proc.once('exit',code=>{process.exitCode=code??1;});
