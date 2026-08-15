#!/usr/bin/env node
/**
 * The `create-movo-app` binary.
 */

import { runCreate } from "./index.js";

process.exitCode = runCreate(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
});
