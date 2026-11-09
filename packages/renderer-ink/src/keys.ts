import type { InputMessage } from "@agent-compositor/protocol";
import type { Key } from "ink";

export type InputData = InputMessage["data"];

const SPECIAL: [keyof Key, string][] = [
  ["upArrow", "up"],
  ["downArrow", "down"],
  ["leftArrow", "left"],
  ["rightArrow", "right"],
  ["pageUp", "pageup"],
  ["pageDown", "pagedown"],
  ["home", "home"],
  ["end", "end"],
];

/**
 * Ink keystroke → protocol input data.
 * Printable text without modifiers becomes { kind: "text" }; everything else
 * becomes a named key with modifiers. Returns undefined for pure modifier
 * presses (shift alone) — nothing to report.
 */
export function mapKey(input: string, key: Key): InputData | undefined {
  const modifiers: string[] = [];
  if (key.ctrl) modifiers.push("ctrl");
  if (key.meta) modifiers.push("meta");
  if (key.shift || (key.meta && /^[A-Z]$/.test(input))) modifiers.push("shift");

  if(input==="\n")return {kind:"key",key:"j",modifiers:["ctrl"]};
  if (key.return) return { kind: "key", key: "enter", modifiers };
  if (key.escape) return { kind: "key", key: "escape", modifiers };
  if (key.backspace) return { kind: "key", key: "backspace", modifiers };
  if (key.delete) return { kind: "key", key: "delete", modifiers };
  if (key.tab) return { kind: "key", key: "tab", modifiers };
  for (const [flag, name] of SPECIAL) {
    if (key[flag]) return { kind: "key", key: name, modifiers };
  }
  if (key.meta && "!@#$%^&*(".includes(input) && input.length === 1) {
    if (!modifiers.includes("shift")) modifiers.push("shift");
    return { kind: "key", key: String("!@#$%^&*(".indexOf(input) + 1), modifiers };
  }
  if (!input) return undefined;
  if (key.ctrl) return { kind: "key", key: input, modifiers };
  if (!key.meta && !key.ctrl) return { kind: "text", text: input };
  return { kind: "key", key: input, modifiers };
}

/** Preserve consecutive typed controls even when the stream coalesces them.
 * Bracketed paste is delivered separately through Ink's usePaste channel. */
export function mapInputs(input:string,key:Key):InputData[] {
  if(!key.ctrl&&!key.meta&&!key.escape&&/[\t\r\n\x01\x15\x7f]/.test(input)&&input.length>1){
    return input.split(/([\t\r\n\x01\x15\x7f])/).filter(Boolean).flatMap((part):InputData[]=>{
      if(part==='\t')return[{kind:'key' as const,key:'tab'}];
      if(part==='\r')return[{kind:'key' as const,key:'enter'}];
      if(part==='\n')return[{kind:'key' as const,key:'j',modifiers:['ctrl']}];
      if(part==='\x01'||part==='\x15')return[{kind:'key' as const,key:part==='\x01'?'a':'u',modifiers:['ctrl']}];
      if(part==='\x7f')return[{kind:'key' as const,key:'backspace'}];
      return[{kind:'text' as const,text:part}];
    });
  }
  const data=mapKey(input,key);return data?[data]:[];
}
