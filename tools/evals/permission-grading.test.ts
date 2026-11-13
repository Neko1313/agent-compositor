import {expect,it} from 'vitest';
import {gradePermissionPreviews} from './grading.js';
const want={tool:'exec',args:{command:'npm test',timeoutMs:1000},decision:'allow' as const};
const call={kind:'catalog',event:'tool.call',input:{tool:'tool_help',callId:'preview',input:{name:'exec',preview:{timeoutMs:1000,command:'npm test'}}}};
const result={kind:'catalog',event:'tool.result',input:{tool:'tool_help',callId:'preview',ok:true,output:{permission:{decision:'allow',scope:'rules-and-session-approvals',executionAuthorized:false}}}};
it('grades actual matched preview results independently of key order',()=>{
 expect(gradePermissionPreviews([call,result],[want])[0].ok).toBe(true);
});
it.each([
 {name:'missing call',events:[result]},
 {name:'wrong call id',events:[call,{...result,input:{...result.input,callId:'different'}}]},
 {name:'wrong arguments',events:[call,result],expected:{...want,args:{command:'npm test'}}},
 {name:'failed result',events:[call,{...result,input:{...result.input,ok:false}}]},
 {name:'claimed authorization',events:[call,{...result,input:{...result.input,output:{permission:{...result.input.output.permission,executionAuthorized:true}}}}]},
 {name:'wrong decision',events:[call,{...result,input:{...result.input,output:{permission:{...result.input.output.permission,decision:'deny'}}}}]},
 {name:'independent user operation',events:[{...call,input:{...call.input,operationId:'op'}},{...result,input:{...result.input,operationId:'op'}}]},
])('rejects $name evidence',({events,expected})=>{
 expect(gradePermissionPreviews(events,[expected??want])[0].ok).toBe(false);
});
