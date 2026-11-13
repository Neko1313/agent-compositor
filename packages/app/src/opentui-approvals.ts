import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import type {AgentCoreOptions} from '@agent-compositor/core';
import type {ConversationApproval} from '@agent-compositor/renderer-opentui';

type Request = Parameters<NonNullable<AgentCoreOptions['onApproval']>>[0];

/** One queue per conversation. Decisions apply only to the request on screen. */
export function createApprovalInbox() {
  const pending: {view: ConversationApproval; settle: (allow: boolean) => void}[] = [];
  const listeners = new Set<() => void>();
  let closed = false;
  const changed = () => { for (const listener of listeners) listener(); };
  return {
    snapshot: () => pending[0]?.view,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ask(request: Request): Promise<boolean> {
      if (closed || request.signal?.aborted) return Promise.resolve(false);
      const {descriptor, input} = request;
      const details: {label: string; value: string}[] = [];
      if (descriptor.path !== undefined) details.push({label: 'Path', value: descriptor.path});
      if (descriptor.url !== undefined) details.push({label: 'URL', value: descriptor.url});
      if (descriptor.command !== undefined) details.push({label: 'Permission tokens', value: JSON.stringify(descriptor.command)});
      if (descriptor.tool !== request.tool) details.push({label: 'Permission tool', value: descriptor.tool});
      if (descriptor.readOnly !== undefined) details.push({label: 'Read only', value: String(descriptor.readOnly)});
      if (input !== undefined) {
        // Never present a partial set of arguments as the complete action.
        try {
          const value = JSON.stringify(input);
          if (value === undefined || !isDeepStrictEqual(JSON.parse(value), input)) return Promise.resolve(false);
          details.push({label: 'Arguments', value});
        }
        catch { return Promise.resolve(false); }
      }
      const view = {id: randomUUID(), tool: request.tool, reason: request.reason ?? '', details};
      return new Promise<boolean>(resolve => {
        const abort = () => settle(false);
        const settle = (allow: boolean) => {
          const position = pending.findIndex(item => item.view === view);
          if (position === -1) return;
          pending.splice(position, 1);
          request.signal?.removeEventListener('abort', abort);
          resolve(allow);
          if (!closed && position === 0) changed();
        };
        pending.push({view, settle});
        request.signal?.addEventListener('abort', abort, {once: true});
        if (pending.length === 1) changed();
      });
    },
    answer(id: string, allow: boolean) {
      const first = pending[0];
      if (first?.view.id === id) first.settle(allow === true);
    },
    close() {
      if (closed) return;
      closed = true;
      for (const request of [...pending]) request.settle(false);
      changed();
      listeners.clear();
    },
  };
}
