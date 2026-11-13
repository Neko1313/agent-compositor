import {expect, it} from 'vitest';
import {uiFormSchema, validateUiFormResult} from '../src/forms.js';

const request = uiFormSchema.parse({title: 'Connection', fields: [
  {id: 'endpoint', label: 'Endpoint', type: 'url', required: true},
  {id: 'token', label: 'Token', type: 'password', required: true},
  {id: 'mode', label: 'Mode', type: 'select', options: [{value: 'local', label: 'Local'}]},
  {id: 'active', label: 'Active', type: 'toggle', required: true},
], actions: [{id: 'save', label: 'Save'}]});
const valid = {action: 'save', values: {endpoint: 'https://example.test', token: 'private-token', mode: 'local', active: false}};

it('validates private results and returns only declared form fields', () => {
  expect(validateUiFormResult(request, {...valid, values: {...valid.values, extra: 'discard'}})).toEqual(valid);
  for (const value of [null, [], {...valid, action: 'unknown'}, {...valid, values: []},
    {...valid, values: {...valid.values, active: 'yes'}}, {...valid, values: {...valid.values, token: ''}},
    {...valid, values: {...valid.values, mode: 'unknown'}}, {...valid, values: {...valid.values, token: 'x'.repeat(4097)}},
    {...valid, values: {...valid.values, endpoint: 'file:///private-token'}},
  ]) expect(() => validateUiFormResult(request, value)).toThrow();
});

it('does not echo a submitted secret in validation errors', () => {
  const secret = 'private-token-that-must-not-enter-an-error';
  try { validateUiFormResult(request, {...valid, values: {...valid.values, endpoint: 'file:///' + secret}}); }
  catch (error) { expect(String(error)).not.toContain(secret); return; }
  throw Error('Expected invalid URL rejection');
});
