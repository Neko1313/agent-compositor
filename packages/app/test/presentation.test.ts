import { describe, expect, it } from "vitest";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { hello, type WireMessage } from "@agent-compositor/protocol";
import { uiAppearanceSchema, uiTextViewSchema } from "@agent-compositor/events";
import themeHooks from "../../../plugins/ui-theme/hooks.js";
import { AppUI } from "../src/ui.js";
import { appearanceFrom, clean, gridFrom, transcriptRows, wrap, textRows } from "../src/presentation.js";

function setup(provider = new ScriptedProvider([])) {
  const ui = new AppUI(approve => new AgentCore({ cwd: process.cwd(), provider, onApproval: approve }));
  const messages: WireMessage[] = [];
  ui.connect(message => messages.push(message));
  ui.receive(hello("renderer", { surfaces: ["terminal"], sites: [], elements: ["Layout", "Text"], encodings: ["jsonl"] }));
  const latest = (surface: string) => messages.filter(m => m.type === "render" && m.surface === surface).at(-1);
  const text = (surface: string) => { const m = latest(surface); return m?.type === "render" ? m.grid?.map(row => row.map(c => c.ch).join("")).join("\n") : ""; };
  return { ui, messages, latest, text };
}
const manifest = (name: string) => ({ name, version: "1.0.0", trust: "trusted" as const });

describe("pluggable presentation", () => {
  it("starts with a readable conversation and no empty tools pane", () => {
    const { ui, text } = setup();
    expect(ui.windows.ids()).toEqual(["session"]);
    expect(text("session")).toContain("What would you like");
    ui.close();
  });
  it("merges independent plugin fields, replaces contributions and removes them on unload", async () => {
    const { ui, messages, latest } = setup();
    ui.core.host.registerPlugin(manifest("theme"), {});
    await ui.core.host.emit("service.ui.configure", { plugin: "theme", appearance: { colors: { accent: "#ffeeaa" }, chrome: { borderStyle: "round" } } });
    await ui.core.host.emit("service.ui.configure", { plugin: "second", appearance: { colors: { success: "#aabbcc" } } });
    expect(messages.filter(m => m.type === "layout").at(-1)?.frames[0].chrome).toMatchObject({ accent: "#ffeeaa", borderStyle: "round" });
    await ui.core.host.emit("service.ui.configure", { plugin: "theme", appearance: { colors: { accent: "#ffffff" } } });
    expect(messages.filter(m => m.type === "layout").at(-1)?.frames[0].chrome?.borderStyle).toBe("single");
    ui.core.host.unregisterPlugin("theme");
    expect(messages.filter(m => m.type === "layout").at(-1)?.frames[0].chrome?.accent).toBe(appearanceFrom([]).colors.accent);
    expect(latest("input")?.type).toBe("render");
    await expect(ui.core.host.emit("service.ui.configure", { appearance: { colors: { text: "\x1b[31m" } } })).rejects.toThrow();
    ui.close();
  });
  it("replaces a named view, sanitizes plugin output and restores the default on unload", async () => {
    const { ui, text } = setup();
    let content = "Custom conversation\x1b[31m";
    ui.core.host.registerPlugin(manifest("view"), { "ui.render": event => event.site === "conversation" ? { tree: { lines: [{ text: content, tone: "accent" }] } } : undefined });
    ui.resize(100, 30); await ui.settled();
    expect(text("session")).toBe("Custom conversation");
    content = "Updated view";
    await ui.core.host.emit("ui.invalidate", { site: "conversation" }); await ui.settled();
    expect(text("session")).toBe("Updated view");
    ui.core.host.unregisterPlugin("view"); await ui.settled();
    expect(text("session")).toContain("What would you like"); ui.close();
  });
  it("keeps multiline drafts intact and restores the unsent draft after browsing history", async () => {
    const provider = new ScriptedProvider([{ text: "done" }]);
    const { ui, text } = setup(provider);
    const input = (value: string) => ui.receive({ type: "input", surface: "input", data: { kind: "text", text: value } });
    const key = (key: string, modifiers: string[] = []) => ui.receive({ type: "input", surface: "input", data: { kind: "key", key, modifiers } });
    input("first line"); key("j", ["ctrl"]); input("second line");
    expect(text("input")).toContain("first line\nsecond line");
    expect(provider.requests).toHaveLength(0);
    key("enter"); await ui.settled();
    expect(provider.requests[0].messages[0].content).toBe("first line\nsecond line");
    input("unsent draft"); key("up"); expect(text("input")).toContain("second line");
    key("down"); expect(text("input")).toContain("unsent draft"); ui.close();
  });
  it("discards stale async view responses and keeps the default for invalid answers", async () => {
    const { ui, text } = setup();
    let release!: (value: unknown) => void;
    ui.core.host.registerPlugin(manifest("slow"), { "ui.render": event => {
      if (event.site !== "conversation") return;
      if (event.viewport.columns > 90) return new Promise(resolve => { release = resolve; });
      return { tree: { lines: [{ text: "Current width" }] } };
    } });
    ui.resize(100, 30);
    for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
    ui.resize(70, 24); release({ tree: { lines: [{ text: "Stale width" }] } }); await ui.settled();
    expect(text("session")).toBe("Current width");
    ui.core.host.unregisterPlugin("slow");
    ui.core.host.registerPlugin(manifest("bad"), { "ui.render": () => ({ tree: { lines: "invalid" } }) });
    ui.resize(80, 24); await ui.settled();
    expect(text("session")).toContain("What would you like"); ui.close();
  });
  it("wraps by words and summarizes tool arguments unless details are enabled", () => {
    expect(wrap("Verify drag and persistence", 20)).toEqual(["Verify drag and", "persistence"]);
    expect(clean("safe\x1b]22;pointer\x07 text\x1b[31m")).toBe("safe text");
    const blocks = [{ kind: "tool" as const, tool: "read", text: "src/app.ts", state: "done" as const, args: '{"path":"src/app.ts"}' }];
    expect(transcriptRows(blocks, 80, appearanceFrom([])).map(r => r.text).join("\n")).not.toContain('"path"');
    expect(transcriptRows(blocks, 80, appearanceFrom([{ presentation: { toolDetails: true } }])).map(r => r.text).join("\n")).toContain('"path"');
  });
});

