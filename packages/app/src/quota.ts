import type { ProviderRouter } from "@agent-compositor/provider";
import {createHash} from 'node:crypto';
export function quotaReader(router: ProviderRouter) {
  let cached: { signature: string; fetcher: typeof fetch; at: number; value: unknown } | undefined;
  return async () => {
    const name = router.credentialProfile,
      p = router.profiles[name] as any,
      config = p?.quota;
    if (!config?.url)
      return {
        value: { available: false, reason: "No quota endpoint configured" },
      };
    const url = new URL(config.url),
      base = new URL(p.baseUrl);
    if (url.origin !== base.origin)
      throw new Error("Quota endpoint must share the provider origin");
    const fetcher:typeof fetch=p.fetch??fetch;
    const signature=createHash('sha256').update(JSON.stringify([name,p.type,p.baseUrl,p.apiKey,config])).digest('hex');
    if (cached?.signature === signature && cached.fetcher===fetcher && Date.now() - cached.at < 30000)
      return { value: cached.value };
    const headers: Record<string, string> =
      p.type === "anthropic"
        ? { "x-api-key": p.apiKey }
        : p.type === "gemini"
        ? { "x-goog-api-key": p.apiKey }
        : { Authorization: `Bearer ${p.apiKey}` };
    const result = await fetcher(url, {
      signal: AbortSignal.timeout(8000),
      redirect: "error",
      headers,
    });
    if (!result.ok) {await result.body?.cancel();throw new Error(`Quota HTTP ${result.status}`);}
    const reader=result.body?.getReader(),decoder=new TextDecoder();let text='',bytes=0;
    if(reader){
      try{
        while(true){const chunk=await reader.read();if(chunk.done)break;
          bytes+=chunk.value.byteLength;if(bytes>100000)throw new Error('Quota response exceeds limit');
          text+=decoder.decode(chunk.value,{stream:true});
        }
        text+=decoder.decode();
      }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    }
    const body = JSON.parse(text);
    const field = (path: string) =>
      String(path)
        .split(".")
        .reduce((value, key) => value?.[key], body);
    const remaining = field(config.remainingPath ?? "remaining"),
      limit = field(config.limitPath ?? "limit"),
      reset = field(config.resetPath ?? "reset");
    if (
      !Number.isFinite(remaining) ||
      !Number.isFinite(limit) ||
      remaining < 0 ||
      limit < 0
    )
      throw new Error("Quota fields must be non-negative numbers");
    const value = {
      available: true,
      remaining,
      limit,
      reset: typeof reset === "string" ? reset : undefined,
      unit: String(config.unit ?? "tokens"),
      profile: name,
    };
    cached = { signature, fetcher, at: Date.now(), value };
    return { value };
  };
}
