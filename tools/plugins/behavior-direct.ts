import {behavior,behaviorRequirements} from './behavior/index.js';
const name=process.argv[2];console.log(JSON.stringify(process.argv.includes('--describe')?await behaviorRequirements(name):await behavior(name,process.argv[3])));
