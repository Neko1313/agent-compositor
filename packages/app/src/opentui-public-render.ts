import {uiTextViewSchema, type UiTextView} from '@agent-compositor/events';
import type {PublicRenderMeasurement, PublicRenderSlots, PublicRenderSlotSnapshot, PublicRenderSlotSource} from '@agent-compositor/renderer-opentui';

export interface OpenTuiPublicRenderOptions {
  describe(id: string, metrics: PublicRenderMeasurement): {site: string; props: Record<string, unknown>; defaultView: UiTextView} | undefined;
  render(input: {site: string; surface: 'terminal'; props: Record<string, unknown>; viewport: {columns: number; rows: number}},
    signal: AbortSignal): Promise<{value: unknown}>;
  press(id: string, action: string): void|boolean;
}
type Input = Parameters<OpenTuiPublicRenderOptions['render']>[0];
type Description = {key: string; input: Input; defaultView: UiTextView};
type Entry = {
  id: string; identity: object; source: PublicRenderSlotSource; listeners: Set<() => void>;
  metrics: PublicRenderMeasurement; scroll: number; state: PublicRenderSlotSnapshot; key?: string; desired?: Job;
};
type Job = Description & {entry: Entry; epoch: number; controller: AbortController};

function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {for (const child of Object.values(value)) immutable(child);Object.freeze(value);}
  return value;
}
function actions(view: UiTextView): Set<string> {
  return new Set([
    ...view.lines.map(line => line.action),
    ...(view.tabs ?? []).filter(tab => !tab.disabled).map(tab => tab.action),
    ...(view.table?.rows ?? []).flatMap(row => [row.action, ...(row.expanded ? row.details ?? [] : []).map(line => line.action)]),
  ].filter((action): action is string => typeof action === 'string'));
}

