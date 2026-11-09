// Explicit installation only. Loading the plugin never downloads or executes installers.
import { fileURLToPath } from 'node:url';
import { installCallix } from './distribution.mjs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--archive')) throw new Error('Usage: node install.mjs [--archive /path/to/release.tar.gz]');
const destination = fileURLToPath(new URL('./', import.meta.url));
const release = await installCallix({ destination, archivePath: args[1] });
console.log(`Installed verified Callix ${release.version}: ${destination}bin/callix`);
