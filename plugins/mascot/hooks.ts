import { Activity } from "./activity.js";
import {
  AnimationPack,
  states,
  type Config,
  type State,
  type Frame,
} from "./animations.js";
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
  pack!: AnimationPack;
  visible = false;
  attached = true;
  disposed = false;
  frame = 0;
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
    this.pack = new AnimationPack(this.$.session.cwd, this.config);
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
      this.frame = 0;
    }
    let frames: Frame[] = [];
    try {
      frames = await this.pack.load(state);
    } catch (e) {
      if (!this.warned.has(state)) {
        this.warned.add(state);
        await this.$.ui.notify(`mascot: ${state}: ${String(e)}`, "warn");
      }
      try {
        frames = await this.pack.load("idle");
      } catch {}
    }
    if (revision !== this.revision || this.disposed) return;
    const frame = frames[this.config.paused ? 0 : this.frame % frames.length];
    await this.$.ui.view(
      "companion",
      "Ghost",
      {
        ...(frame
          ? {
              raster: {
                width: frame.width,
                height: frame.height,
                rgba: frame.rgba,
                alt: labels[state],
              },
            }
          : {}),
        lines: [
          {
            text: labels[state],
            tone:
              state === "error"
                ? "danger"
                : state === "done"
                ? "success"
                : "accent",
          },
          {
            text: this.config.paused ? "[ Resume ]" : "[ Pause ]",
            action: "pause",
            tone: "muted",
          },
          { text: "[ Pet Ghost ]", action: "pet", tone: "muted" },
        ],
      },
      { site: "sidebar", size: 0.24, focus: false }
    );
    if (revision !== this.revision || this.disposed || !this.visible) return;
    if (
      this.config.paused &&
      (!this.activity.transient || this.activity.transient.until <= Date.now())
    )
      return;
    this.timer = setTimeout(
      () => {
        this.frame++;
        void this.show().catch(() => {});
      },
      this.config.paused
        ? Math.max(
            80,
            (this.activity.transient?.until ?? Date.now()) - Date.now()
          )
        : frame?.delay ?? 180
    );
    this.timer.unref?.();
  }
  async command(command: string) {
    if (command === "off") {
      this.config.enabled = false;
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
      await this.$.ui.notify("/mascot [on|off|pause|resume|reload]", "info");
      return;
    }
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
    instance.attached = e.attached;
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
