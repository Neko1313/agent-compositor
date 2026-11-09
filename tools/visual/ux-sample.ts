/** Print-only approval fixture. The browser scenario always denies this action. */
export const uxCommand = `printf 'PREFIX_REVIEW ${Array.from({ length: 100 }, (_, i) => `argument-${i}`).join(" ")} SUFFIX_REVIEW'`;
export const uxTool = {
  id: "ux-permission-review",
  name: "exec",
  args: { command: uxCommand },
};
export function uxReply(messages: any[]): string | undefined {
  return messages.some((message) => message.role === "tool")
    ? "Permission review complete."
    : undefined;
}
