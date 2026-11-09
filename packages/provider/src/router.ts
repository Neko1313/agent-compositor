import type {
  ModelProvider,
  CompletionRequest,
  ProviderEvent,
} from "@agent-compositor/core";
import { discoverCapabilities } from "./capabilities.js";
import { NativeProvider, type NativeConfig } from "./native.js";
import {
  OpenAICompatProvider,
  type OpenAICompatConfig,
} from "./openai-compat.js";
export type ProviderProfile = OpenAICompatConfig & {
  type?: "openai-compat" | NativeConfig["type"];
  maxOutputTokens?: number;
  contextWindow?: number;
  metadataProvider?: "ollama";
  metadataUrl?: string;
};
export class ProviderRouter implements ModelProvider {
  private provider!: ModelProvider;
  private selected!: ProviderProfile;
  active = "default";
  private profileName = "default";
  get credentialProfile(): string {
    return this.profileName;
  }
  constructor(readonly profiles: Record<string, ProviderProfile>) {
    this.select("default");
  }
  get name(): string {
    return this.provider.name;
  }
  get model(): string {
    return this.selected.model;
  }
  select(name: string): void {
    if (this.profiles[name]) this.profileName = name;
    const profile = this.profiles[name] ?? {
      ...this.profiles[this.profileName],
      model: name,
    };
    if (!profile || !profile.model)
      throw new Error(`Unknown model profile: ${name}`);
    this.active = name;
    this.selected = profile;
    this.provider =
      !profile.type || profile.type === "openai-compat"
        ? new OpenAICompatProvider(profile)
        : new NativeProvider({ ...profile, type: profile.type });
  }
  private capabilityCache = new Map<string, {at:number; value:import("@agent-compositor/core").ModelCapabilities}>();
  async capabilities(signal:AbortSignal, profile?:string) {
    const selected=profile ? this.profiles[profile] : this.selected;
    if(!selected)throw Error("Unknown model profile");
    const key=JSON.stringify([this.profileName,selected.model,selected.baseUrl,selected.contextWindow,selected.maxOutputTokens,selected.metadataProvider,selected.metadataUrl]);
    const cached=this.capabilityCache.get(key);if(cached&&Date.now()-cached.at<60000)return cached.value;
    const value=await discoverCapabilities(selected,signal);this.capabilityCache.set(key,{at:Date.now(),value});return value;
  }
  complete(request: CompletionRequest): AsyncIterable<ProviderEvent> {
    if (!request.profile) return this.provider.complete(request);
    const profile = this.profiles[request.profile];
    if (!profile) throw new Error(`Unknown model profile: ${request.profile}`);
    const provider =
      !profile.type || profile.type === "openai-compat"
        ? new OpenAICompatProvider(profile)
        : new NativeProvider({ ...profile, type: profile.type });
    return provider.complete(request);
  }
}
