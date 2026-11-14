import {expect, it} from 'vitest';
import {createConversationScrollMemory, type ConversationScrollBoxLike} from '../src/conversation-scroll.js';

function box(top = 0, content = 100, height = 10) {
  const callbacks: (() => void)[] = [], calls: number[] = [];
  return {
    scrollTop: top, scrollHeight: content, viewport: {height}, isDestroyed: false,
    afterLayout(callback: () => void) {callbacks.push(callback);},
    scrollTo(value: number) {calls.push(value);this.scrollTop = Math.min(value, Math.max(0, this.scrollHeight - this.viewport.height));},
    layout(index = 0) {callbacks.splice(index, 1)[0]?.();},
    callbacks, calls,
  } satisfies ConversationScrollBoxLike & {layout(index?: number): void; callbacks: (() => void)[]; calls: number[]};
}

it('keeps pane positions independent and restores after layout rather than during the request', () => {
  const memory = createConversationScrollMemory(), source = box(25);
  memory.capture('a', source);source.scrollTop = 60;memory.capture('b', source);
  source.scrollHeight = 200;source.viewport.height = 20;
  memory.restore('a', source);expect(source.calls).toEqual([]);source.layout();expect(source.calls).toEqual([25]);
  memory.restore('b', source);source.layout();expect(source.calls).toEqual([25, 60]);
});

it('preserves a scrolled position through streaming growth and follows growth only from the bottom', () => {
  const memory = createConversationScrollMemory(), scrolled = box(89), bottom = box(90);
  memory.capture('reading', scrolled);memory.capture('following', bottom);
  scrolled.scrollHeight = bottom.scrollHeight = 150;
  memory.restore('reading', scrolled);memory.restore('following', bottom);scrolled.layout();bottom.layout();
  expect(scrolled.calls).toEqual([89]);expect(bottom.calls).toEqual([Infinity]);expect(bottom.scrollTop).toBe(140);
  const fresh = box();memory.restore('new', fresh);fresh.layout();expect(fresh.calls).toEqual([Infinity]);
});

it('reads the latest capture when resident and read-only roles hand the pane over before layout', () => {
  const memory = createConversationScrollMemory(), resident = box(), readOnly = box(31);
  memory.restore('a', resident);memory.capture('a', readOnly);resident.layout();expect(resident.calls).toEqual([31]);
});

it('supersedes queued A to B to A restores even when native callbacks arrive out of order', () => {
  const memory = createConversationScrollMemory(), source = box(15), other = box(50);
  memory.capture('a', source);memory.capture('b', other);
  const cancelA = memory.restore('a', source);memory.restore('b', source);memory.restore('a', source);
  cancelA();source.layout(1);source.layout(1);source.layout();expect(source.calls).toEqual([15]);
});

it('does not let a hidden or unmeasured capture overwrite a measured position', () => {
  const memory = createConversationScrollMemory(), source = box(34);
  expect(memory.capture('a', source)).toBe(true);source.viewport.height = 0;source.scrollTop = 0;
  expect(memory.capture('a', source)).toBe(false);memory.restore('a', source);source.layout();expect(source.calls).toEqual([]);
  source.viewport.height = 10;memory.restore('a', source);source.layout();expect(source.calls).toEqual([34]);
  source.viewport.height = NaN;expect(memory.capture('a', source)).toBe(false);
});

it('clamps a retained position after content shrinks without changing it into bottom-following memory', () => {
  const memory = createConversationScrollMemory(), source = box(50);
  memory.capture('a', source);source.scrollHeight = 30;memory.restore('a', source);source.layout();expect(source.calls).toEqual([20]);
  source.scrollHeight = 100;memory.restore('a', source);source.layout();expect(source.calls).toEqual([20, 50]);
});

it('cancels unmounted restores and skips native boxes destroyed before or after scheduling', () => {
  const memory = createConversationScrollMemory(), source = box();
  const cancel = memory.restore('a', source);cancel();source.layout();expect(source.calls).toEqual([]);
  memory.restore('a', source);source.isDestroyed = true;source.layout();expect(source.calls).toEqual([]);
  expect(memory.capture('a', source)).toBe(false);memory.restore('a', source);expect(source.callbacks).toEqual([]);
});

it('clears all pane positions and pending boxes only when the conversation epoch changes', () => {
  const memory = createConversationScrollMemory(), a = box(25), b = box(40);
  memory.reset('old');memory.capture('a', a);memory.capture('b', b);
  memory.restore('a', a);memory.restore('b', b);memory.reset('old');a.layout();b.layout();
  expect(a.calls).toEqual([25]);expect(b.calls).toEqual([40]);
  memory.restore('a', a);memory.restore('b', b);memory.reset('new');a.layout();b.layout();
  expect(a.calls).toEqual([25]);expect(b.calls).toEqual([40]);
  memory.restore('a', a);memory.restore('b', b);a.layout();b.layout();
  expect(a.calls).toEqual([25, Infinity]);expect(b.calls).toEqual([40, Infinity]);
});
