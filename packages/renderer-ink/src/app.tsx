import React, { useEffect, useReducer } from "react";
import { Box, Text, useInput, useStdin, useApp } from "ink";
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
  width, height, drop, controls, chrome, hovered,
}: {
  decl: SurfaceDecl;
  store: RendererStore;
  focused: boolean;
  width?: number; height?: number; drop?: string; controls?: boolean; hovered?: boolean;
  chrome?: NonNullable<RendererStore["state"]["layout"]>["frames"][number]["chrome"];
}) {
  const grid = store.state.grid(decl.id);
  if (!grid) return null;
  const isBar = decl.kind === "status-bar";
  const lines = grid.height;
  return (
    <Box
      flexDirection="column" width={width} height={height} overflow="hidden"
      borderStyle={isBar ? undefined : chrome?.borderStyle ?? "single"}
      borderColor={drop ? chrome?.warning ?? "yellow" : focused ? chrome?.accent ?? "cyan" : chrome?.border ?? "gray"}
    >
      {!isBar && decl.title ? <Box height={1} flexDirection="row">
        <Box flexGrow={1} flexShrink={1} overflow="hidden"><Text bold={focused} color={focused ? chrome?.accent : chrome?.muted}
          backgroundColor={chrome?.titleBackground} wrap="truncate">{` ${drop ? `Drop ${drop === "center" ? "to swap" : drop} · ${decl.title}` : decl.title}`.padEnd(Math.max(0, (width ?? 0) - (controls ? 8 : 2)))}</Text></Box>
        {controls && (width ?? 0) >= 14 ? <Text color={focused ? chrome?.accent ?? "cyan" : chrome?.muted ?? "gray"}
          backgroundColor={chrome?.titleBackground}>{focused || hovered || chrome?.controls !== "focus" ? "[F][x]" : "      "}</Text> : null}
      </Box> : null}
      <Box flexDirection="column" paddingX={isBar || decl.id === "plugin-placement" ? 0 : 1}>
      {Array.from({ length: lines }, (_, row) => (
        <SegmentRow
          key={row}
          segments={grid.segments(row, grid.cursor)}
          height={1}
        />
      ))}
      </Box>
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
  const { suspendTerminal } = useApp();
  useEffect(() => { store.suspend = suspendTerminal; return () => { store.suspend = undefined; }; }, [store, suspendTerminal]);
  useEffect(() => store.subscribe(bump), [store]);

  const { isRawModeSupported } = useStdin();
  if (isRawModeSupported) {
    // conditional: useInput throws when stdin has no raw mode (pipes, CI)
    useInput((input, key) => {
      const data = mapKey(input, key);
      const surface = store.state.focused;
      if (data && surface) onKey(surface, data);
    });
  }

  const surfaces = store.state.surfaceList();
  const layout = store.state.layout;
  if (layout) return <Box position="relative" width={layout.width} height={layout.height}>
    {layout.frames.map(frame => {
      const decl = store.state.surfaces.get(frame.surface);
      return decl ? <Box key={frame.surface} position="absolute" marginLeft={frame.x} marginTop={frame.y} width={frame.width} height={frame.height}>
        <SurfaceView decl={decl} store={store} focused={store.state.focused === frame.surface} width={frame.width} height={frame.height} drop={frame.drop} controls={frame.controls} chrome={frame.chrome} hovered={frame.hovered} />
      </Box> : null;
    })}
  </Box>;
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
