/** @jsxImportSource @opentui/react */
import {MouseButton, TextAttributes, type InputRenderable, type KeyEvent, type ScrollBoxRenderable} from '@opentui/core';
import {flushSync, useKeyboard} from '@opentui/react';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {QuestionSpec, UiForm} from '@agent-compositor/events';
import {useAppearance} from './appearance.js';
import {editSecret, emptyQuestionDraft, initialFormValues, questionAnswers, questionDraft, toggleQuestionOption, type QuestionDraft} from './input-state.js';
import type {ConversationInteraction, ConversationSession} from './session.js';
import {handleActionMouseDown} from './mouse-action.js';

function display(value: string) {
  return value.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu, point =>
    '\\u' + point.charCodeAt(0).toString(16).padStart(4, '0'));
}

function Button({label, onPress, isActive, selected, disabled}: {label: string; onPress(): void; isActive(): boolean; selected?: boolean; disabled?: boolean}) {
  const {color}=useAppearance();
  return <box height={1} flexShrink={0} paddingX={1} backgroundColor={selected ? color.selectionBackground : color.panel}
    onMouseDown={event => {
      handleActionMouseDown(event, !disabled && isActive(), onPress);
    }}>
    <text selectable={false} fg={disabled ? color.muted : selected ? color.selectionText : color.text}>{label}</text>
  </box>;
}

interface TextFieldProps {
  id: string;
  value: string;
  focused: boolean;
  active(): boolean;
  onChange(value: string): void;
  onFocus(): void;
  placeholder: string;
  secret?: boolean;
}

function TextField({id, value, focused, active, onChange, onFocus, placeholder, secret}: TextFieldProps) {
  const {color}=useAppearance();
  const input = useRef<InputRenderable>(null);
  const valueRef = useRef(value);
  const [secretLength, setSecretLength] = useState(0);
  const live = useRef(true);
  if (!secret) valueRef.current = value;
  useLayoutEffect(() => {
    live.current = true;
    return () => {live.current = false; valueRef.current = ''; input.current?.setText('');};
  }, []);

  function passwordKey(key: KeyEvent) {
    if (!live.current || !active()) {key.preventDefault(); return;}
    if (key.defaultPrevented || !secret) return;
    const native = input.current;
    if (!native) return;
    const cursor = native.cursorOffset;
    const size = Array.from(valueRef.current).length;
    let next: ReturnType<typeof editSecret> | undefined;
    if (key.name === 'left' && !key.meta) native.cursorOffset = Math.max(0, cursor - 1);
    else if (key.name === 'right' && !key.meta) native.cursorOffset = Math.min(size, cursor + 1);
    else if (key.name === 'home' || (key.ctrl && key.name === 'a')) native.cursorOffset = 0;
    else if (key.name === 'end' || (key.ctrl && key.name === 'e')) native.cursorOffset = size;
    else if (key.ctrl && key.name === 'u') next = editSecret(valueRef.current, cursor, 'clear-before');
    else if (key.ctrl && key.name === 'k') next = editSecret(valueRef.current, cursor, 'clear-after');
    else if (key.name === 'backspace') next = editSecret(valueRef.current, cursor, 'backspace');
    else if (key.name === 'delete') next = editSecret(valueRef.current, cursor, 'delete');
    else if (!key.ctrl && !key.meta && !key.super && !key.hyper && key.sequence && !/\p{Cc}/u.test(key.sequence))
      next = editSecret(valueRef.current, cursor, 'insert', key.sequence);
    key.preventDefault();
    if (next) {
      valueRef.current = next.value;
      native.setText('*'.repeat(Array.from(next.value).length));
      native.cursorOffset = next.cursor;
      setSecretLength(Array.from(next.value).length);
      onChange(next.value);
    }
  }

  return <box id={id} flexDirection="row" height={1} backgroundColor={focused ? color.actionBackground : color.panel}
    onMouseDown={event => {if (event.button === MouseButton.LEFT && live.current && active()) onFocus();}}>
    <input ref={input} value={secret ? '*'.repeat(secretLength) : value}
      focused={focused} flexGrow={1} minWidth={1} scrollMargin={0} maxLength={4096} placeholder={placeholder}
      textColor={color.text} focusedTextColor={color.text} backgroundColor={color.panel} focusedBackgroundColor={color.panel}
      placeholderColor={color.muted} cursorColor={color.accent} selectable={!secret}
      onKeyDown={passwordKey}
      onPaste={event => {
        if (!live.current || !active()) {event.preventDefault(); return;}
        if (secret) {
          event.preventDefault();
          const native = input.current;
          const next = editSecret(valueRef.current, native?.cursorOffset ?? 0, 'insert', new TextDecoder().decode(event.bytes));
          valueRef.current = next.value;
          native?.setText('*'.repeat(Array.from(next.value).length));
          if (native) native.cursorOffset = next.cursor;
          setSecretLength(Array.from(next.value).length);
          onChange(next.value);
        }
      }}
      onInput={text => {if (live.current && !secret && active()) onChange(text);}} />
  </box>;
}

