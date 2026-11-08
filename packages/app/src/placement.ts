export interface Placement {
  site?: "split" | "sidebar" | "inspector" | "status-bar";
  workspace?: number;
  size?: number;
  relativeTo?: string;
  focus?: boolean;
}
export interface PlacementConfig {
  sites?: Partial<Record<NonNullable<Placement["site"]>, Placement>>;
  rules?: (Placement & { match: { plugin?: string; surface?: string } })[];
}
/** Exact identity matches, later rules override earlier rules field by field. */
export function resolvePlacement(config: PlacementConfig, plugin: string, surface: string, hint: Placement = {}): Placement {
  const rules = (config.rules ?? []).filter(rule =>
    (rule.match.plugin === undefined || rule.match.plugin === plugin) &&
    (rule.match.surface === undefined || rule.match.surface === surface));
  const override: Placement = Object.assign({}, ...rules.map(({ match, ...placement }) => placement));
  const site = override.site ?? hint.site ?? "split";
  return { ...hint, ...config.sites?.[site], ...override, site };
}
