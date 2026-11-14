import {randomUUID} from 'node:crypto';
import type {AgentCore, AgentCoreOptions} from '@agent-compositor/core';
import {
  optionLabel, questionnaireSchema, uiFormSchema, validateQuestionnaireResult, validateUiFormResult,
  type Questionnaire, type UiForm, type UiFormResult, type UserQuestionAnswer, type UserQuestionRequest,
} from '@agent-compositor/events';
import type {ControllerInput, ConversationApproval, ConversationController, ConversationInteraction} from '@agent-compositor/renderer-opentui';
import {createApprovalInbox} from './opentui-approvals.js';
import {createOpenTuiController} from './opentui-controller.js';
import type {UiApprovalResult} from './controller-contracts.js';

type ApprovalRequest = Parameters<NonNullable<AgentCoreOptions['onApproval']>>[0];
type ApprovalResult = Awaited<ReturnType<NonNullable<AgentCoreOptions['onApproval']>>>;
type ControllerEntry = {kind: 'controller'; requester?: string; controller?: ReturnType<typeof createOpenTuiController>; cancel(): void};
type Entry = {requester?: string} & ({
  kind: 'approval'; view: ConversationApproval; approve(allow: boolean): void; cancel(): void;
} | {
  kind: 'interaction'; view: ConversationInteraction; answer(value: unknown): void; cancel(): void;
}) | ControllerEntry;

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
  const selected = (kind: ConversationController['kind']) => core && core.host.controllers.selectedOwner(kind) !== '@host';
  function custom<T>(kind: ConversationController['kind'], data: unknown, signal: AbortSignal | undefined,
    requester: string | undefined, accept: (value: unknown) => T, cancelled: T | Error): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (value: T | Error) => {
        if (settled) return;settled = true;
        signal?.removeEventListener('abort', abort);entry.controller?.close();remove(entry);
        if (value instanceof Error)reject(value);else resolve(value);
      };
      const entry: ControllerEntry = {kind: 'controller', requester, cancel: () => finish(cancelled)};
      const abort = () => entry.cancel();
      signal?.addEventListener('abort', abort, {once: true});push(entry);
      if (signal?.aborted || closed) {abort();return;}
      const unavailable = () => finish(cancelled instanceof Error ? Error('Selected question controller is unavailable') : cancelled);
      try {
        const controller = createOpenTuiController({registry: core!.host.controllers, id: randomUUID(), kind, data, signal,
          current: () => !closed && !settled && queue[0] === entry,
          changed: () => {if (!closed && queue[0] === entry)changed();},
          failed: isCancelled => isCancelled ? abort() : unavailable(),
          result(value) {
            if (value === 'cancel' && kind !== 'approval') {abort();return;}
            try {finish(accept(value));}
            catch {
              if (kind === 'form')entry.controller?.error('Complete the form with valid fields and an offered action');
              else finish(cancelled instanceof Error ? Error('Invalid question controller result') : cancelled);
            }
          },
        });
        entry.controller = controller;
        if (settled)controller.close();else if (queue[0] === entry)changed();
      } catch {unavailable();}
    });
  }
  const inbox = {
    snapshot: () => !closed && queue[0]?.kind === 'approval' ? queue[0].view : undefined,
    interactionSnapshot: () => !closed && queue[0]?.kind === 'interaction' ? queue[0].view : undefined,
    controllerSnapshot: () => !closed && queue[0]?.kind === 'controller' ? queue[0].controller?.snapshot() : undefined,
    requesterSnapshot: () => !closed ? queue[0]?.requester : undefined,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    ask(request: ApprovalRequest, requester?: string): Promise<ApprovalResult> {
      if (closed || request.signal?.aborted) return Promise.resolve(false);
      if (selected('approval')) {
        const {signal, ...data} = request;
        return custom<ApprovalResult>('approval', data, signal, requester, value => {
          const answer = value as Partial<UiApprovalResult> | undefined;
          return answer && typeof answer.allow === 'boolean' && ['once', 'session', 'project'].includes(answer.scope ?? 'once')
            ? {allow: answer.allow, scope: answer.scope ?? 'once'} : false;
        }, false);
      }
      const approval = createApprovalInbox();
      const result = approval.ask({...request});
      const view = approval.snapshot();
      if (!view) { approval.close(); return result; }
      const entry: Entry = {kind: 'approval', requester, view: immutable(structuredClone(view)),
        approve: allow => approval.answer(view.id, allow), cancel: () => approval.close()};
      push(entry);
      return result.finally(() => { remove(entry); approval.close(); });
    },
    async askQuestion(request: UserQuestionRequest, requester?: string): Promise<UserQuestionAnswer> {
      const signal = request.signal;
      if (closed || signal?.aborted) throw Error('Question cancelled');
      let form: Questionnaire, single: boolean;
      try { ({form, single} = questionForm(request)); }
      catch { throw Error('Invalid question request'); }
      const multi = form.questions[0].multi === true;
      if (selected('question')) {
        const options = form.questions[0].options?.map(optionLabel) ?? [];
        const {signal: _signal, ...data} = request;
        return custom<UserQuestionAnswer>('question', data, signal, requester, value => {
          if (!value || typeof value !== 'object' || !('answer' in value))throw Error('Invalid question controller result');
          const answer = value.answer;
          if (!single)return validateQuestionnaireResult(form, answer);
          const labels = typeof answer === 'string' ? [answer] : answer;
          if (!Array.isArray(labels) || !labels.length || labels.some(label => typeof label !== 'string'))throw Error('Invalid answer');
          const other = labels.filter(label => !options.includes(label));
          if (other.length > 1)throw Error('Invalid answer');
          const validated = validateQuestionnaireResult(form, {answers: [{id: 'answer', selected: labels.filter(label => options.includes(label)), ...(other.length ? {text: other[0]} : {})}]}).answers[0];
          const normalized = [...validated.selected, ...(validated.text ? [validated.text] : [])];
          return multi ? normalized : normalized[0];
        }, Error('Question cancelled'));
      }
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
        const entry: Extract<Entry, {kind: 'interaction'}> = {kind: 'interaction', requester, view,
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
      if (selected('form'))return custom<UiFormResult | null>('form', parsed, signal, plugin,
        value => validateUiFormResult(parsed, value), null);
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
        const entry: Extract<Entry, {kind: 'interaction'}> = {kind: 'interaction', requester: plugin, view, cancel: abort,
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
    controllerInput(id: string, input: ControllerInput, revision: number, admitted?: () => void) {
      const first = queue[0];
      if (!closed && first?.kind === 'controller' && first.controller?.snapshot()?.id === id)
        return first.controller.input(input, revision, admitted);
    },
    controllerViewport(id: string, columns: number, rows: number) {
      const first = queue[0];
      if (!closed && first?.kind === 'controller' && first.controller?.snapshot()?.id === id)first.controller.viewport(columns, rows);
    },
    cancelController(id: string) {
      const first = queue[0];
      if (!closed && first?.kind === 'controller' && first.controller?.snapshot()?.id === id)first.cancel();
    },
    bind(owner: AgentCore, options: {forms?: boolean} = {}) {
      if (closed || (core && core !== owner)) throw Error('Interaction inbox already bound or closed');
      if (core) return;
      core = owner;
      if (options.forms !== false)
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
