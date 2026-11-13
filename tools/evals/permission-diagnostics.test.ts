import {expect, it} from 'vitest';
import {permissionDiagnostics} from './permission-diagnostics.js';

const call = (callId: string, input: object, extra = {}) => ({kind: 'catalog', event: 'tool.call', input: {callId, tool: 'exec', input, ...extra}});
const result = (callId: string, extra = {}) => ({kind: 'catalog', event: 'tool.result', input: {callId, tool: 'exec', denied: true, ...extra}});

it('separates identical retries from other refused actions without exposing arguments', () => {
  const report = permissionDiagnostics([
    call('seed', {command: 'node scratch.mjs', cwd: '/private'}), result('seed'),
    call('different', {command: 'git diff'}), result('different'),
    call('retry', {cwd: '/private', command: 'node scratch.mjs'}), result('retry'),
    call('other-cwd', {command: 'node scratch.mjs', cwd: '/elsewhere'}), result('other-cwd'),
    call('check', {command: 'npm test'}), result('check', {denied: false, ok: true}),
  ]);
  expect(report.deniedCalls).toBe(4);
  expect(report.repeatedIdenticalDeniedCalls).toBe(1);
  expect(report.denials[2]).toMatchObject({callId: 'retry', previousIdenticalDeniedCallId: 'seed', eventIndex: 5});
  expect(JSON.stringify(report)).not.toContain('/private');
  expect(JSON.stringify(report)).not.toContain('scratch.mjs');
});

it('does not infer identity from missing/mismatched calls or independent user operations', () => {
  const report = permissionDiagnostics([
    result('missing'), call('mismatch', {}), result('mismatch', {tool: 'read'}),
    call('user', {command: 'npm test'}, {operationId: 'op'}), result('user', {operationId: 'op'}),
    {kind: 'other', event: 'tool.result', input: {callId: 'ignored', denied: true}},
  ]);
  expect(report.deniedCalls).toBe(2);
  expect(report.unmatchedDeniedResults).toBe(2);
  expect(report.repeatedIdenticalDeniedCalls).toBe(0);
});

it('does not connect denied identities across sessions or count ordinary failures as denials', () => {
  const report = permissionDiagnostics([
    call('first', {command: 'node scratch.mjs'}), result('first'),
    {kind: 'catalog', event: 'session.start', input: {}},
    call('second', {command: 'node scratch.mjs'}), result('second'),
    call('failed', {command: 'npm test'}), result('failed', {denied: false, ok: false}),
  ]);
  expect(report.deniedCalls).toBe(2);
  expect(report.repeatedIdenticalDeniedCalls).toBe(0);
  expect(report.unmatchedDeniedResults).toBe(0);
});
