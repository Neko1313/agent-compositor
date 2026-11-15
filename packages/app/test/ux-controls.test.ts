import { describe, it, expect } from "vitest";
import { AgentCore, ScriptedProvider } from "@agent-compositor/core";
import { hello, type WireMessage } from "@agent-compositor/protocol";
import { AppUI } from "../src/ui.js";
import { ApprovalDialog } from "../src/approval.js";
function setup() {
  const ui = new AppUI(
    (onApproval, onAsk) =>
      new AgentCore({
        cwd: process.cwd(),
        provider: new ScriptedProvider([]),
        onApproval,
        onAsk,
      }),
  );
  const renders = new Map<string, string>();
  const titles = new Map<string, string>();
  const grids = new Map<string, any>();
  ui.connect((m) => {
    if (m.type === "render") {
      renders.set(
        m.surface,
        m.grid?.map((row) => row.map((c) => c.ch).join("")).join("\n") ?? "",
      );
      grids.set(m.surface, m.grid);
    }
    if (m.type === "declare")
      for (const s of m.surfaces) titles.set(s.id, s.title ?? "");
  });
  ui.receive(
    hello("renderer", {
      surfaces: ["terminal"],
      sites: [],
      elements: ["Text", "Layout"],
      encodings: ["jsonl"],
    }),
  );
  ui.resize(80, 24);
  const input = (data: Extract<WireMessage, { type: "input" }>["data"]) =>
    ui.receive({ type: "input", surface: "input", data });
  return {
    ui,
    renders,
    titles,
    grids,
    key: (key: string, modifiers?: string[]) =>
      input({ kind: "key", key, modifiers }),
    text: (text: string) => input({ kind: "text", text }),
  };
}
describe("reviewable action approvals", () => {
  it("keeps tool, leading command and choices visible and scrolls every argument", () => {
    const command =
      "first-target " +
      Array.from({ length: 80 }, (_, i) => `argument-${i}`).join(" ") +
      " final-target";
    const d = new ApprovalDialog({
      tool: "exec",
      descriptor: { tool: "exec", command: ["sh", "-c", command] },
      reason: "Review the concrete command",
    });
    const initial = d
      .visible(42, 10)
      .map((r) => r.text)
      .join("\n");
    expect(initial).toContain("Tool: exec");
    expect(initial).toContain("first-target");
    expect(initial).toContain("Y allow once");
    expect(initial).toContain("P allow for project");
    d.handle({ kind: "key", key: "end" });
    const last = d
      .visible(42, 10)
      .map((r) => r.text)
      .join("\n");
    expect(last).toContain("Tool: exec");
    expect(last).toContain("final-target");
    expect(last).toContain("Review the concrete command");
    expect(last).toContain("N deny");
  });
  it("defaults Enter to denial and explicitly distinguishes every approval scope", () => {
    const request = {
      tool: "write",
      descriptor: { tool: "write", path: "file.txt" },
    };
    expect(
      new ApprovalDialog(request).handle({ kind: "key", key: "enter" }),
    ).toEqual({ allow: false, scope: "once" });
    for (const [key, scope] of [
      ["y", "once"],
      ["a", "session"],
      ["p", "project"],
    ] as const)
      expect(
        new ApprovalDialog(request).handle({ kind: "text", text: key }),
      ).toEqual({ allow: true, scope });
    const dialog = new ApprovalDialog(request);
    const rows = dialog.visible(60, 12),
      row = rows.findIndex((r) => r.text.includes("Y allow once"));
    expect(dialog.interactiveRow(row)).toBe(true);
    expect(
      dialog.handle({
        kind: "mouse",
        row,
        col: 2,
        action: "press",
        button: "left",
      }),
    ).toEqual({ allow: true, scope: "once" });
  });
  it("names the active interaction and does not offer queue/steer while waiting", async () => {
    const { ui, renders, titles, key } = setup();
    const answer = (ui as any).requestApproval({
      tool: "exec",
      descriptor: {
        command: [
          "sh",
          "-c",
          "review '**literal**' `exact` " + "more ".repeat(100),
        ],
      },
      reason: "Scope needs approval",
    });
    expect(titles.get("input")).toBe("Approval required");
    expect(renders.get("input")).toContain("Tool: exec");
    expect(renders.get("input")).toContain("'**literal**' `exact`");
    expect(renders.get("status")).toContain("Approval needed");
    expect(renders.get("status")).not.toContain("Enter queue");
    key("escape");
    expect(await answer).toEqual({ allow: false, scope: "once" });
    expect(titles.get("input")).toBe("Message");
    ui.close();
  });
});
describe("plugin action navigation", () => {
  it("reaches offscreen actions once per semantic action and brings focus into view", async () => {
    const { ui, renders, key } = setup();
    const pressed: string[] = [];
    ui.core.host.registerPlugin(
      { name: "actions", version: "1.0.0", trust: "trusted" },
      {
        "ui.press": (e) => {
          pressed.push(e.key);
        },
        "ui.render": (e) =>
          e.site === "plugin:actions/list"
            ? { tree: { lines: e.props.lines } }
            : undefined,
      },
    );
    await ui.core.host.emit("service.ui.view", {
      plugin: "actions",
      id: "list",
      title: "Actions",
      view: {
        lines: Array.from({ length: 18 }, (_, i) => ({
          text: `Action ${i} with a long wrapped label`,
          action: `a${i}`,
        })),
      },
      placement: { site: "sidebar", size: 0.4, focus: true },
    });
    await ui.settled();
    expect(renders.get("status")).toContain("actions");
    expect(renders.get("plugin-actions-list")).toContain("PgUp/PgDn");
    for (let i = 0; i < 18; i++) key("down");
    expect(renders.get("plugin-actions-list")).toContain("Action 17");
    key("enter");
    await ui.settled();
    expect(pressed).toEqual(["a17"]);
    key("up");
    key("enter");
    await ui.settled();
    expect(pressed.at(-1)).toBe("a16");
    ui.close();
  });
  it("does not expose toolbar hitboxes when their labels cannot fit", () => {
    const { ui, renders } = setup();
    ui.resize(24, 24);
    expect(renders.get("status")).not.toContain("[Plugins]");
    ui.receive({
      type: "input",
      surface: "status",
      data: {
        kind: "mouse",
        row: 22,
        col: 16,
        button: "left",
        action: "press",
      },
    });
    expect(renders.has("plugin-placement")).toBe(false);
    ui.close();
  });
  it('waits for the latest plugin field edit before its explicit Enter action',async()=>{
    const {ui,text,key}=setup();let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let value='',submitted:string|undefined,submissions=0;
    ui.core.host.registerPlugin({name:'submit-proof',version:'1.0.0',trust:'trusted'},{
      'ui.change':async event=>{if(event.site!=='plugin-submit-proof-main')return;if(event.value==='first')await gate;value=event.value;},
      'ui.press':event=>{if(event.site==='plugin-submit-proof-main'&&event.key==='send'){submitted=value;submissions++;}},
    });
    try{
      await ui.core.host.emit('service.ui.view',{plugin:'submit-proof',id:'main',title:'Submit',view:{input:{id:'reply',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]},placement:{site:'sidebar',size:.75,focus:true}});
      text('first');text(' latest');key('enter');key('enter');await new Promise(resolve=>setImmediate(resolve));expect(submitted).toBeUndefined();
      release();await ui.settled();expect(submitted).toBe('first latest');expect(submissions).toBe(1);
    }finally{release();ui.close();}
  });
  it('keeps edits typed after Enter out of the earlier delayed submission',async()=>{
    const {ui,text,key}=setup();let releaseChange!:()=>void,releaseSubmit!:()=>void,pressStarted!:()=>void;
    const changeGate=new Promise<void>(resolve=>{releaseChange=resolve;}),submitGate=new Promise<void>(resolve=>{releaseSubmit=resolve;}),entered=new Promise<void>(resolve=>{pressStarted=resolve;});
    let value='',submitted:string|undefined;
    ui.core.host.registerPlugin({name:'ordered-submit',version:'1.0.0',trust:'trusted'},{
      'ui.change':async event=>{if(event.site!=='plugin-ordered-submit-main')return;if(event.value==='first')await changeGate;value=event.value;},
      'ui.press':async event=>{if(event.site==='plugin-ordered-submit-main'&&event.key==='send'){pressStarted();await submitGate;submitted=value;}},
    });
    try{
      await ui.core.host.emit('service.ui.view',{plugin:'ordered-submit',id:'main',title:'Submit',view:{input:{id:'reply',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]},placement:{site:'sidebar',size:.75,focus:true}});
      text('first');key('enter');text(' second');releaseChange();await entered;await new Promise(resolve=>setImmediate(resolve));expect(value).toBe('first');
      releaseSubmit();await ui.settled();expect(submitted).toBe('first');expect(value).toBe('first second');
    }finally{releaseChange();releaseSubmit();ui.close();}
  });
  it('retains edits typed after Enter when the submitted field is replaced',async()=>{
    const {ui,text,key,renders}=setup();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});let value='';
    ui.core.host.registerPlugin({name:'replace-submit',version:'1.0.0',trust:'trusted'},{
      'ui.change':event=>{if(event.site==='plugin-replace-submit-main')value=event.value;},
      'ui.press':async(event,$)=>{if(event.site==='plugin-replace-submit-main'&&event.key==='send'){started();await gate;await $.ui.view('main','Submit',{input:{id:'next',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]});}},
    });
    try{
      await ui.core.host.emit('service.ui.view',{plugin:'replace-submit',id:'main',title:'Submit',view:{input:{id:'first',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]},placement:{site:'sidebar',size:.75,focus:true}});
      text('first');key('enter');await entered;text(' second');release();await ui.settled();
      expect(renders.get('plugin-replace-submit-main')).toContain('first second');expect(value).toBe('first second');
    }finally{release();ui.close();}
  });
  it.each(['field','surface','action'])('retains later input when the submitted %s changes',async removed=>{
    const {ui,text,key,renders}=setup();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});let value='';
    ui.core.host.registerPlugin({name:'missing-input',version:'1.0.0',trust:'trusted'},{
      'ui.change':event=>{if(event.site==='plugin-missing-input-main')value=event.value;},
      'ui.press':async(event,$)=>{if(event.site==='plugin-missing-input-main'&&event.key==='send'){started();await gate;if(removed==='surface')await $.ui.remove('main');else if(removed==='action')await $.ui.view('main','Waiting',{input:{id:'first',value:'SERVER',submitAction:'other'},lines:[{text:'Other',action:'other'}]});else await $.ui.view('main','Waiting',{lines:[{text:'Waiting'}]});}},
    });
    const view=(id:string)=>({input:{id,value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]});
    try{await ui.core.host.emit('service.ui.view',{plugin:'missing-input',id:'main',title:'Submit',view:view('first'),placement:{site:'sidebar',size:.75,focus:true}});
      text('first');key('enter');await entered;text(' later');release();await ui.settled();expect(value).toBe('first');if(removed==='field')expect(renders.get('plugin-missing-input-main')).toContain('Waiting for an input to restore');
      await ui.core.host.emit('service.ui.view',{plugin:'missing-input',id:'main',title:'Return',view:view('next'),placement:{site:'sidebar',size:.75,focus:true}});key('r',['ctrl']);await ui.settled();expect(value).toBe('first later');
    }finally{release();ui.close();}
  });
  it('does not overwrite a nonempty replacement field with later queued edits',async()=>{
    const {ui,text,key,renders}=setup();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});let value='',failRecovery=true;const renderEvents:string[]=[];
    ui.core.host.registerPlugin({name:'render-spy',version:'1.0.0',trust:'trusted'},{'ui.render':event=>{renderEvents.push(JSON.stringify(event));return {tree:{lines:[{text:'RENDER_OVERRIDE'}]}};}});
    ui.core.host.registerPlugin({name:'replace-protected',version:'1.0.0',trust:'trusted'},{
      'ui.change':event=>{if(event.site==='plugin-replace-protected-main'){if(event.id==='next'&&failRecovery)throw Error('temporary failure');value=event.value;}},
      'ui.press':async(event,$)=>{if(event.site==='plugin-replace-protected-main'&&event.key==='send'){started();await gate;await $.ui.view('main','Submit',{input:{id:'next',value:'SERVER_VALUE',submitAction:'send'},lines:[{text:'Send',action:'send'}]});}},
    });
    try{
      await ui.core.host.emit('service.ui.view',{plugin:'replace-protected',id:'main',title:'Submit',view:{input:{id:'first',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]},placement:{site:'sidebar',size:.75,focus:true}});
      text('first');key('enter');await entered;text(' second');release();await ui.settled();
      expect(renders.get('plugin-replace-protected-main')).toContain('SERVER_VALUE');expect(value).toBe('first');expect(renders.get('plugin-replace-protected-main')).toContain('Restore queued input');expect(renderEvents.join('')).not.toContain('first second');
      key('r',['ctrl']);await ui.settled();expect(value).toBe('first');expect(renders.get('plugin-replace-protected-main')).toContain('SERVER_VALUE');expect(renders.get('plugin-replace-protected-main')).toContain('Restore queued input');
      failRecovery=false;key('r',['ctrl']);await ui.settled();expect(value).toBe('first second');expect(renders.get('plugin-replace-protected-main')).toContain('first second');
      expect(renders.get('plugin-replace-protected-main')).not.toContain('Restore queued input');
    }finally{release();ui.close();}
  });
  it('discards a retained conflict only after an explicit action',async()=>{
    const {ui,text,key,renders}=setup();let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{started=resolve;});let value='';
    ui.core.host.registerPlugin({name:'discard-proof',version:'1.0.0',trust:'trusted'},{
      'ui.change':event=>{if(event.site==='plugin-discard-proof-main')value=event.value;},
      'ui.press':async(event,$)=>{if(event.site==='plugin-discard-proof-main'&&event.key==='send'){started();await gate;await $.ui.view('main','Submit',{input:{id:'next',value:'SERVER',submitAction:'send'},lines:[{text:'Send',action:'send'}]});}},
    });
    try{
      await ui.core.host.emit('service.ui.view',{plugin:'discard-proof',id:'main',title:'Submit',view:{input:{id:'first',value:'',submitAction:'send'},lines:[{text:'Send',action:'send'}]},placement:{site:'sidebar',size:.75,focus:true}});
      text('first');key('enter');await entered;text(' later');release();await ui.settled();expect(renders.get('plugin-discard-proof-main')).toContain('Discard queued input');
      key('d',['ctrl']);await ui.settled();expect(renders.get('plugin-discard-proof-main')).toContain('SERVER');expect(renders.get('plugin-discard-proof-main')).not.toContain('Discard queued input');expect(value).toBe('first');
    }finally{release();ui.close();}
  });
  it('keeps the search label and literal characters visible in a narrow plugin pane',async()=>{
    const {ui,renders,text}=setup();ui.resize(60,24);
    await ui.core.host.emit('service.ui.view',{plugin:'search',id:'list',title:'Search',view:{input:{id:'search',value:'',placeholder:'Title, ID or conversation text'},lines:[{text:'Results'}]},placement:{site:'sidebar',size:.75,focus:true}});
    expect(renders.get('plugin-search-list')).toContain('Search: Title, ID');text('**literal**');await ui.settled();expect(renders.get('plugin-search-list')).toContain('Search: **literal**');ui.close();
  });
  it("keeps contextual hints at narrow widths and honors plugin field labels/hints", async () => {
    const { ui, renders, text, key } = setup();
    ui.resize(60, 24);
    await ui.core.host.emit("service.ui.view", {
      plugin: "filter",
      id: "input",
      title: "Filter",
      view: {
        input: { id: "filter", value: "", label: "Find", placeholder: "Items" },
        hint: "Type to filter · Esc leave",
        lines: [{ text: "Choose a result", action: "choose" }],
      },
      placement: { site: "sidebar", size: 0.7, focus: true },
    });
    text("item");
    await ui.settled();
    expect(renders.get("plugin-filter-input")).toContain("Find: item");
    expect(renders.get("status")).toContain("Type to filter");
    key("escape");
    ui.close();
  });
});