it('parses Markdown before wrapping and preserves emphasis, lists, quotes, links and literal code',()=>{
  const theme=appearanceFrom([]),render=(text:string,width=22)=>transcriptRows([{kind:'assistant',text}],width,theme);
  const rows=render('## Heading\n\n**A long bold phrase that crosses the viewport boundary**\n\n*italic* [docs](https://example.com)\n\n- first\n- second\n\n> quoted\n\n```ts\nconst s = "**literal**";\n```');
  const body=rows.map(r=>r.text).join('\n');expect(body).not.toContain('##');expect(body).not.toContain('**A long');expect(body).toContain('• first');expect(body).toContain('│ quoted');expect(body).toContain('**literal**');
  expect(rows.filter(r=>r.cells?.some(c=>c.ch==='A')).some(r=>r.cells?.find(c=>c.ch==='A')?.bold)).toBe(true);
  expect(rows.some(r=>r.cells?.some(c=>c.italic))).toBe(true);expect(rows.some(r=>r.cells?.some(c=>c.underline))).toBe(true);
  expect(render('**partial stream').map(r=>r.text).join('')).toContain('partial stream');
});
it('renders tables within a narrow viewport and sanitizes control sequences in Markdown',()=>{
  const rows=transcriptRows([{kind:'assistant',text:'| Name | Result |\n| --- | --- |\n| module | **passed** |\n\nText \x1b]22;pointer\x07 safe'}],24,appearanceFrom([]));
  const body=rows.map(r=>r.text).join('\n');expect(body).toContain('Name');expect(body).toContain('passed');expect(body).not.toContain('**');expect(body).not.toContain('\x1b');expect(rows.every(r=>Array.from(r.text).length<=24)).toBe(true);
});


it('uses a readable selection foreground for muted actions and preserves Markdown cell styles',()=>{
  const base=appearanceFrom([]);
  const action={text:'Close',tone:'muted' as const,selected:true};
  const selected=gridFrom([action],base,20)[0];
  expect(selected.every(cell=>cell.fg===base.colors.selectionText&&cell.bg===base.colors.selectionBackground)).toBe(true);
  expect(selected[0].fg).not.toBe(selected[0].bg);
  const custom=appearanceFrom([{colors:{selectionText:'#ffeedd',selectionBackground:'#123456'}}]);
  const rich={text:'link',selected:true,cells:[{ch:'x',fg:'#ff0000',bold:true,underline:true}]};
  expect(gridFrom([rich],custom,20)[0][0]).toEqual({ch:'x',fg:'#ffeedd',bg:'#123456',bold:true,underline:true});
  expect(gridFrom([{...rich,selected:false}],custom,20)[0][0].fg).toBe('#ff0000');
});
it('keeps monochrome selected text distinct from its background',async()=>{
  let appearance:any;
  const $:any={state:{set:()=>{},get:()=> 'mono'},ui:{configure:async(value:any)=>{appearance=value;},notify:async()=>{}},fs:{write:async()=>{}}};
  await themeHooks['prompt.submit']({text:'/theme mono'},$);
  const theme=appearanceFrom([appearance]);
  expect(theme.colors.muted).toBe('#b8b8b8');
  expect(gridFrom([{text:'Action',tone:'muted',selected:true}],theme,20)[0][0]).toMatchObject({fg:'#101010',bg:'#b8b8b8'});
});
it('accepts optional plugin hints and input labels without changing legacy view validity',()=>{
  const legacy={lines:[{text:'Browse'}],input:{id:'search',value:''}};
  expect(uiTextViewSchema.parse(legacy)).toEqual(legacy);
  expect(uiTextViewSchema.parse({...legacy,hint:'Enter opens the selected item',input:{...legacy.input,label:'Filter'}}).hint).toContain('Enter');
  expect(uiTextViewSchema.safeParse({...legacy,hint:'x'.repeat(201)}).success).toBe(false);
  expect(uiTextViewSchema.safeParse({...legacy,input:{...legacy.input,label:'x'.repeat(61)}}).success).toBe(false);
  expect(uiAppearanceSchema.parse({colors:{selectionText:'black'}})).toEqual({colors:{selectionText:'black'}});
});

it('keeps whole task words in narrow columns instead of preferring a half-width hard break',()=>{
 const rows=textRows('[ ] Build interactive UI',20);expect(rows.map(r=>r.text)).toEqual(['[ ] Build','    interactive UI']);
 expect(rows.map(r=>r.text.trim()).join(' ')).toBe('[ ] Build interactive UI');
 expect(wrap('    identifierWithoutSpaces',12).every(line=>line.length<=12)).toBe(true);
});