/** Public, data-only render cache. Runtime owns the real hook chain and its read-only boundary. */
export function createOpenTuiPublicRender(options: OpenTuiPublicRenderOptions) {
  const entries = new Map<string, Entry>(), buckets = new Map<string, Set<Job>>();
  let active = true, epoch = 0, running = 0, draining = false;
  const current = (entry: Entry) => active && entries.get(entry.id) === entry;
  function publish(entry: Entry, defaultView?: UiTextView, override?: UiTextView) {
    entry.state = immutable({revision: entry.state.revision + 1, ...(defaultView ? {defaultView} : {}), ...(override ? {override} : {})});
    for (const listener of [...entry.listeners]) {try {listener();} catch {/* A subscriber cannot stop cache cleanup. */}}
  }
  function describe(entry: Entry): Description | undefined {
    try {
      const value = options.describe(entry.id, {...entry.metrics, scrollOffset: entry.scroll});
      if (!value || typeof value.site !== 'string' || !value.site || !value.props || typeof value.props !== 'object' || Array.isArray(value.props)) return;
      const parsed = uiTextViewSchema.safeParse(value.defaultView);if (!parsed.success) return;
      const input: Input = {site: value.site, surface: 'terminal', props: structuredClone(value.props),
        viewport: {columns: entry.metrics.columns, rows: entry.metrics.rows}};
      // Reject cyclic/capability-bearing input rather than passing a borrowed host object.
      const key = JSON.stringify({input, defaultView: parsed.data, scrollOffset: entry.scroll, epoch, visible: entry.metrics.visible});
      return immutable({key, input, defaultView: parsed.data});
    } catch {return;}
  }
  function abort(entry: Entry) {
    entry.desired = undefined;
    for (const job of buckets.get(entry.id) ?? []) job.controller.abort(Error('Public render superseded'));
  }
  function refreshEntry(entry: Entry) {
    if (!current(entry)) return;
    const description = describe(entry);
    if (description?.key === entry.key) return;
    abort(entry);entry.key = description?.key;
    publish(entry, description?.defaultView);
    if (!current(entry) || entry.key !== description?.key) return;
    if (description && entry.metrics.visible) entry.desired = {...description, entry, epoch, controller: new AbortController()};
    drain();
  }
  function valid(job: Job) {
    return current(job.entry) && job.epoch === epoch && !job.controller.signal.aborted && job.entry.metrics.visible && job.entry.key === job.key;
  }
  function finish(job: Job) {
    const bucket = buckets.get(job.entry.id);bucket?.delete(job);if (bucket?.size === 0) buckets.delete(job.entry.id);
    running--;queueMicrotask(drain);
  }
  function start(job: Job) {
    const bucket = buckets.get(job.entry.id) ?? new Set<Job>();buckets.set(job.entry.id, bucket);bucket.add(job);running++;
    let task: Promise<{value: unknown}>;
    try {task = options.render(job.input, job.controller.signal);} catch {finish(job);return;}
    void Promise.resolve(task).then(result => {
      if (!valid(job)) return;
      if (describe(job.entry)?.key !== job.key) {refreshEntry(job.entry);return;}
      const value = result?.value as {tree?: unknown} | null | undefined;
      const parsed = uiTextViewSchema.safeParse(value?.tree);
      if (parsed.success && valid(job)) publish(job.entry, job.defaultView, immutable(parsed.data));
    }).catch(() => {}).finally(() => finish(job));
  }
  function drain() {
    if (!active || draining) return;
    draining = true;
    try {
      for (const entry of entries.values()) {
        if (running >= 512) break;
        const job = entry.desired;
        if (!job || (buckets.get(entry.id)?.size ?? 0) >= 2) continue;
        entry.desired = undefined;if (valid(job)) start(job);
      }
    } finally {draining = false;}
  }
  function remove(id: string) {
    const entry = entries.get(id);if (!entry) return;
    entries.delete(id);abort(entry);entry.key = undefined;publish(entry);entry.listeners.clear();
  }
  const slots: PublicRenderSlots = {slot: id => entries.get(id)?.source};
  return {
    slots,
    register(id: string, identity: object): PublicRenderSlotSource {
      const previous = entries.get(id);if (previous?.identity === identity) return previous.source;
      if (previous) remove(id);
      const entry: Entry = {id, identity, source: undefined!, listeners: new Set(),
        metrics: {columns: 0, rows: 0, visible: false, scrollOffset: 0, scrollOrigin: 'layout'}, scroll: 0, state: immutable({revision: 0})};
      const source: PublicRenderSlotSource = {
        id, snapshot: () => entry.state,
        subscribe(listener) {if (!current(entry)) return () => {};entry.listeners.add(listener);return () => {entry.listeners.delete(listener);};},
        measure(metrics) {
          if (!current(entry) || !metrics || typeof metrics.visible !== 'boolean' ||
            [metrics.columns, metrics.rows, metrics.scrollOffset].some(number => !Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) ||
            metrics.scrollOrigin !== undefined && metrics.scrollOrigin !== 'input' && metrics.scrollOrigin !== 'layout') return;
          const next = {columns: Math.floor(metrics.columns), rows: Math.floor(metrics.rows), scrollOffset: Math.floor(metrics.scrollOffset),
            visible: metrics.visible && metrics.columns >= 1 && metrics.rows >= 1, scrollOrigin: metrics.scrollOrigin ?? 'layout'} as const;
          if (next.scrollOrigin === 'input' || !entry.state.override) entry.scroll = next.scrollOffset;
          entry.metrics = next;refreshEntry(entry);
        },
        press(action, revision) {
          if (!current(entry) || !entry.metrics.visible || typeof action !== 'string' || entry.state.revision !== revision || !entry.state.override) return false;
          refreshEntry(entry);
          if (!current(entry) || entry.state.revision !== revision || !entry.state.override || !actions(entry.state.override).has(action)) return false;
          try {return options.press(id, action)!==false;} catch {return false;}
        },
      };
      entry.source = source;
      if (active) {entries.set(id, entry);refreshEntry(entry);}
      return source;
    },
    refresh(id?: string) {if (id === undefined) {for (const entry of [...entries.values()]) refreshEntry(entry);} else {const entry = entries.get(id);if (entry) refreshEntry(entry);}},
    remove,
    reset() {epoch++;for (const id of [...entries.keys()]) remove(id);},
    invalidate() {epoch++;for (const entry of [...entries.values()]) {if (entry.metrics.visible) refreshEntry(entry);else abort(entry);}},
    close() {if (!active) return;active = false;epoch++;for (const id of [...entries.keys()]) remove(id);},
  };
}
