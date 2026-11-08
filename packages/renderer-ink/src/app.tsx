import React, { useEffect, useReducer } from "react";
import { Box, Text, useInput, useStdin } from "ink";
import type { InputData } from "./keys.js";
import { mapKey } from "./keys.js";
import type { RendererStore } from "./run.js";
import type { Segment } from "./grid.js";
import type { StyledCell } from "./cell.js";
import type { SurfaceDecl } from "./state.js";

/** Ink Text props from a segment style. `inverse` is renderer-local (cursor). */
function styleProps(style: Omit<StyledCell, "ch">) {
  return {
    ...(style.fg ? { color: style.fg } : {}),
    ...(style.bg ? { backgroundColor: style.bg } : {}),
    ...(style.bold ? { bold: true } : {}),
    ...(style.dim ? { dimColor: true } : {}),
    ...(style.italic ? { italic: true } : {}),
    ...(style.underline ? { underline: true } : {}),
    ...(style.inverse ? { inverse: true } : {}),
  };
}

function SegmentRow({ segments, height }: { segments: Segment[]; height: number }) {
  return (
    <Box flexDirection="row" height={height}>
      {segments.map((s, i) => (
        <Text key={i} {...styleProps(s.style)}>
          {s.text}
        </Text>
      ))}
    </Box>
  );
}

function SurfaceView({
  decl,
  store,
  focused,
}: {
  decl: SurfaceDecl;
  store: RendererStore;
  focused: boolean;
}) {
  const grid = store.state.grid(decl.id);
  if (!grid) return null;
  const isBar = decl.kind === "status-bar";
  const lines = grid.height;
  return (
    <Box
      flexDirection="column"
      borderStyle={isBar ? undefined : "round"}
      borderColor={focused ? "cyan" : isBar ? undefined : "gray"}
    >
      {!isBar && decl.title ? <Text bold>{decl.title}</Text> : null}
      {Array.from({ length: lines }, (_, row) => (
        <SegmentRow
          key={row}
          segments={grid.segments(row, grid.cursor)}
          height={1}
        />
      ))}
    </Box>
  );
}

/**
 * The Ink application: subscribes to the store, draws all declared surfaces,
 * turns keystrokes into input data for the focused surface.
 */
export function RendererApp({
  store,
  onKey,
}: {
  store: RendererStore;
  onKey: (surface: string, data: InputData) => void;
}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => store.subscribe(bump), [store]);

  const { isRawModeSupported } = useStdin();
  if (isRawModeSupported) {
    // conditional: useInput throws when stdin has no raw mode (pipes, CI)
    useInput((input, key) => {
      if (key.ctrl && input === "c") return; // exit is the host's decision (run loop handles it)
      const data = mapKey(input, key);
      const surface = store.state.focused;
      if (data && surface) onKey(surface, data);
    });
  }

  const surfaces = store.state.surfaceList();
  return (
    <>
      {surfaces.map((decl) => (
        <SurfaceView
          key={decl.id}
          decl={decl}
          store={store}
          focused={store.state.focused === decl.id}
        />
      ))}
      {surfaces.length === 0 ? <Text dimColor>waiting for surfaces…</Text> : null}
    </>
  );
}
