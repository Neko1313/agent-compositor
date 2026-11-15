import type {
  ModelProvider,
  CompletionRequest,
  ProviderEvent,
} from "@agent-compositor/core";
import {createHash} from 'node:crypto';
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
    if(!Object.hasOwn(profiles,'default')||!profiles.default)throw Error('Unknown model profile: default');
    this.select("default");
  }
  get name(): string {
    return this.provider.name;
  }
  get model(): string {
    return this.selected.model;
  }
  get reasoningEffort():string|undefined{return this.selected.reasoningEffort;}
  setReasoningEffort(profile:string,value?:string){
    if(!Object.hasOwn(this.profiles,profile)||!this.profiles[profile])throw Error('Unknown provider profile');
    this.profiles[profile].reasoningEffort=value;
    if(this.profileName!==profile)return;
    this.selected={...this.selected,reasoningEffort:value};
    this.provider=!this.selected.type||this.selected.type==='openai-compat'?new OpenAICompatProvider(this.selected):new NativeProvider({...this.selected,type:this.selected.type});
  }
  select(name: string): void {
    const known=Object.hasOwn(this.profiles,name);
    if (known) this.profileName = name;
    const profile = (known ? this.profiles[name] : undefined) ?? {
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
  private capabilityFetchIds = new WeakMap<typeof fetch,number>();
  private nextCapabilityFetchId=0;
  private capabilityKey(selected:ProviderProfile,identity:string){
    const fetcher=selected.fetch??fetch;
    let fetchId=this.capabilityFetchIds.get(fetcher);
    if(fetchId===undefined){fetchId=this.nextCapabilityFetchId++;this.capabilityFetchIds.set(fetcher,fetchId);}
    const credentialHash=createHash('sha256').update(JSON.stringify([selected.apiKey,selected.headers])).digest('hex');
    return JSON.stringify([identity,selected.type,selected.model,selected.baseUrl,selected.contextWindow,selected.maxOutputTokens,selected.metadataProvider,selected.metadataUrl,fetchId,credentialHash]);
  }
  async capabilities(signal:AbortSignal, profile?:string) {
    for(let attempt=0;attempt<3;attempt++){
      signal.throwIfAborted();
      const selected=profile ? Object.hasOwn(this.profiles,profile)?this.profiles[profile]:undefined : this.selected;
      if(!selected)throw Error("Unknown model profile");
      const identity=profile??this.profileName,key=this.capabilityKey(selected,identity);
      const cached=this.capabilityCache.get(key);if(cached&&Date.now()-cached.at<60000)return cached.value;
      const snapshot={...selected,headers:selected.headers?{...selected.headers}:undefined};
      const value=await discoverCapabilities(snapshot,signal);signal.throwIfAborted();
      const current=profile ? Object.hasOwn(this.profiles,profile)?this.profiles[profile]:undefined : this.selected;
      if(!current||this.capabilityKey(current,profile??this.profileName)!==key)continue;
      this.capabilityCache.delete(key);this.capabilityCache.set(key,{at:Date.now(),value});
      if(this.capabilityCache.size>128)this.capabilityCache.delete(this.capabilityCache.keys().next().value!);
      return value;
    }
    throw Error('Model configuration changed repeatedly during capability discovery');
  }
  complete(request: CompletionRequest): AsyncIterable<ProviderEvent> {
    if (!request.profile) return this.provider.complete(request);
    const profile = Object.hasOwn(this.profiles,request.profile)?this.profiles[request.profile]:undefined;
    if (!profile) throw new Error(`Unknown model profile: ${request.profile}`);
    const provider =
      !profile.type || profile.type === "openai-compat"
        ? new OpenAICompatProvider(profile)
        : new NativeProvider({ ...profile, type: profile.type });
    return provider.complete(request);
  }
}
