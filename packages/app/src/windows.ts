export type Tree =
  | { surface: string }
  | { axis: "horizontal" | "vertical"; ratio: number; children: [Tree, Tree] };
export type DropEdge = "left" | "right" | "top" | "bottom" | "center";
export interface ResizeHandle {
  node: Exclude<Tree, { surface: string }>;
  path: number[];
  x: number;
  y: number;
  width: number;
  height: number;
  original: number;
}
export interface Frame {
  surface: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
export const leaves = (node?: Tree): string[] =>
  !node
    ? []
    : "surface" in node
    ? [node.surface]
    : node.children.flatMap(leaves);
function change(node: Tree, id: string, fn: (node: Tree) => Tree): Tree {
  if ("surface" in node) return node.surface === id ? fn(node) : node;
  return {
    ...node,
    children: node.children.map((n) => change(n, id, fn)) as [Tree, Tree],
  };
}
function remove(node: Tree, id: string): Tree | undefined {
  if ("surface" in node) return node.surface === id ? undefined : node;
  const a = remove(node.children[0], id),
    b = remove(node.children[1], id);
  return a && b ? { ...node, children: [a, b] } : a ?? b;
}
/** Binary tiling tree owned by the compositor. Renderer receives only rectangles. */
export class WindowManager {
  workspace = 1;
  focused = "session";
  fullscreen = false;
  axis: "horizontal" | "vertical" = "horizontal";
  private spaces = new Map<number, { tree?: Tree; focus?: string }>([
    [
      1,
      {
        tree: {
          axis: "horizontal",
          ratio: 0.7,
          children: [{ surface: "session" }, { surface: "tools" }],
        },
        focus: "session",
      },
    ],
  ]);
  snapshot(): unknown {
    return {
      version: 1,
      workspace: this.workspace,
      focused: this.focused,
      axis: this.axis,
      fullscreen: this.fullscreen,
      spaces: [...this.spaces].map(([id, state]) => ({
        id,
        ...structuredClone(state),
      })),
    };
  }
  restore(value: unknown, known: Set<string>): void {
    const state = value as {
      version?: number;
      workspace?: number;
      focused?: string;
      axis?: string;
      fullscreen?: boolean;
      spaces?: { id: number; tree?: unknown; focus?: string }[];
    };
    if (
      state?.version !== 1 ||
      !Array.isArray(state.spaces) ||
      state.spaces.length > 9
    )
      throw new Error("Invalid window layout");
    const seen = new Set<string>();
    let nodes = 0;
    const tree = (raw: any, depth = 0): Tree | undefined => {
      if (!raw) return;
      if (depth > 24 || ++nodes > 256)
        throw new Error("Window layout is too deep");
      if (typeof raw.surface === "string") {
        if (!known.has(raw.surface) || seen.has(raw.surface)) return;
        seen.add(raw.surface);
        return { surface: raw.surface };
      }
      if (
        !["horizontal", "vertical"].includes(raw.axis) ||
        !Number.isFinite(raw.ratio) ||
        raw.ratio < 0.05 ||
        raw.ratio > 0.95 ||
        !Array.isArray(raw.children) ||
        raw.children.length !== 2
      )
        throw new Error("Invalid split");
      const a = tree(raw.children[0], depth + 1),
        b = tree(raw.children[1], depth + 1);
      return a && b
        ? { axis: raw.axis, ratio: raw.ratio, children: [a, b] }
        : a ?? b;
    };
    const spaces = new Map<number, { tree?: Tree; focus?: string }>();
    for (const space of state.spaces) {
      if (
        !Number.isInteger(space.id) ||
        space.id < 1 ||
        space.id > 9 ||
        spaces.has(space.id)
      )
        throw new Error("Invalid workspace");
      spaces.set(space.id, { tree: tree(space.tree), focus: space.focus });
    }
    this.spaces = spaces;
    this.workspace = spaces.has(state.workspace ?? 1) ? state.workspace! : 1;
    this.axis = state.axis === "vertical" ? "vertical" : "horizontal";
    this.focused =
      state.focused === "input" || this.ids().includes(state.focused ?? "")
        ? state.focused!
        : this.ids()[0] ?? "input";
    this.fullscreen = !!state.fullscreen;
  }
  get tree(): Tree | undefined {
    return this.spaces.get(this.workspace)?.tree;
  }
  private set tree(tree: Tree | undefined) {
    this.spaces.set(this.workspace, { tree, focus: this.focused });
  }
  has(id: string): boolean {
    return [...this.spaces.values()].some((space) =>
      leaves(space.tree).includes(id)
    );
  }
  workspaceOf(id: string): number | undefined {
    return [...this.spaces].find(([, state]) =>
      leaves(state.tree).includes(id)
    )?.[0];
  }
  relocate(id: string, options: Parameters<WindowManager["place"]>[1]): void {
    for (const [workspace, state] of this.spaces) {
      if (!state.tree || !leaves(state.tree).includes(id)) continue;
      state.tree = remove(state.tree, id);
      if (state.focus === id) state.focus = leaves(state.tree)[0] ?? "input";
      if (workspace === this.workspace && this.focused === id)
        this.focused = state.focus ?? "input";
    }
    this.fullscreen = false;
    this.place(id, options);
  }
  ids(): string[] {
    return leaves(this.tree);
  }
  switchTo(id: number): void {
    this.spaces.set(this.workspace, { tree: this.tree, focus: this.focused });
    this.workspace = id;
    this.focused =
      this.spaces.get(id)?.focus ?? leaves(this.tree)[0] ?? "input";
    this.fullscreen = false;
  }
  open(id: string): void {
    if (this.ids().includes(id)) {
      this.focused = id;
      return;
    }
    const old = this.ids().includes(this.focused)
      ? this.focused
      : this.ids()[0];
    this.tree =
      this.tree && old
        ? change(this.tree, old, (node) => ({
            axis: this.axis,
            ratio: 0.5,
            children: [node, { surface: id }],
          }))
        : { surface: id };
    this.focused = id;
  }
  /** Place once. Later publications update content without overriding user moves. */
  place(
    id: string,
    options: {
      site?: "split" | "sidebar" | "inspector" | "status-bar";
      workspace?: number;
      size?: number;
      relativeTo?: string;
      focus?: boolean;
    } = {}
  ): void {
    if (this.has(id)) return;
    const workspace = options.workspace ?? this.workspace;
    const state = this.spaces.get(workspace) ?? {};
    const site = options.site ?? "split";
    const focus = options.focus ?? site === "split";
    let tree = state.tree;
    const size =
      options.size ??
      (site === "sidebar"
        ? 0.25
        : site === "status-bar"
        ? 0.25
        : site === "split"
        ? 0.5
        : 0.3);
    const leaf: Tree = { surface: id };
    if (!tree) tree = leaf;
    else {
      const ids = leaves(tree);
      const anchor =
        options.relativeTo && ids.includes(options.relativeTo)
          ? options.relativeTo
          : site === "inspector" && ids.includes("session")
          ? "session"
          : site === "split"
          ? ids.includes(this.focused)
            ? this.focused
            : ids[0]
          : undefined;
      const axis =
        site === "sidebar"
          ? "horizontal"
          : site === "split"
          ? this.axis
          : "vertical";
      const split = (node: Tree): Tree => ({
        axis,
        ratio: 1 - size,
        children: [node, leaf],
      });
      tree = anchor ? change(tree, anchor, split) : split(tree);
    }
    this.spaces.set(workspace, {
      tree,
      focus: focus ? id : state.focus ?? leaves(tree)[0],
    });
    if (focus) {
      this.switchTo(workspace);
      this.focused = id;
    }
  }
  close(): void {
    if (!this.tree || this.focused === "input") return;
    this.tree = remove(this.tree, this.focused);
    this.focused = this.ids()[0] ?? "input";
    this.fullscreen = false;
  }
  forget(id: string): void {
    for (const state of this.spaces.values()) {
      if (state.tree) state.tree = remove(state.tree, id);
      if (state.focus === id) state.focus = leaves(state.tree)[0];
    }
    if (this.focused === id) this.focused = this.ids()[0] ?? "input";
  }
  moveWorkspace(id: number): void {
    if (this.focused === "input") return;
    const surface = this.focused;
    this.close();
    this.switchTo(id);
    this.open(surface);
  }
  frames(width: number, height: number): Frame[] {
    if (!this.tree) return [];
    if (this.fullscreen && this.ids().includes(this.focused))
      return [{ surface: this.focused, x: 0, y: 0, width, height }];
    const walk = (
      node: Tree,
      x: number,
      y: number,
      w: number,
      h: number
    ): Frame[] => {
      if ("surface" in node)
        return [{ surface: node.surface, x, y, width: w, height: h }];
      const horizontal = node.axis === "horizontal",
        size = horizontal ? w : h;
      // Tiny terminals show the focused branch instead of overflowing the terminal.
      if (size < (horizontal ? 24 : 8))
        return walk(
          node.children[
            leaves(node.children[1]).includes(this.focused) ? 1 : 0
          ],
          x,
          y,
          w,
          h
        );
      const n = Math.max(1, Math.min(size - 1, Math.floor(size * node.ratio)));
      return [
        ...walk(node.children[0], x, y, horizontal ? n : w, horizontal ? h : n),
        ...walk(
          node.children[1],
          horizontal ? x + n : x,
          horizontal ? y : y + n,
          horizontal ? w - n : w,
          horizontal ? h : h - n
        ),
      ];
    };
    return walk(this.tree, 0, 0, width, height);
  }
  /** Find the deepest visible split under either of its two border cells. */
  separator(
    col: number,
    row: number,
    width: number,
    height: number
  ): ResizeHandle | undefined {
    if (!this.tree || this.fullscreen) return;
    const walk = (
      node: Tree,
      x: number,
      y: number,
      w: number,
      h: number,
      path: number[]
    ): ResizeHandle | undefined => {
      if (
        "surface" in node ||
        col < x ||
        col >= x + w ||
        row < y ||
        row >= y + h
      )
        return;
      const horizontal = node.axis === "horizontal",
        size = horizontal ? w : h;
      if (size < (horizontal ? 24 : 8)) return;
      const n = Math.max(1, Math.min(size - 1, Math.floor(size * node.ratio)));
      const first = walk(
        node.children[0],
        x,
        y,
        horizontal ? n : w,
        horizontal ? h : n,
        [...path, 0]
      );
      const second = walk(
        node.children[1],
        horizontal ? x + n : x,
        horizontal ? y : y + n,
        horizontal ? w - n : w,
        horizontal ? h : h - n,
        [...path, 1]
      );
      if (first || second) return first ?? second;
      const coordinate = horizontal ? col - x : row - y;
      if (coordinate === n - 1 || coordinate === n)
        return { node, path, x, y, width: w, height: h, original: node.ratio };
    };
    return walk(this.tree, 0, 0, width, height, []);
  }
  private resizeNode(
    handle: ResizeHandle
  ): Exclude<Tree, { surface: string }> | undefined {
    let node = this.tree;
    for (const index of handle.path) {
      if (!node || "surface" in node) return;
      node = node.children[index];
    }
    return node === handle.node ? handle.node : undefined;
  }
  dragResize(handle: ResizeHandle, col: number, row: number): boolean {
    const node = this.resizeNode(handle);
    if (!node) return false;
    const horizontal = node.axis === "horizontal";
    const size = horizontal ? handle.width : handle.height;
    const minimum = Math.min(0.45, (horizontal ? 12 : 4) / size);
    node.ratio = Math.max(
      minimum,
      Math.min(
        1 - minimum,
        (horizontal ? col - handle.x : row - handle.y) / size
      )
    );
    return true;
  }
  cancelResize(handle: ResizeHandle): void {
    const contains = (node?: Tree): boolean =>
      !!node &&
      (node === handle.node ||
        (!("surface" in node) && node.children.some(contains)));
    if (contains(this.tree)) handle.node.ratio = handle.original;
  }
  drop(source: string, target: string, edge: DropEdge): void {
    if (
      !this.tree ||
      source === target ||
      !this.ids().includes(source) ||
      !this.ids().includes(target)
    )
      return;
    if (edge === "center") {
      this.tree = change(
        change(this.tree, source, () => ({ surface: "__drag_swap" })),
        target,
        () => ({ surface: source })
      );
      this.tree = change(this.tree, "__drag_swap", () => ({ surface: target }));
    } else {
      const tree = remove(this.tree, source)!;
      const before = edge === "left" || edge === "top";
      this.tree = change(tree, target, (node) => ({
        axis: edge === "left" || edge === "right" ? "horizontal" : "vertical",
        ratio: 0.5,
        children: before
          ? [{ surface: source }, node]
          : [node, { surface: source }],
      }));
    }
    this.focused = source;
    this.fullscreen = false;
  }
  direction(key: string, width: number, height: number, move = false): void {
    const frames = this.frames(width, height),
      current = frames.find((f) => f.surface === this.focused);
    if (!current) {
      this.focused = frames[0]?.surface ?? "input";
      return;
    }
    const cx = current.x + current.width / 2,
      cy = current.y + current.height / 2;
    const candidates = frames
      .filter((f) => f !== current)
      .map((f) => ({
        f,
        dx: f.x + f.width / 2 - cx,
        dy: f.y + f.height / 2 - cy,
      }))
      .filter((p) =>
        key === "left"
          ? p.dx < 0
          : key === "right"
          ? p.dx > 0
          : key === "up"
          ? p.dy < 0
          : p.dy > 0
      )
      .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy));
    const target = candidates[0]?.f.surface;
    if (!target) return;
    if (move && this.tree) {
      const from = this.focused;
      this.tree = change(
        change(this.tree, from, () => ({ surface: "__swap" })),
        target,
        () => ({ surface: from })
      );
      this.tree = change(this.tree, "__swap", () => ({ surface: target }));
    } else this.focused = target;
  }
  resize(delta: number): void {
    const walk = (node: Tree): boolean => {
      if ("surface" in node) return false;
      const index = leaves(node.children[0]).includes(this.focused) ? 0 : 1;
      if (!leaves(node.children[index]).includes(this.focused)) return false;
      if (!walk(node.children[index]))
        node.ratio = Math.max(
          0.15,
          Math.min(0.85, node.ratio + (index === 0 ? delta : -delta))
        );
      return true;
    };
    if (this.tree) walk(this.tree);
  }
  workspaces(): number[] {
    return [...new Set([1, 2, 3, ...this.spaces.keys(), this.workspace])].sort(
      (a, b) => a - b
    );
  }
}
