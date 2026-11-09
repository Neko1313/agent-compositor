import { Timeline } from "./timeline.js";
import { Activity } from "./activity.js";
import { AnimationPack, states, type Config, type State, type AnimationFrames } from "./animations.js";
const FILE = ".agent-compositor/mascot.json";
const instances = new Map<string, Companion>();
const labels: Record<State, string> = {
  idle: "Ready",
  thinking: "Thinking",
  searching: "Searching",
  editing: "Editing",
  planning: "Planning",
  waiting_subagents: "Waiting for agents",
  question: "Your answer?",
  approval: "Approval needed",
  done: "Done!",
  error: "Something went wrong",
};
class Companion {
  config: Config = {};
  activity = new Activity();
  visible = false;
  motion = true;
  imageVisible=false;
  attached = true;
  disposed = false;
  pack!:AnimationPack;
  timeline=new Timeline();
  state: State = "idle";
  revision = 0;
  timer?: ReturnType<typeof setTimeout>;
  warned = new Set<string>();
  constructor(public $: any) {}
  async init() {
    try {
      const value = this.$.storage?.config
        ? await this.$.storage.config("mascot.json")
        : JSON.parse(await this.$.fs.read(FILE));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw Error("Expected object");
      for (const flag of ["enabled", "paused", "restoreInk"])
        if (value[flag] !== undefined && typeof value[flag] !== "boolean")
          throw Error(`Invalid ${flag}`);
      if (value.pack !== undefined && typeof value.pack !== "string")
        throw Error("Invalid pack path");
      if (
        value.animations !== undefined &&
        (!value.animations ||
          typeof value.animations !== "object" ||
          Array.isArray(value.animations) ||
          Object.entries(value.animations).some(
            ([k, v]) => !states.includes(k as State) || typeof v !== "string"
          ))
      )
        throw Error("Invalid animation mapping");
      for (const name of ["tools", "reactions"])
        if (
          value[name] !== undefined &&
          (!value[name] ||
            typeof value[name] !== "object" ||
            Array.isArray(value[name]) ||
            Object.values(value[name]).some(
              (v) => !states.includes(v as State)
            ))
        )
          throw Error(`Invalid ${name} state`);
      this.config = value;

    } catch (e) {
      if ((e as any).code !== "ENOENT")
        await this.$.ui.notify(`mascot: ${String(e)}`, "warn");
    }

    this.pack = new AnimationPack(this.$.session.cwd,this.config);
    this.timeline = new Timeline();
    this.activity = new Activity(this.config);
    if (this.config.enabled !== false) await this.show();
  }
  stop() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.revision++;
  }
  dispose() {
    this.disposed = true;
    this.stop();
  }
  async save() {
    await this.$.fs.write(FILE, JSON.stringify(this.config, null, 2));
  }
  async event(name: string, event: any) {
    this.activity.accept(name, event);
    // Repeated tool/activity events must not keep restarting the frame deadline.
    if (this.timer && this.activity.current() === this.state) return;
    if (this.config.enabled !== false && this.attached) await this.show();
  }
  async show() {
    this.stop();
    if (this.disposed || this.config.enabled === false || !this.attached)
      return;
    const revision = this.revision,
      state = this.activity.current();
    if (state !== this.state) {
      this.state = state;
    }
    let frames:AnimationFrames;
    try{frames=await this.pack.load(state);}catch(error){
      if(!this.warned.has(state)){this.warned.add(state);await this.$.ui.notify(`mascot: ${state}: ${String(error)}`,"warn");}
      try{frames=await this.pack.load("idle");}catch{frames=[];}
    }
    if(revision!==this.revision||this.disposed)return;
    this.timeline.select(frames);
    this.timeline.play(this.visible&&this.motion&&!this.config.paused);
    const sample=this.timeline.sample(frames,frames.plays);
    const frame=frames[sample.index];
    await this.$.ui.view("companion","Ghost",{
      attachment:{site:"composer",width:18,rows:6,label:labels[state]+(this.config.paused?" · paused":"")},
      ...(frame?{raster:{width:frame.width,height:frame.height,rgba:frame.rgba,alt:labels[state]}}:{}),
      lines:[],
    },{focus:false});
    if(revision!==this.revision||this.disposed||!this.visible)return;
    const remaining=(this.activity.transient?.until??0)-Date.now();
    const active=this.motion&&!this.config.paused&&!sample.done;
    if(!active&&remaining<=0)return;
    const delay=active?Math.min(this.timeline.sample(frames,frames.plays).wait,remaining>0?remaining:Infinity):Math.max(1,remaining);
    this.timer=setTimeout(()=>{void this.show().catch(()=>{});},Math.max(1,delay));
    this.timer.unref?.();
  }
  async command(command: string) {
    if(command==="status"){
      try{
      const frames=await this.pack.load(this.activity.current());
      const duration=frames.reduce((sum,frame)=>sum+frame.delay,0);
      await this.$.ui.notify(`Ghost: ${frames.length} source frames, ${(frames.length*1000/duration).toFixed(1)} fps average; ${this.imageVisible?"image slot visible":"compact status only"}; ${this.config.paused?"pause: on":"pause: off"}`,"info");
      }catch(error){await this.$.ui.notify(`Ghost: ${String(error)}`,"warn");}
      return;
    }
    if (command === "off") {
      this.config.enabled = false;
      this.timeline.play(false);
      this.stop();
      await this.$.ui.remove("companion");
      await this.save();
      return;
    }
    if (command === "reload") {
      this.stop();
      this.warned.clear();
      this.attached = true;
      await this.init();
      if (this.config.enabled === false) await this.$.ui.remove("companion");
      return;
    }
    if (command === "pause") this.config.paused = true;
    else if (command === "resume") this.config.paused = false;
    else if (command === "pet") this.activity.flash("done");
    else if (command && command !== "on") {
      await this.$.ui.notify("/mascot [on|off|pause|resume|pet|status|reload]", "info");
      return;
    }
    if(command==="on")this.timeline=new Timeline();
    this.config.enabled = true;
    this.attached = true;
    await this.save();
    await this.show();
  }
}
async function initialize(_: unknown, $: any) {
  instances.get($.session.id)?.dispose();
  const instance = new Companion($);
  instances.set($.session.id, instance);
  await instance.init();
}
const hooks: Record<string, any> = {
  "session.start": initialize,
  "session.reload": initialize,
  "prompt.submit": async (e: { text: string }, $: any) => {
    if (!/^\/mascot(?:\s|$)/.test(e.text.trim())) return;
    const instance = instances.get($.session.id);
    await instance?.command(e.text.trim().split(/\s+/)[1] ?? "on");
    return { drop: "mascot: handled" };
  },
  "ui.visibility": async (e: any, $: any) => {
    if (e.site !== "plugin:mascot/companion") return;
    const instance = instances.get($.session.id);
    if (!instance) return;
    instance.visible = e.visible;
    instance.imageVisible=e.visible&&e.columns>0&&e.rows>=6;
    instance.motion = (e.rows === undefined || e.rows >= 6) && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";
    instance.attached = e.attached;
    instance.timeline.play(e.visible&&instance.motion&&!instance.config.paused);
    instance.stop();
    if (e.visible) await instance.show();
  },
  "ui.press": async (e: any, $: any) => {
    if (e.site !== "plugin-mascot-companion") return;
    const instance = instances.get($.session.id);
    if (instance)
      await instance.command(
        e.key === "pause"
          ? instance.config.paused
            ? "resume"
            : "pause"
          : e.key
      );
  },
};
for (const name of [
  "turn.start",
  "turn.complete",
  "turn.failed",
  "turn.interrupted",
  "tool.call",
  "tool.result",
  "subagent.start",
  "subagent.complete",
  "ui.reaction",
  "agent.activity",
])
  hooks[name] = async (e: unknown, $: any) => {
    await instances.get($.session.id)?.event(name, e);
  };
export function dispose() {
  for (const instance of instances.values()) instance.dispose();
  instances.clear();
}
export default hooks;
