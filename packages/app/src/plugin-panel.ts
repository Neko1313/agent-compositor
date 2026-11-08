import type { InputMessage } from "@agent-compositor/protocol";
import type { Placement } from "./placement.js";
export interface PluginWindow { id: string; plugin: string; surface: string; title: string; placement: Placement }
const sites = ["split", "sidebar", "inspector", "status-bar"] as const;
export class PluginPanel {
  field = 0;
  selected = "";
  draft: Placement = {};
  message = "Changes apply only when you choose Apply or Save.";
  busy = false;
  private start = 0;
  private visible = 0;
  constructor(private source: () => PluginWindow[], private anchors: () => string[]) { this.select(0); }
  windows(): PluginWindow[] { return this.source(); }
  target(): PluginWindow | undefined { return this.windows().find(p => p.id === this.selected); }
  private select(delta: number): void {
    const windows = this.windows();
    if (!windows.length) return;
    const index = Math.max(0, windows.findIndex(p => p.id === this.selected));
    const target = windows[(index + delta + windows.length) % windows.length];
    this.selected = target.id;
    this.draft = { site: "split", workspace: 1, size: .3, focus: false, ...target.placement };
  }
  rows(height: number): string[] {
    const windows = this.windows();
    if (!windows.length) return ["No plugin windows have been published yet.", "Plugin windows appear after a plugin calls $.ui.surface.", "Esc closes this panel."];
    if (!this.target()) this.select(0);
    const target = this.target()!;
    const rows = [
      `Window: ${target.plugin} / ${target.title} (${windows.findIndex(p => p.id === target.id) + 1}/${windows.length})`,
      `Place: ${this.draft.site}`, `Workspace: ${this.draft.workspace}`, `Size: ${Math.round((this.draft.size ?? .3) * 100)}%`,
      `Neighbour: ${this.draft.relativeTo ?? "workspace"}`, `Focus on opening: ${this.draft.focus ? "yes" : "no"}`,
      "[ Apply now ]", "[ Save rule + apply ]", "[ Close ]",
    ];
    const capacity = Math.max(1, height - 3);
    // Reserve a feedback row on terminals tall enough to display it.
    const visible = Math.max(1, capacity - (capacity > 2 ? 2 : 0));
    this.visible = Math.min(visible, rows.length);
    this.start = Math.max(0, Math.min(this.field - visible + 1, rows.length - visible));
    const result = rows.slice(this.start, this.start + visible).map((row, i) => `${this.start + i === this.field ? ">" : " "} ${row}`);
    if (capacity > 2) result.push(this.busy ? "Saving…" : this.message, "↑↓ fields · ←→ change · Enter select · Esc close");
    return result;
  }
  interactiveRow(row: number): boolean { return !!this.target() && row >= 2 && row < 2 + this.visible; }
  handle(data: InputMessage["data"]): "apply" | "save" | "close" | undefined {
    if (this.busy || data.kind === "mouse" && (data.action === "move" || data.action === "release")) return;
    if (data.kind === "key" && (data.key === "escape" || data.key === "c" && data.modifiers?.includes("ctrl"))) return "close";
    if (!this.target()) return;
    let change = 0, activate = false;
    if (data.kind === "mouse") {
      if (data.button !== "left") return;
      if (data.row < 2 || data.row >= 2 + this.visible) return;
      const field = this.start + data.row - 2;
      if (field < 0 || field > 8) return;
      this.field = field; activate = true;
    } else if (data.kind === "key") {
      if (data.key === "up" || data.key === "down" || data.key === "tab") {
        this.field = (this.field + (data.key === "up" ? -1 : 1) + 9) % 9; return;
      }
      if (data.key === "left") change = -1;
      if (data.key === "right") change = 1;
      if (data.key === "enter") activate = true;
    }
    if (activate && this.field >= 6) return (["apply", "save", "close"] as const)[this.field - 6];
    if (activate) change = 1;
    if (!change) return;
    if (this.field === 0) this.select(change);
    if (this.field === 1) {
      const index = sites.indexOf(this.draft.site ?? "split");
      this.draft.site = sites[(index + change + sites.length) % sites.length];
    }
    if (this.field === 2) this.draft.workspace = ((this.draft.workspace ?? 1) - 1 + change + 9) % 9 + 1;
    if (this.field === 3) this.draft.size = Math.max(.1, Math.min(.8, Math.round(((this.draft.size ?? .3) + change * .05) * 100) / 100));
    if (this.field === 4) {
      const anchors = [undefined, ...this.anchors().filter(id => id !== this.selected)];
      this.draft.relativeTo = anchors[(Math.max(0, anchors.indexOf(this.draft.relativeTo)) + change + anchors.length) % anchors.length];
    }
    if (this.field === 5) this.draft.focus = !this.draft.focus;
    this.message = "Not applied yet.";
  }
}
