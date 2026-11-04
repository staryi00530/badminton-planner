#!/usr/bin/env node
// Node 22+ ships an experimental native localStorage/sessionStorage global that shadows
// jsdom's Storage implementation in vitest's jsdom test environment (it's missing methods
// like .clear()). --no-experimental-webstorage fixes that, but the flag doesn't exist on
// older Node (e.g. CI's Node 20) and NODE_OPTIONS rejects unrecognized flags at startup —
// so only apply it on Node versions that actually have it.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
const needsWebstorageFix = nodeMajor >= 22;

const env = { ...process.env };
if (needsWebstorageFix) {
  env.NODE_OPTIONS = [env.NODE_OPTIONS, '--no-experimental-webstorage'].filter(Boolean).join(' ');
}

const vitestArgs = process.argv.slice(2);
const vitestPath = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const result = spawnSync(process.execPath, [vitestPath, ...vitestArgs], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
