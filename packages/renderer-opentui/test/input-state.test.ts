import {expect, it} from 'vitest';
import type {QuestionSpec, UiForm} from '@agent-compositor/events';
import {editSecret, emptyQuestionDraft, initialFormValues, questionAnswers, toggleQuestionOption} from '../src/input-state.js';

it('does not manufacture an answer for an unselected recommended option', () => {
  const questions: QuestionSpec[] = [{id: 'mode', question: 'Choose mode', options: [{label: 'Auto', recommended: true}, 'Manual']}];
  expect(questionAnswers(questions, {})).toEqual({answers: [{id: 'mode', selected: []}]});
  let draft = {...emptyQuestionDraft(), text: 'Custom'};
  draft = toggleQuestionOption(questions[0], draft, 'Manual');
  expect(questionAnswers(questions, {mode: draft})).toEqual({answers: [{id: 'mode', selected: ['Manual']}]});
  expect(toggleQuestionOption(questions[0], draft, 'Manual').selected).toEqual([]);
});

it('keeps independent questionnaire answers in declared order and supports multiple choices', () => {
  const questions: QuestionSpec[] = [{id: 'tools', question: 'Tools?', options: ['Read', 'Write'], multi: true}, {id: 'name', question: 'Name?'}];
  const first = toggleQuestionOption(questions[0], emptyQuestionDraft(), 'Write');
  const multi = toggleQuestionOption(questions[0], first, 'Read');
  expect(questionAnswers(questions, {name: {selected: [], text: ' Ada '}, tools: multi}))
    .toEqual({answers: [{id: 'tools', selected: ['Write', 'Read']}, {id: 'name', selected: [], text: 'Ada'}]});
});

it('treats valid question identifiers like constructor as data, not inherited drafts', () => {
  const questions = ['constructor', 'toString'].map(id => ({id, question: 'Choose a value'}));
  expect(questionAnswers(questions, {})).toEqual({answers: [
    {id: 'constructor', selected: []}, {id: 'toString', selected: []},
  ]});
});

it('edits non-ASCII secrets without splitting code points or exceeding the form limit', () => {
  const inserted = editSecret('a😊b', 2, 'insert', '日\r\n');
  expect(inserted).toEqual({value: 'a😊日b', cursor: 3});
  expect(editSecret(inserted.value, 2, 'backspace')).toEqual({value: 'a日b', cursor: 1});
  expect(editSecret('a😊b', 1, 'delete')).toEqual({value: 'ab', cursor: 1});
  expect(editSecret('x'.repeat(4095), 4095, 'insert', '😊')).toEqual({value: 'x'.repeat(4095), cursor: 4095});
  expect(editSecret('abc', 2, 'clear-before')).toEqual({value: 'c', cursor: 0});
});

it('keeps password values empty and does not implicitly select a form choice', () => {
  const form: UiForm = {title: 'Connection', fields: [
    {id: 'key', label: 'Key', type: 'password'},
    {id: 'endpoint', label: 'Endpoint', type: 'url', value: 'https://example.test'},
    {id: 'mode', label: 'Mode', type: 'select', options: [{label: 'OpenAI', value: 'openai'}]},
    {id: 'enabled', label: 'Enabled', type: 'toggle'},
  ], actions: [{id: 'save', label: 'Save'}]};
  expect(initialFormValues(form)).toEqual({key: '', endpoint: 'https://example.test', mode: '', enabled: false});
});
