#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(__dirname, '..', 'scripts', 'validate-themes.mjs');
await import(pathToFileURL(scriptPath).href);
