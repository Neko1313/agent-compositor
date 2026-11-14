import {uiAppearanceSchema,type UiAppearance} from '@agent-compositor/events';

/** Native defaults remain independent of another frontend's presentation. */
export const color = {
  background: '#171a20',
  panel: '#22272f',
  text: '#e6e9ed',
  muted: '#a8b2bd',
  accent: '#a6dfd4',
  rule: '#49545e',
  running: '#eac280',
  error: '#ffa7a0',
  success: '#a6dfd4',
  titleBackground: '#171a20',
  selectionBackground: '#a6dfd4',
  selectionText: '#171a20',
  actionBackground: '#49545e',
  actionText: '#a6dfd4',
  optionBackground: '#22272f',
};

/** Portable Ink names differ from the native parser's bright-color spelling. */
export function nativeColor(value:string):string {
  return value.endsWith('Bright')?'bright'+value.slice(0,-6).toLowerCase():value;
}

/** Labels are literal decoration, never terminal control or bidirectional markup. */
export function appearanceText(value:string,multiline=false):string {
  return value.replace(/[\p{Cc}\p{Bidi_Control}\p{Zl}\p{Zp}]/gu,point=>
    multiline&&point==='\n'?'\n':'\\u'+point.charCodeAt(0).toString(16).padStart(4,'0'));
}

export function resolveAppearance(value:UiAppearance={}) {
  const parsed=uiAppearanceSchema.safeParse(value),patch=parsed.success?parsed.data:{};
  const resolved={...color};
  const names={text:'text',muted:'muted',accent:'accent',success:'success',warning:'running',danger:'error',border:'rule',
    titleBackground:'titleBackground',selectionBackground:'selectionBackground',selectionText:'selectionText'} as const;
  for(const[name,target]of Object.entries(names)){
    const supplied=patch.colors?.[name as keyof typeof names];
    if(supplied!==undefined)resolved[target]=nativeColor(supplied);
  }
  if(patch.colors?.selectionBackground!==undefined){
    resolved.actionBackground=resolved.selectionBackground;resolved.optionBackground=resolved.selectionBackground;
  }
  if(patch.colors?.selectionText!==undefined)resolved.actionText=resolved.selectionText;
  return Object.freeze({
    color:Object.freeze(resolved),
    tones:Object.freeze({text:resolved.text,muted:resolved.muted,accent:resolved.accent,success:resolved.success,warning:resolved.running,danger:resolved.error}),
    chrome:Object.freeze({borderStyle:patch.chrome?.borderStyle==='round'?'rounded' as const:patch.chrome?.borderStyle??'single',controls:patch.chrome?.controls??'focus'}),
    presentation:Object.freeze({userLabel:appearanceText(patch.presentation?.userLabel??'You'),
      agentLabel:patch.presentation?.agentLabel===undefined?undefined:appearanceText(patch.presentation.agentLabel),
      welcome:appearanceText(patch.presentation?.welcome??'No messages yet',true),
      toolDetails:patch.presentation?.toolDetails??false,hints:patch.presentation?.hints??true,showTools:patch.presentation?.showTools??false}),
    customText:patch.colors?.text!==undefined,
  });
}
export type ResolvedAppearance=ReturnType<typeof resolveAppearance>;
