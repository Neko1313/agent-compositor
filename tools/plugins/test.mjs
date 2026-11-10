import {execFileSync} from 'node:child_process';
const name=process.argv[2];if(!name)throw Error('Usage: npm run plugin:test -- <plugin>');
execFileSync(process.execPath,['tools/plugins/check.ts',name,'--test'],{stdio:'inherit',env:process.env});
