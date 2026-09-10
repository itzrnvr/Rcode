import { homedir } from "node:os";
import { join } from "node:path";

export const RCODE_HOME = process.env.RCODE_HOME ?? join(homedir(), ".rcode");
export const APP_DATA_DIR = join(RCODE_HOME, "data");
export const TRACES_DIR = join(RCODE_HOME, "traces");
export const FEEDBACK_DIR = join(RCODE_HOME, "feedback");
export const ELECTRON_PROFILE_DIR = join(RCODE_HOME, "electron");

export const LEGACY_APP_DATA_ROOT = join(
  process.env.APPDATA ?? join(homedir(), ".config"),
  "Rcode",
);
