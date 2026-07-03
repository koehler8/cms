#!/usr/bin/env node
// Thin wrapper that runs the memory-bounded SSG build orchestrator from the
// consuming site's cwd. The script does its own argument handling, spawns the
// per-shard `vite-ssg build` processes, and prints its own status.
// See scripts/ssg-build/index.mjs and SSG-MEMORY-PLAN.md.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await import(path.resolve(__dirname, '..', 'scripts', 'ssg-build', 'index.mjs'));
