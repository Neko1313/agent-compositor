import { describe, it, expect, vi } from "vitest";
import { UiControllerRegistry, type UiControllerFactory } from "../src/controllers.js";
import { Runtime } from "@agent-compositor/runtime";
import { HooksHost } from "../src/hooks.js";

const fallback:UiControllerFactory=()=>({render:()=>({lines:[{text:"host"}]}),handle:()=>undefined,snapshot:()=>({text:"",cursor:0})});
describe("private UI controller lifetime",()=>{
  it("sends private state only to the selected owner and validates synchronous views",()=>{
    const registry=new UiControllerRegistry({editor:"chosen"});
    const factory=vi.fn(fallback),other=vi.fn(fallback);
    registry.register("other",{editor:other},new AbortController().signal);
    registry.register("chosen",{editor:factory},new AbortController().signal);
    const lease=registry.create("editor",{secret:"private draft"},fallback,()=>{},{text:"saved",cursor:5});
    expect(factory.mock.calls[0][0]).toMatchObject({kind:"editor",data:{secret:"private draft"},state:{text:"saved",cursor:5}});
    expect(other).not.toHaveBeenCalled();expect(lease.render(40,4).lines[0].text).toBe("host");
    registry.register("chosen",{editor:()=>({...fallback({kind:"editor",data:null},{signal:new AbortController().signal,invalidate:()=>{}}),render:()=>Promise.resolve({lines:[]}) as any})},new AbortController().signal);
    expect(()=>registry.create("editor",null,fallback,()=>{}).render(40,4)).toThrow("synchronous");
    lease.dispose();
  });

  it("serializes extension input, cancels uncooperative handlers and disposes exactly once",async()=>{
    const owner=new AbortController(),dispose=vi.fn(),handled:string[]=[];
    let finish!:(value:unknown)=>void;
    const registry=new UiControllerRegistry({form:"chosen"});
    registry.register("chosen",{form:()=>({render:()=>({lines:[]}),dispose,
      handle:input=>{handled.push(input.kind);return new Promise(resolve=>{finish=resolve;});}})},owner.signal);
    const lease=registry.create("form",null,fallback,()=>{});
    const first=lease.handle({kind:"text",text:"private"}) as Promise<unknown>;
    const second=lease.handle({kind:"key",key:"enter"}) as Promise<unknown>;
    const rejected=Promise.allSettled([first,second]);owner.abort(new Error("unloaded"));
    expect((await rejected).every(result=>result.status==="rejected")).toBe(true);
    finish({action:"save",values:{secret:"late"}});await Promise.resolve();lease.dispose();
    expect(handled).toEqual(["text"]);expect(dispose).toHaveBeenCalledTimes(1);
    expect(()=>lease.render(30,4)).toThrow("unloaded");
  });

  it("never falls back from a missing selection and revokes requester-owned default controllers",async()=>{
    const registry=new UiControllerRegistry({approval:"missing"});
    expect(()=>registry.create("approval",null,fallback,()=>{})).toThrow("unavailable");
    const host=new HooksHost(new Runtime(),{session:{id:"test",cwd:"/tmp"}});let lease:any;
    host.registerPlugin({name:"requester",version:"1.0.0",trust:"trusted"},{"prompt.submit":(_,$)=>{lease=$.ui.controller("form",{},fallback,()=>{});}});
    await host.emit("prompt.submit",{text:"open"});host.unregisterPlugin("requester");
    expect(lease.signal.aborted).toBe(true);
  });

  it("disposes a controller whose owner is revoked reentrantly during its factory without retaining the dead lease",()=>{
    const owner=new AbortController(),dispose=vi.fn(),registry=new UiControllerRegistry({form:"chosen"});
    registry.register("chosen",{form:()=>{
      owner.abort(new Error("Owner unloaded during creation"));
      return{render:()=>({lines:[{text:"Must not render"}]}),handle:()=>({action:"save"}),dispose};
    }},owner.signal);
    const lease=registry.create("form",{private:"factory request"},fallback,()=>{});
    expect(lease.signal.aborted).toBe(true);expect(dispose).toHaveBeenCalledTimes(1);
    expect(()=>lease.render(30,4)).toThrow("Owner unloaded during creation");
    expect(()=>lease.handle({kind:"key",key:"enter"})).toThrow("Owner unloaded during creation");
    const disposeLease=vi.spyOn(lease,"dispose");registry.disposeAll();
    expect(disposeLease).not.toHaveBeenCalled();expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("forbids effects through callbacks retained by another controller owner during rendering",async()=>{
    const host=new HooksHost(new Runtime(),{session:{id:"test",cwd:"/tmp"},uiControllers:{history:"renderer"}});let lease:any;let mutate!:()=>void;
    host.registerPlugin({name:"requester",version:"1.0.0",trust:"trusted"},{"prompt.submit":(_,$)=>{
      mutate=()=>$.state.set("bad",true);lease=$.ui.controller("history",{mutate},fallback,()=>{});
    }});
    host.registerPlugin({name:"renderer",version:"1.0.0",trust:"trusted"},{},"user",[],{history:request=>({render:()=>{(request.data as any).mutate();return{lines:[]};},handle:()=>{}})});
    await host.emit("prompt.submit",{text:"open"});
    expect(()=>lease.render(30,4)).toThrow("during ui.render");
  });
});
