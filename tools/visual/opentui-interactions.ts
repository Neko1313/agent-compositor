import {randomUUID} from 'node:crypto';
import type {AgentCore, AgentCoreOptions} from '@agent-compositor/core';
import {
  questionnaireSchema, uiFormSchema, validateQuestionnaireResult, validateUiFormResult,
  type Questionnaire, type UiForm, type UiFormResult, type UserQuestionAnswer, type UserQuestionRequest,
} from '@agent-compositor/events';
import type {ConversationApproval, ConversationInteraction} from '@agent-compositor/renderer-opentui';
import {createApprovalInbox} from './opentui-approvals.js';

type ApprovalRequest = Parameters<NonNullable<AgentCoreOptions['onApproval']>>[0];
type Entry = {
  kind: 'approval'; view: ConversationApproval; approve(allow: boolean): void; cancel(): void;
} | {
  kind: 'interaction'; view: ConversationInteraction; answer(value: unknown): void; cancel(): void;
};

function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) immutable(child);
  }
  return value;
}

function questionForm(request: UserQuestionRequest): {form: Questionnaire; single: boolean} {
  if (request.questions) return {
    form: questionnaireSchema.parse({title: request.question, questions: request.questions}), single: false,
  };
  const details = new Map(request.optionDetails?.map(option => [option.label, option]));
  return {single: true, form: questionnaireSchema.parse({
    questions: [{id: 'answer', question: request.question,
      options: request.options?.map(label => details.get(label) ?? label),
      multi: request.multi, allowOther: request.allowOther}],
  })};
}

/** All manual inputs in a conversation share one active FIFO request. */
export function createInteractionInbox() {
  const queue: Entry[] = [];
  const listeners = new Set<() => void>();
  let closed = false;
  let core: AgentCore | undefined;
  let unbindForm: (() => void) | undefined;
  const changed = () => { for (const listener of listeners) listener(); };
  function remove(entry: Entry) {
    const index = queue.indexOf(entry);
    if (index < 0) return;
    queue.splice(index, 1);
    if (!closed && index === 0) changed();
  }
  function push(entry: Entry) {
    queue.push(entry);
    if (queue.length === 1) changed();
  }
  function nativeController(kind: 'question' | 'form') {
    if (core && core.host.controllers.selectedOwner(kind) !== '@host')
      throw Error('Selected ' + kind + ' controllers are not supported by the OpenTUI preview');
  }
  const inbox = {
    snapshot: () => !closed && queue[0]?.kind === 'approval' ? queue[0].view : undefined,
    interactionSnapshot: () => !closed && queue[0]?.kind === 'interaction' ? queue[0].view : undefined,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ask(request: ApprovalRequest): Promise<boolean> {
      if (closed || request.signal?.aborted) return Promise.resolve(false);
      const approval = createApprovalInbox();
      const result = approval.ask({...request});
      const view = approval.snapshot();
      if (!view) { approval.close(); return result; }
      const entry: Entry = {kind: 'approval', view: immutable(structuredClone(view)),
        approve: allow => approval.answer(view.id, allow), cancel: () => approval.close()};
      push(entry);
      return result.finally(() => { remove(entry); approval.close(); });
    },
    async askQuestion(request: UserQuestionRequest): Promise<UserQuestionAnswer> {
      const signal = request.signal;
      if (closed || signal?.aborted) throw Error('Question cancelled');
      let form: Questionnaire, single: boolean;
      try { ({form, single} = questionForm(request)); }
      catch { throw Error('Invalid question request'); }
      nativeController('question');
      const multi = form.questions[0].multi === true;
      const view: ConversationInteraction = immutable({id: randomUUID(), kind: 'question', request: form});
      return new Promise<UserQuestionAnswer>((resolve, reject) => {
        let settled = false;
        const finish = (answer?: UserQuestionAnswer) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', abort);
          remove(entry);
          if (answer === undefined) reject(Error('Question cancelled'));
          else resolve(answer);
        };
        const abort = () => finish();
        const entry: Entry = {kind: 'interaction', view,
          cancel: abort,
          answer(value) {
            try {
              const result = validateQuestionnaireResult(form, value);
              if (!single) { finish(result); return; }
              const answer = result.answers[0];
              const labels = [...answer.selected, ...(answer.text ? [answer.text] : [])];
              finish(multi ? labels : labels[0]);
            } catch {
              entry.view = immutable({...entry.view, error: 'Complete each question with an allowed answer'});
              changed();
            }
          }};
        signal?.addEventListener('abort', abort, {once: true});
        push(entry);
        if (signal?.aborted || closed) abort();
      });
    },
    async form(plugin: string, request: UiForm, signal: AbortSignal): Promise<UiFormResult | null> {
      if (closed || signal.aborted) return null;
      let parsed: UiForm;
      try { parsed = uiFormSchema.parse(request); }
      catch { throw Error('Invalid private form request'); }
      nativeController('form');
      const view: ConversationInteraction = immutable({id: randomUUID(), kind: 'form', plugin, request: parsed});
      return new Promise(resolve => {
        let settled = false;
        const finish = (result: UiFormResult | null) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', abort);
          remove(entry);
          resolve(result);
        };
        const abort = () => finish(null);
        const entry: Entry = {kind: 'interaction', view, cancel: abort,
          answer(value) {
            try { finish(validateUiFormResult(parsed, value)); }
            catch {
              entry.view = immutable({...entry.view, error: 'Complete the form with valid fields and an offered action'});
              changed();
            }
          }};
        signal.addEventListener('abort', abort, {once: true});
        push(entry);
        if (signal.aborted || closed) abort();
      });
    },
    answer(id: string, allow: boolean) {
      const first = queue[0];
      if (!closed && first?.kind === 'approval' && first.view.id === id) first.approve(allow === true);
    },
    answerInteraction(id: string, value: unknown) {
      const first = queue[0];
      if (!closed && first?.kind === 'interaction' && first.view.id === id) first.answer(value);
    },
    cancelInteraction(id: string) {
      const first = queue[0];
      if (!closed && first?.kind === 'interaction' && first.view.id === id) first.cancel();
    },
    bind(owner: AgentCore) {
      if (closed || (core && core !== owner)) throw Error('Interaction inbox already bound or closed');
      if (core) return;
      core = owner;
      unbindForm = owner.host.setFormHandler((plugin, request, signal) => inbox.form(plugin, request, signal));
    },
    close() {
      if (closed) return;
      closed = true;
      for (const entry of [...queue]) entry.cancel();
      queue.length = 0;
      unbindForm?.();
      unbindForm = undefined;
      core = undefined;
      changed();
      listeners.clear();
    },
  };
  return inbox;
}
