import {expect, it} from 'vitest';
import {Runtime} from '@agent-compositor/runtime';
import {HooksHost, type HooksServiceScope} from '../src/hooks.js';
import type {UiForm} from '@agent-compositor/events';

const form: UiForm = {title: 'Private input', fields: [{id: 'name', label: 'Name', type: 'text'}], actions: [{id: 'cancel', label: 'Cancel'}]};
function fixture() {
  const model = new AbortController();model.abort();
  const host = new HooksHost(new Runtime(), {session: {id: 'test', cwd: '/tmp'}, signal: () => model.signal});
  host.registerPlugin({name: 'owner', version: '1.0.0', trust: 'trusted'}, {});
  const seen: HooksServiceScope[] = [];
  host.setFormHandler(async () => {seen.push(host.currentServiceScope!);return null;});
  return {host, seen};
}

it('captures a fresh actual origin and foreground signal without a UI catalog invocation or model cancellation', async () => {
  const {host, seen} = fixture(), first = new AbortController(), second = new AbortController();
  const origins = [{id: 'first'}, {id: 'second'}];let origin = origins[0], calls = 0;
  host.setInvocationOriginProvider(() => origin);
  host.registerPlugin({name: 'observer', version: '1.0.0', trust: 'trusted'}, {'ui.press': () => {calls++;}, 'ui.change': () => {calls++;}});
  const a = host.withPrivateUiInput('owner', first.signal, api => api);origin = origins[1];
  const b = host.withPrivateUiInput('owner', second.signal, api => api);
  await a.ui.form(form);await b.ui.form(form);
  expect(seen.map(scope => scope.origin)).toEqual(origins);expect(seen.every(scope => !scope.background)).toBe(true);
  expect(seen.map(scope => scope.plugin)).toEqual(['owner', 'owner']);expect(calls).toBe(0);
  first.abort();await expect(a.ui.form(form)).rejects.toThrow();expect(b.signal.aborted).toBe(false);
  expect(() => b.next()).toThrow('cannot continue a catalog hook');host.close();
});

it('leaves inherited retained scope before creating a new private foreground input API', async () => {
  const {host, seen} = fixture(), operation = new AbortController();let origin: object = {id: 'background'};
  host.setInvocationOriginProvider(() => origin);
  const retained = host.withPrivateUiInput('owner', operation.signal, api => api.background());
  host.setFormHandler(async (_plugin, request) => {
    if (request.title === 'Outer') {
      origin = {id: 'current'};
      return host.withPrivateUiInput('owner', operation.signal, api => api.ui.form(form));
    }
    seen.push(host.currentServiceScope!);return null;
  });
  await retained.ui.form({...form, title: 'Outer'});
  expect(seen).toHaveLength(1);expect(seen[0].origin).toEqual({id: 'current'});expect(seen[0].background).toBe(false);
  host.close();
});

it('revokes an old plugin instance API without granting it a same-name replacement lifetime', async () => {
  const {host} = fixture(), input = new AbortController();
  const old = host.withPrivateUiInput('owner', input.signal, api => api);
  host.unregisterPlugin('owner');host.registerPlugin({name: 'owner', version: '1.0.1', trust: 'trusted'}, {});
  await expect(old.ui.form(form)).rejects.toThrow();
  const fresh = host.withPrivateUiInput('owner', input.signal, api => api);expect(fresh.signal.aborted).toBe(false);
  await expect(fresh.ui.form(form)).resolves.toBeNull();host.close();
});

it('requires a loaded trusted owner and live input signal before invoking private code', () => {
  const {host} = fixture(), input = new AbortController();let invoked = false;
  host.registerPlugin({name: 'untrusted', version: '1.0.0', trust: 'render-only'}, {});
  for (const owner of ['missing', 'untrusted'])expect(() => host.withPrivateUiInput(owner, input.signal, () => {invoked = true;})).toThrow('unavailable');
  input.abort();expect(() => host.withPrivateUiInput('owner', input.signal, () => {invoked = true;})).toThrow();
  expect(invoked).toBe(false);host.close();
});
