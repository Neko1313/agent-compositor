// Private editing helpers. Public cursor offsets remain UTF-16 indices.
const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function previousGraphemeBoundary(text: string, cursor: number): number {
  return segments.segment(text).containing(Math.max(0, cursor - 1))?.index ?? 0;
}

export function nextGraphemeBoundary(text: string, cursor: number): number {
  const segment = segments.segment(text).containing(cursor);
  return segment ? segment.index + segment.segment.length : text.length;
}

// Round down so neither a length limit nor a cursor can bisect a grapheme.
export function floorGraphemeBoundary(text: string, cursor: number): number {
  return segments.segment(text).containing(Math.max(0, cursor))?.index ?? text.length;
}

export function truncateGraphemes(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, floorGraphemeBoundary(text, limit));
}
