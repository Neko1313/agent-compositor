export { loadConfig, type LoadOptions } from "./loader.js";
export { discover, systemDirectory, globalDirectory, CONFIG_NAMES, PROJECT_DIR, type DiscoveryOptions } from "./discovery.js";
export { substitute, type SubstituteInput, type SubstituteResult } from "./variable.js";
export {
  ConfigSchema,
  type CompositorConfig,
  type ConfigSource,
  type ConfigKeyOrigin,
  type LoadedConfig,
  type SubstitutionRecord,
} from "./schema.js";
