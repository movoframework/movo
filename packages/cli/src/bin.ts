#!/usr/bin/env node
/**
 * The `movo` binary.
 *
 * Everything this file does beyond calling `run()` is process-shaped and therefore untestable
 * in-process: deciding whether stdout is a terminal, and setting an exit code. Keeping those two
 * lines here is what lets `run()` be driven directly by the test suite.
 */

import { run } from "./cli.js";
import { processContext } from "./commands/context.js";
import { createStyler } from "./render/style.js";

const style = createStyler({ env: process.env, isTTY: process.stdout.isTTY === true });

process.exitCode = await run(process.argv.slice(2), processContext(style));
