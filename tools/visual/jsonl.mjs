// A concurrent writer may leave the final record incomplete until its newline.
export function completeJsonLines(text) {
  const lines = text.split('\n');
  lines.pop();
  return lines.filter(Boolean).map(JSON.parse);
}
