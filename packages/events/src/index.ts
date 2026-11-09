import type { z } from "zod";
import type { EventDef } from "./define.js";
import { catalog } from "./catalog/index.js";

export * from "./catalog/index.js";

export type Catalog = typeof catalog;

/** Map of canonical name -> definition. */
export const byName: ReadonlyMap<string, EventDef> = new Map(catalog.map((e) => [e.name, e]));

/** Map of any name (canonical or alias) -> definition. */
export const byAnyName: ReadonlyMap<string, EventDef> = new Map(
  catalog.flatMap((e) => [e.name, ...(e.aliases ?? [])].map((n) => [n, e] as const)),
);

/** Resolve an event name, following aliases. Returns undefined for unknown names. */
export function resolve(name: string): EventDef | undefined {
  return byAnyName.get(name);
}

/** Payload type helper for consumers of the package. */
export type InputOf<E extends EventDef> = z.infer<E["input"]>;

/** Catalog version. Bump per semver; events carry `since`. */
export const CATALOG_VERSION = "0.11.0";

export * from "./forms.js";