export function Interaction({interaction, session, editing, focused, width, height, isActive, setEditing,draftToggle=true}: {
  interaction: ConversationInteraction;
  session: ConversationSession;
  editing: boolean;
  focused: boolean;
  width: number;
  height: number;
  isActive(): boolean;
  setEditing(editing: boolean): void;
  draftToggle?:boolean;
}) {
  const {color,chrome,presentation}=useAppearance();
  const [page, setPage] = useState(0);
  const [target, setTarget] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    interaction.kind === 'form' ? initialFormValues(interaction.request) : {});
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const secrets = useRef<Record<string, string>>(Object.create(null));
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const scroller = useRef<ScrollBoxRenderable>(null);
  const current = () => isActive() && session.snapshot().interaction?.id === interaction.id;
  const active = () => current() && editing;
  const questions = interaction.kind === 'question' ? interaction.request.questions : [];
  const question = questions[page];
  const options = question?.options ?? [];
  const custom = Boolean(question && (!options.length || question.allowOther !== false));
  const targets = interaction.kind === 'form' ? interaction.request.fields.length + interaction.request.actions.length
    : options.length + Number(custom);
  const draft = question ? questionDraft(drafts, question.id) : emptyQuestionDraft();
  const field = interaction.kind === 'form' ? interaction.request.fields[target] : undefined;
  const actionIndex = interaction.kind === 'form' ? Math.max(0, target - interaction.request.fields.length) : 0;
  const submitLabel = interaction.kind === 'form' ? interaction.request.actions[actionIndex]?.label ?? interaction.request.actions[0].label : 'Submit';

  useEffect(() => () => {
    for (const id of Object.keys(valuesRef.current)) valuesRef.current[id] = '';
    for (const id of Object.keys(secrets.current)) secrets.current[id] = '';
    valuesRef.current = {};
  }, []);
  useLayoutEffect(() => {
    if (editing && focused) scroller.current?.scrollChildIntoView('interaction-field-' + target);
  }, [editing, focused, target, page, width, height, interaction.error]);

  function choose(index: number) {
    if (!current() || !question) return;
    setEditing(true);
    flushSync(() => setTarget(index));
    const option = options[index];
    if (option !== undefined) {
      const label = typeof option === 'string' ? option : option.label;
      flushSync(() => setDrafts(previous => ({...previous, [question.id]: toggleQuestionOption(question, questionDraft(previous, question.id), label)})));
    }
  }
  function changePage(next: number) {
    if (!current()) return;
    flushSync(() => {setPage(Math.max(0, Math.min(questions.length - 1, next))); setTarget(0);});
  }
  function formValue(id: string, value: string | boolean) {
    if (!current()) return;
    if (interaction.kind === 'form' && interaction.request.fields.some(field => field.id === id && field.type === 'password')) {
      secrets.current[id] = String(value);
      return;
    }
    valuesRef.current = {...valuesRef.current, [id]: value};
    flushSync(() => setValues(valuesRef.current));
  }
  function adjustField(delta: number) {
    if (!active() || !field) return;
    if (field.type === 'toggle') formValue(field.id, values[field.id] !== true);
    if (field.type === 'select' && field.options?.length) {
      const index = field.options.findIndex(option => option.value === values[field.id]);
      const next = index < 0 ? delta > 0 ? 0 : field.options.length - 1
        : (index + delta + field.options.length) % field.options.length;
      formValue(field.id, field.options[next].value);
    }
  }
  function submit(action?: string) {
    if (!active()) return;
    const actionId = interaction.kind === 'form'
      ? action ?? interaction.request.actions[actionIndex]?.id ?? interaction.request.actions[0].id : undefined;
    if (actionId === 'cancel') {cancel(); return;}
    const value = interaction.kind === 'question' ? questionAnswers(questions, draftsRef.current)
      : {action: actionId!,
        values: Object.fromEntries(interaction.request.fields.map(field => [field.id,
          field.type === 'password' ? secrets.current[field.id] ?? '' : valuesRef.current[field.id]]))};
    flushSync(() => session.answerInteraction?.(interaction.id, value));
  }
  function cancel() {
    if (current()) flushSync(() => session.cancelInteraction?.(interaction.id));
  }

  useKeyboard(key => {
    if (key.defaultPrevented || !active()) return;
    if (key.meta && !key.ctrl && (key.name === 'return' || key.name === 'kpenter')) {
      key.preventDefault();
      if (!key.repeated) submit();
      return;
    }
    if (key.name === 'escape' && !key.meta && !key.ctrl) {key.preventDefault(); if (!key.repeated) cancel(); return;}
    if (key.name === 'pageup' || key.name === 'pagedown') {
      key.preventDefault(); scroller.current?.scrollBy(key.name === 'pageup' ? -1 : 1, 'viewport'); return;
    }
    if (key.ctrl && interaction.kind === 'question' && (key.name === 'n' || key.name === 'p')) {
      key.preventDefault(); changePage(page + (key.name === 'n' ? 1 : -1)); return;
    }
    if (key.ctrl || key.meta || key.super || key.hyper) return;
    if (key.name === 'tab') {
      key.preventDefault();
      flushSync(() => setTarget((target + (key.shift ? -1 : 1) + targets) % Math.max(1, targets)));
      return;
    }
    const textTarget = interaction.kind === 'question' ? custom && target === options.length
      : field && ['text', 'url', 'password'].includes(field.type);
    if (!textTarget && (key.name === 'up' || key.name === 'down')) {
      key.preventDefault(); flushSync(() => setTarget(Math.max(0, Math.min(targets - 1, target + (key.name === 'up' ? -1 : 1))))); return;
    }
    if (key.name === 'return' || key.name === 'kpenter' || key.name === 'space') {
      if (textTarget && key.name === 'space') return;
      key.preventDefault();
      if (key.repeated) return;
      if (interaction.kind === 'question' && target < options.length) choose(target);
      else if (interaction.kind === 'form' && target >= interaction.request.fields.length)
        submit(interaction.request.actions[target - interaction.request.fields.length]?.id);
      else if (interaction.kind === 'form') adjustField(1);
      return;
    }
    if (interaction.kind === 'form' && !textTarget && (key.name === 'left' || key.name === 'right')) {
      key.preventDefault(); adjustField(key.name === 'left' ? -1 : 1);
    }
  });

  const title = interaction.kind === 'form' ? interaction.request.title : interaction.request.title ?? 'Question';
  return <box flexDirection="column" flexGrow={editing ? 1 : 0} flexBasis={editing ? 0 : undefined}
    flexShrink={editing ? 1 : 0} minHeight={0} border borderStyle={chrome.borderStyle} borderColor={editing ? color.accent : color.running}
    title={' ' + (interaction.kind === 'form' ? 'Form' : 'Question') + ' · ' + display(title) + ' '} titleColor={color.running}>
    {!editing && <box flexDirection="row" flexWrap="wrap" columnGap={1} paddingX={1}>
      <text fg={color.muted} flexGrow={1} truncate>{interaction.kind === 'question' ? display(question?.question ?? title) : display(interaction.plugin)}</text>
      <Button label={interaction.kind === 'form' ? 'Edit form' : 'Edit answer'} isActive={current} onPress={() => {if (current()) setEditing(true);}} />
    </box>}
    <box visible={editing} flexGrow={1} flexBasis={0} minHeight={0} flexDirection="column">
      <scrollbox ref={scroller} flexGrow={1} flexBasis={0} minHeight={1} focusable={false} scrollX={false} scrollY
        contentOptions={{paddingX: 1, gap: 1}}>
        {interaction.kind === 'question' && question && <>
          <text fg={color.muted}>{`Question ${page + 1}/${questions.length}${question.header ? ' · ' + display(question.header) : ''}`}</text>
          <text fg={color.text} attributes={TextAttributes.BOLD} wrapMode="word">{display(question.question)}</text>
          {options.map((option, index) => {
            const label = typeof option === 'string' ? option : option.label;
            return <box key={label} id={'interaction-field-' + index} flexDirection="column" flexShrink={0}
              backgroundColor={target === index ? color.optionBackground : undefined}
              onMouseDown={event => {if (event.button === MouseButton.LEFT) choose(index);}}>
              <text selectable={false} fg={target === index ? color.actionText : color.text} wrapMode="word">
                {(draft.selected.includes(label) ? '[x] ' : '[ ] ') + display(label) + (typeof option !== 'string' && option.recommended ? ' (recommended)' : '')}
              </text>
              {typeof option !== 'string' && option.description && <text fg={color.muted} wrapMode="word">{display(option.description)}</text>}
            </box>;
          })}
          {custom && <box flexDirection="column" flexShrink={0}>
            <text fg={color.muted}>{options.length ? 'Other answer' : 'Your answer'}</text>
            <TextField key={question.id} id={'interaction-field-' + options.length} value={draft.text}
              focused={focused && editing && target === options.length} active={active}
              placeholder="Type an answer…" onFocus={() => {setEditing(true); flushSync(() => setTarget(options.length));}}
              onChange={text => flushSync(() => setDrafts(previous => ({...previous, [question.id]: {
                selected: question.multi ? questionDraft(previous, question.id).selected : [], text,
              }})))} />
          </box>}
        </>}
        {interaction.kind === 'form' && <>
          {interaction.request.description && <text fg={color.muted} wrapMode="word">{display(interaction.request.description)}</text>}
          {interaction.request.fields.map((item, index) => <box key={item.id} flexDirection="column" flexShrink={0}>
            <text fg={target === index ? color.actionText : color.text} attributes={TextAttributes.BOLD} wrapMode="word">
              {display(item.label) + (item.required ? ' *' : '')}
            </text>
            {['text', 'url', 'password'].includes(item.type)
              ? <TextField id={'interaction-field-' + index} value={item.type === 'password' ? '' : String(values[item.id] ?? '')}
                  focused={focused && editing && target === index} active={active} secret={item.type === 'password'}
                  placeholder={item.type === 'password' ? 'Password…' : item.type === 'url' ? 'https://…' : 'Text…'}
                  onFocus={() => {setEditing(true); flushSync(() => setTarget(index));}} onChange={value => formValue(item.id, value)} />
              : <box id={'interaction-field-' + index} height={1} backgroundColor={target === index ? color.actionBackground : color.panel}
                  onMouseDown={event => {
                    if (event.button !== MouseButton.LEFT || !current()) return;
                    setEditing(true); setTarget(index);
                    if (item.type === 'toggle') formValue(item.id, values[item.id] !== true);
                    else if (item.options?.length) {
                      const next = (item.options.findIndex(option => option.value === values[item.id]) + 1) % item.options.length;
                      formValue(item.id, item.options[next].value);
                    }
                  }}>
                  <text selectable={false} fg={color.text} truncate>{item.type === 'toggle'
                    ? (values[item.id] === true ? '[x] Enabled' : '[ ] Disabled')
                    : display(item.options?.find(option => option.value === values[item.id])?.label ?? '(choose)')}</text>
                </box>}
            {item.hint && <text fg={color.muted} wrapMode="word">{display(item.hint)}</text>}
          </box>)}
        </>}
      </scrollbox>
      {interaction.error && <text paddingX={1} fg={color.error} wrapMode="word">{display(interaction.error)}</text>}
      <box flexDirection="row" flexWrap="wrap" columnGap={1} paddingX={1} flexShrink={0}>
        {interaction.kind === 'question' && questions.length > 1 && <>
          <Button label="Back" isActive={active} disabled={page === 0} onPress={() => changePage(page - 1)} />
          <Button label="Next" isActive={active} disabled={page === questions.length - 1} onPress={() => changePage(page + 1)} />
        </>}
        {interaction.kind === 'question'
          ? <Button label="Submit" selected isActive={active} disabled={!session.answerInteraction} onPress={() => submit()} />
          : interaction.request.actions.map((action, index) => <Button key={action.id} label={display(action.label)}
              isActive={active} disabled={action.id === 'cancel' ? !session.cancelInteraction : !session.answerInteraction}
              selected={target === interaction.request.fields.length + index} onPress={() => submit(action.id)} />)}
        {(interaction.kind !== 'form' || !interaction.request.actions.some(action => action.id === 'cancel')) &&
          <Button label="Cancel" isActive={current} disabled={!session.cancelInteraction} onPress={cancel} />}
        {draftToggle&&<Button label="Draft" isActive={current} onPress={() => {if (current()) setEditing(false);}} />}
      </box>
      {presentation.hints&&<text height={1} truncate paddingX={1} fg={color.muted}>{width < 55 ? 'Tab fields · Alt+Enter ' + display(submitLabel) :
        'Tab fields · Space choose · Alt+Enter ' + display(submitLabel) + ' · Esc cancel'}</text>}
    </box>
  </box>;
}
