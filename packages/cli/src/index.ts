/**
 * `@movoframework/cli` — the `movo` command line interface.
 *
 * The library surface is exported as well as the binary, because the tests drive the commands
 * directly and because a project embedding `movo doctor` in its own tooling should not have to
 * spawn a process and parse text to do it.
 *
 * **No check logic lives in this package.** Every check `movo doctor` runs is an export of
 * `@movoframework/core`, `@movoframework/stellar` or `@movoframework/bazaar`; this package
 * sequences them, decides an exit code from them, and renders them. That split is M5's
 * architectural rule, and `doctor-composes-libraries.test.ts` asserts it rather than trusting
 * the reading.
 */

export { run, VERSION } from "./cli.js";
export {
  type BazaarOptions,
  bazaarList,
  bazaarSearch,
  bazaarValidate,
  describeOutcome,
} from "./commands/bazaar.js";
export { type CommandContext, processContext } from "./commands/context.js";
export {
  assertFacilitatorAllowed,
  type DevOptions,
  devCommand,
  FACILITATOR_MODES,
  type FacilitatorMode,
  renderBanner,
} from "./commands/dev.js";
export { type DoctorJson, type DoctorOptions, doctorCommand, toJson } from "./commands/doctor.js";
export { resolveVitest, SETUP_MODULE, testCommand } from "./commands/test.js";
export {
  createDevFacilitator,
  DEFAULT_DEV_PORT,
  FACILITATOR_MODE_ENV,
  PORT_ENV,
} from "./dev-runner.js";
export {
  collectPinComparisons,
  findCompatibilityMatrix,
  installedVersion,
  parseDocumentedPins,
  X402_PACKAGES,
} from "./doctor/pins.js";
export {
  DOCTOR_CHECK_IDS,
  type DoctorReport,
  exceedsThreshold,
  type FindingGroup,
  type RunDoctorOptions,
  runDoctor,
} from "./doctor/run.js";
export {
  APP_CANDIDATES,
  absolute,
  assertNodeCanLoadTypeScript,
  CONFIG_FILENAME,
  findProjectRoot,
  type LoadProjectOptions,
  loadProject,
  type Project,
} from "./project.js";
export { renderMovoError, renderUnknownError } from "./render/error.js";
export {
  type ConfigRow,
  configRows,
  HIDDEN_CREDENTIAL,
  renderConfig,
  renderFindings,
  UNSET,
} from "./render/findings.js";
export {
  createStyler,
  plainStyler,
  type StyleEnvironment,
  type Styler,
  shouldColour,
} from "./render/style.js";
export { type Row, renderTable } from "./render/table.js";
