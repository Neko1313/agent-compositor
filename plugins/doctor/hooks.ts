// /doctor: environment + provider sanity report (Claude Code /doctor analog).
export default {
  "prompt.submit": async (event: { text: string }, $: any) => {
    if (event.text !== "/doctor") return;
    const lines: string[] = ["doctor report:"];
    for (const name of ["AGENT_BASE_URL", "AGENT_API_KEY", "AGENT_MODEL"]) {
      const v = process.env[name];
      lines.push(`- ${name}: ${v ? (name === "AGENT_API_KEY" ? `<set, ${v.length} chars>` : v) : "(unset — default)"}`);
    }
    const ping = await $.model
      .complete({ signal: $.signal, messages: [{ role: "user", content: "ping" }] })
      .then(() => "provider ping: OK")
      .catch((err: unknown) => `provider ping: FAIL (${err instanceof Error ? err.message : String(err)})`);
    lines.push(`- ${ping}`);
    await $.ui.notify(lines.join("\n"), "info");
    return { drop: "doctor: report delivered" };
  },
};
