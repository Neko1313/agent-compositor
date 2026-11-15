import {expect, it} from 'vitest';
import {completeJsonLines} from './jsonl.mjs';

it('reads only complete records and still rejects a malformed completed record', () => {
  expect(completeJsonLines('{"id":1}\n{"id":')).toEqual([{id: 1}]);
  expect(completeJsonLines('{"id":1}\n{"id":2}\n')).toEqual([{id: 1}, {id: 2}]);
  expect(() => completeJsonLines('{bad}\n')).toThrow();
});
