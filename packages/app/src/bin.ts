#!/usr/bin/env node
import { main } from "./main.js";

let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
const exitCode = () => interrupted === 'SIGINT' ? 130 : interrupted === 'SIGTERM' ? 143 : undefined;

main({}, cancel => {
  // Only the parsed headless branch activates these handlers. Interactive
  // renderers retain their existing terminal and process-signal ownership.
  const stop = (name: 'SIGINT' | 'SIGTERM') => {
    if (interrupted) return;
    interrupted = name;
    cancel(new Error('Interrupted by ' + name));
  };
  const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt);process.on('SIGTERM', terminate);
  return () => {process.off('SIGINT', interrupt);process.off('SIGTERM', terminate);};
}).then(
  (code) => {
    process.exitCode = exitCode() ?? code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = exitCode() ?? 1;
  },
);
