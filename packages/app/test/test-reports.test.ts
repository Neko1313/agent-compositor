import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {verifyReportPackage} from '../../../tools/plugins/test-reports-contract.js';

it('test-reports: installed package parses actual runner output and enforces bounds, policy, cancellation and lifecycle',async()=>{
 const result=await verifyReportPackage(resolve('plugins/test-reports'));
 expect(result.results.filter(row=>!row.ok)).toEqual([]);
 expect(result).toMatchObject({ok:true,passed:13,total:13,modelRequests:0});
});
