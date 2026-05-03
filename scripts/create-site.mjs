import { runScaffold } from './scaffold.mjs';

const result = await runScaffold({
  kind: 'site',
  argv: process.argv.slice(2),
});

if (result.message) {
  process[result.ok ? 'stdout' : 'stderr'].write(result.message + '\n');
}
process.exit(result.ok ? 0 : 1);
