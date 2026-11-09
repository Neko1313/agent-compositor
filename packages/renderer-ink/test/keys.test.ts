import { describe, expect, it } from "vitest";
import { mapKey, mapInputs } from "../src/keys.js";

const k = (flags: Record<string, boolean>) => flags as never;

describe("mapKey", () => {
  it("printable input becomes text", () => {
    expect(mapKey("a", k({}))).toEqual({ kind: "text", text: "a" });
    expect(mapKey("hello", k({}))).toEqual({ kind: "text", text: "hello" });
  });

  it("named special keys", () => {
    expect(mapKey("", k({ return: true }))).toEqual({ kind: "key", key: "enter", modifiers: [] });
    expect(mapKey("", k({ escape: true }))).toEqual({ kind: "key", key: "escape", modifiers: [] });
    expect(mapKey("", k({ backspace: true }))).toEqual({ kind: "key", key: "backspace", modifiers: [] });
    expect(mapKey("", k({ delete: true }))).toEqual({ kind: "key", key: "delete", modifiers: [] });
    expect(mapKey("", k({ tab: true }))).toEqual({ kind: "key", key: "tab", modifiers: [] });
    expect(mapKey("", k({ upArrow: true }))).toEqual({ kind: "key", key: "up", modifiers: [] });
    expect(mapKey("", k({ downArrow: true }))).toEqual({ kind: "key", key: "down", modifiers: [] });
    expect(mapKey("", k({ leftArrow: true }))).toEqual({ kind: "key", key: "left", modifiers: [] });
    expect(mapKey("", k({ rightArrow: true }))).toEqual({ kind: "key", key: "right", modifiers: [] });
  });

  it("modifiers ride along", () => {
    expect(mapKey("c", k({ ctrl: true }))).toEqual({ kind: "key", key: "c", modifiers: ["ctrl"] });
    expect(mapKey("x", k({ meta: true }))).toEqual({ kind: "key", key: "x", modifiers: ["meta"] });
    expect(mapKey("A", k({ shift: true }))).toEqual({ kind: "text", text: "A" });
    expect(mapKey("?", k({ shift: true }))).toEqual({ kind: "text", text: "?" });
    expect(mapKey("A", k({ shift: true, meta: true }))).toEqual({ kind: "key", key: "A", modifiers: ["meta", "shift"] });
  });

  it("ctrl turns printable text into a key", () => {
    expect(mapKey("r", k({ ctrl: true }))).toEqual({ kind: "key", key: "r", modifiers: ["ctrl"] });
  });

  it("empty input with no flags yields nothing", () => {
    expect(mapKey("", k({}))).toBeUndefined();
  });
});

it("preserves typed text and controls coalesced in one stream chunk",()=>{expect(mapInputs("value\t\r",k({}))).toEqual([{kind:"text",text:"value"},{kind:"key",key:"tab"},{kind:"key",key:"enter"}]);expect(mapInputs("",k({tab:true}))).toEqual([{kind:"key",key:"tab",modifiers:[]}]);});

it('keeps Ctrl+J distinct from Enter when LF arrives alone or coalesced with text',()=>{
  expect(mapInputs('first\nsecond',k({}))).toEqual([{kind:'text',text:'first'},{kind:'key',key:'j',modifiers:['ctrl']},{kind:'text',text:'second'}]);
  expect(mapKey('\n',k({return:true}))).toEqual({kind:'key',key:'j',modifiers:['ctrl']});
  expect(mapKey('\r',k({return:true}))).toMatchObject({kind:'key',key:'enter'});
});
