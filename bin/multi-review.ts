#!/usr/bin/env node

import { run } from '../src/cli.js';

run(process.argv).catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
