/** Descriptive evidence only: these counters never change task grades or permissions. */
export function permissionDiagnostics(events: readonly any[]) {
  const calls = new Map<string, {tool: string; identity: string}>();
  const denied = new Map<string, string>();
  const denials: {eventIndex: number; callId: string; tool: string; matchedCall: boolean; previousIdenticalDeniedCallId?: string}[] = [];
  for (const [eventIndex, event] of events.entries()) {
    if (event.kind !== 'catalog') continue;
    if (event.event === 'session.start') {
      calls.clear();
      denied.clear();
    }
    const input = event.input;
    if (!input || input.operationId || typeof input.callId !== 'string') continue;
    if (event.event === 'tool.call') {
      calls.set(input.callId, {tool: input.tool, identity: canonical([input.tool, input.input])});
    } else if (event.event === 'tool.result') {
      const call = calls.get(input.callId);
      calls.delete(input.callId);
      if (input.denied !== true) continue;
      const matchedCall = !!call && call.tool === input.tool;
      const previous = matchedCall ? denied.get(call!.identity) : undefined;
      denials.push({eventIndex, callId: input.callId, tool: input.tool, matchedCall,
        ...(previous !== undefined ? {previousIdenticalDeniedCallId: previous} : {})});
      if (matchedCall) denied.set(call!.identity, input.callId);
    }
  }
  return {
    deniedCalls: denials.length,
    repeatedIdenticalDeniedCalls: denials.filter(row => row.previousIdenticalDeniedCallId !== undefined).length,
    unmatchedDeniedResults: denials.filter(row => !row.matchedCall).length,
    denials,
  };
}

// JSON object key order is irrelevant; command strings and all argument values remain exact.
function canonical(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value) ?? 'undefined';
}
