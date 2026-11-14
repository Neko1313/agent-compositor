import {uiAppearanceSchema, type UiAppearance} from '@agent-compositor/events';

/** Merge portable fields only. Each renderer supplies its own defaults. */
export function mergeAppearance(contributions: Iterable<UiAppearance>): UiAppearance {
  const result: Record<string, Record<string, unknown>> = {};
  for (const patch of contributions) for (const section of ['colors', 'chrome', 'presentation'] as const) {
    const fields = patch[section];
    if (!fields) continue;
    for (const [key, value] of Object.entries(fields)) if (value !== undefined) (result[section] ??= {})[key] = value;
  }
  return result as UiAppearance;
}

/** Valid publications replace one owner and move it to the latest field precedence. */
export class AppearanceContributions {
  private readonly contributions = new Map<string, UiAppearance>();
  private appearance: UiAppearance = Object.freeze({});
  snapshot(): UiAppearance {return this.appearance;}
  private update() {
    const merged = mergeAppearance(this.contributions.values());
    for (const section of Object.values(merged)) Object.freeze(section);
    this.appearance = Object.freeze(merged);
  }
  publish(owner: string, value: unknown): {accepted: boolean; changed: boolean; showTools?: boolean} {
    if (value === null) return {accepted: true, changed: this.remove(owner)};
    const parsed = uiAppearanceSchema.safeParse(value);
    if (!parsed.success) return {accepted: false, changed: false};
    this.contributions.delete(owner);this.contributions.set(owner, parsed.data);this.update();
    return {accepted: true, changed: true, ...(parsed.data.presentation?.showTools === undefined ? {} : {showTools: parsed.data.presentation.showTools})};
  }
  remove(owner: string): boolean {
    if (!this.contributions.delete(owner)) return false;
    this.update();return true;
  }
  clear(): boolean {
    const changed = this.contributions.size > 0;
    this.contributions.clear();this.update();return changed;
  }
}
