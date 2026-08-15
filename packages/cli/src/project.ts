/**
 * Locating and loading a Movo project from disk.
 *
 * Every command needs the same three things — the project root, the configuration, and the app
 * — so they are resolved once, here, and every failure along the way produces a `MovoError`
 * with a fix rather than a stack trace out of the module loader. "Cannot find module
 * '/…/src/app.ts'" is technically accurate and tells a first-time user nothing.
 *
 * **Type stripping, not a build step.** The project's `movo.config.ts` and `src/app.ts` are
 * imported directly, relying on Node's native TypeScript support (≥22). This is what lets the
 * quickstart go from scaffold to running server with no compile between, and it is why
 * {@link MINIMUM_NODE_MAJOR} is a real floor rather than a recommendation.
 */

import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  type ConfigLayers,
  MINIMUM_NODE_MAJOR,
  type MovoApp,
  type MovoConfigInput,
  MovoError,
  nodeMajorOf,
  type ResolvedConfig,
  resolveConfig,
} from "@movoframework/core";

/** The configuration file name. Fixed, not configurable — one name to document (spec §5.13). */
export const CONFIG_FILENAME = "movo.config.ts";

/** Where the app module is looked for, in order. */
export const APP_CANDIDATES: readonly string[] = [
  "src/app.ts",
  "src/app.js",
  "app.ts",
  "src/index.ts",
];

/** A loaded project. */
export interface Project {
  /** Absolute path of the directory holding `movo.config.ts`. */
  readonly root: string;
  /** Absolute path of the configuration file. */
  readonly configPath: string;
  /** The configuration object the file exported. */
  readonly config: MovoConfigInput;
  /** The application, when one was found. */
  readonly app: MovoApp | undefined;
  /** Absolute path of the app module, when one was found. */
  readonly appPath: string | undefined;
  /** The configuration resolved across all five layers, with provenance. */
  readonly resolved: ResolvedConfig;
  /**
   * The exact layers {@link resolved} was produced from.
   *
   * Carried rather than reconstructed, because every later call that compiles or mounts must
   * use the same inputs. Rebuilding them from `process.env` produced a doctor run that reported
   * a missing `payTo` for a project whose `payTo` it had just printed.
   */
  readonly layers: ConfigLayers;
}

/** Options for {@link loadProject}. */
export interface LoadProjectOptions {
  /** Where to start looking. Defaults to the current working directory. */
  readonly cwd?: string;
  /** Environment for the `env` layer. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The highest-precedence layer, for values supplied as command-line arguments. */
  readonly argument?: MovoConfigInput;
  /** Skip loading the app module. `movo doctor` still works in a project that has none. */
  readonly requireApp?: boolean;
}

/**
 * Walk up from a directory looking for `movo.config.ts`.
 *
 * Walking up rather than requiring the command be run from the root, because being three
 * directories deep in `src/` is the normal state of working on a project.
 *
 * @param from - Directory to start from
 * @returns The directory containing the config file, or undefined
 */
export function findProjectRoot(from: string): string | undefined {
  let current = resolve(from);

  for (;;) {
    if (existsSync(join(current, CONFIG_FILENAME))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Assert the running Node can strip types, before a failure to do so surfaces as a syntax
 * error inside the user's own file.
 *
 * @param version - The running version, normally `process.version`
 */
export function assertNodeCanLoadTypeScript(version: string): void {
  const major = nodeMajorOf(version);
  if (major !== undefined && major >= MINIMUM_NODE_MAJOR) return;

  throw new MovoError(
    "MOVO_W_NODE_VERSION_UNSUPPORTED",
    `Node ${version} cannot run ${CONFIG_FILENAME} directly. Movo loads your configuration and app as TypeScript, using the type stripping built into Node ${String(MINIMUM_NODE_MAJOR)} and later.`,
    { context: { nodeVersion: version, minimumMajor: MINIMUM_NODE_MAJOR } },
  );
}

async function importModule(path: string): Promise<Record<string, unknown>> {
  try {
    return (await import(pathToFileURL(path).href)) as Record<string, unknown>;
  } catch (cause) {
    throw new MovoError(
      "MOVO_E_APP_INVALID",
      `Could not load ${path}.`,
      // The cause chain is where the real answer is — a missing dependency, a syntax error, a
      // failed top-level await. Dropping it would leave the reader with only this sentence.
      { context: { path }, cause },
    );
  }
}

/**
 * Pick the configuration object out of a loaded module.
 *
 * Both `export default` and `export const config` are accepted because both are natural and
 * neither is obviously more correct. The templates use the named form, since a file with two
 * meaningful exports reads better than one with a default and an afterthought.
 */
function configFrom(module: Record<string, unknown>, path: string): MovoConfigInput {
  const candidate = module["default"] ?? module["config"];

  if (typeof candidate !== "object" || candidate === null) {
    throw new MovoError("MOVO_E_APP_INVALID", `${path} does not export a configuration object.`, {
      context: { path, exports: Object.keys(module) },
    });
  }

  return candidate as MovoConfigInput;
}

function appFrom(module: Record<string, unknown>, path: string): MovoApp {
  const candidate = module["default"] ?? module["app"];

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !Array.isArray((candidate as { resources?: unknown }).resources)
  ) {
    throw new MovoError(
      "MOVO_E_APP_INVALID",
      `${path} does not export a Movo app. Expected \`export const app = defineApp({ resources: [...] })\` or a default export of the same.`,
      { context: { path, exports: Object.keys(module) } },
    );
  }

  return candidate as MovoApp;
}

/**
 * Load a project: find its root, import its configuration and app, and resolve configuration
 * across every layer.
 *
 * @param options - Where to look and which layers to supply
 * @returns The loaded project
 */
export async function loadProject(options?: LoadProjectOptions): Promise<Project> {
  assertNodeCanLoadTypeScript(process.version);

  const cwd = options?.cwd ?? process.cwd();
  const root = findProjectRoot(cwd);

  if (root === undefined) {
    throw new MovoError(
      "MOVO_E_APP_INVALID",
      `No ${CONFIG_FILENAME} found in ${resolve(cwd)} or any parent directory.`,
      { context: { searchedFrom: resolve(cwd) } },
    );
  }

  const configPath = join(root, CONFIG_FILENAME);
  const config = configFrom(await importModule(configPath), configPath);

  let app: MovoApp | undefined;
  let appPath: string | undefined;

  for (const candidate of APP_CANDIDATES) {
    const path = join(root, candidate);
    if (!existsSync(path)) continue;
    appPath = path;
    app = appFrom(await importModule(path), path);
    break;
  }

  if (app === undefined && options?.requireApp === true) {
    throw new MovoError(
      "MOVO_E_APP_INVALID",
      `No app module found in ${root}. Looked for ${APP_CANDIDATES.join(", ")}.`,
      { context: { root, candidates: APP_CANDIDATES } },
    );
  }

  const layers: ConfigLayers = {
    config,
    env: options?.env ?? process.env,
    ...(options?.argument === undefined ? {} : { argument: options.argument }),
  };

  return {
    root,
    configPath,
    config,
    app,
    appPath,
    layers,
    resolved: resolveConfig(layers),
  };
}

/**
 * Resolve a path argument against the working directory.
 *
 * @param path - A relative or absolute path
 * @param cwd - The base directory
 * @returns An absolute path
 */
export function absolute(path: string, cwd: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}
