#!/usr/bin/env node
// Thin wrapper that runs the migration helper from the consuming site's cwd.
// The script does its own argument handling and prints its own status.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await import(path.resolve(__dirname, '..', 'scripts', 'migrate-image-variants.mjs'));
