import type {QuestionnaireResult, QuestionSpec, UiForm} from '@agent-compositor/events';

export interface QuestionDraft {selected: string[]; text: string}
export const emptyQuestionDraft = (): QuestionDraft => ({selected: [], text: ''});
export const questionDraft = (drafts: Readonly<Record<string, QuestionDraft>>, id: string): QuestionDraft =>
  Object.hasOwn(drafts, id) ? drafts[id] : emptyQuestionDraft();

export function toggleQuestionOption(question: QuestionSpec, draft: QuestionDraft, label: string): QuestionDraft {
  const selected = draft.selected.includes(label) ? draft.selected.filter(value => value !== label)
    : question.multi ? [...draft.selected, label] : [label];
  return {...draft, selected, ...(!question.multi && selected.length ? {text: ''} : {})};
}

export function questionAnswers(questions: readonly QuestionSpec[], drafts: Readonly<Record<string, QuestionDraft>>): QuestionnaireResult {
  return {answers: questions.map(question => {
    const draft = questionDraft(drafts, question.id);
    const text = draft.text.trim();
    return {id: question.id, selected: [...draft.selected], ...(text ? {text} : {})};
  })};
}

/** The actual secret never enters a native text buffer or rendered text. */
export function editSecret(value: string, cursor: number, action: 'insert' | 'backspace' | 'delete' | 'clear-before' | 'clear-after', inserted = '') {
  const points = Array.from(value);
  const index = Math.max(0, Math.min(points.length, cursor));
  if (action === 'insert') {
    const added = Array.from(inserted.replace(/[\r\n\u0000]/g, ''));
    const limit = Math.max(0, 4096 - value.length);
    let text = '';
    for (const point of added) { if (text.length + point.length > limit) break; text += point; }
    points.splice(index, 0, ...Array.from(text));
    return {value: points.join(''), cursor: index + Array.from(text).length};
  }
  if (action === 'backspace' && index) points.splice(index - 1, 1);
  if (action === 'delete') points.splice(index, 1);
  if (action === 'clear-before') points.splice(0, index);
  if (action === 'clear-after') points.splice(index);
  return {value: points.join(''), cursor: action === 'backspace' ? Math.max(0, index - 1) : action === 'clear-before' ? 0 : index};
}

export function initialFormValues(form: UiForm): Record<string, string | boolean> {
  return Object.fromEntries(form.fields.map(field => [field.id,
    field.type === 'password' ? '' : field.type === 'toggle' ? field.value === true : typeof field.value === 'string' ? field.value : '']));
}
