const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const MGMT_DIR = path.join(PROJECT_ROOT, "mgmt");
const LOGS_DIR = path.join(MGMT_DIR, "logs");
const PUBLIC_DIR = path.join(PROJECT_ROOT, "src", "public");
const FRONTEND_DIR = path.join(PROJECT_ROOT, "src", "frontend");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const AUDIO_DIR = path.join(DATA_DIR, "audio");
const SESSION_PATH = path.join(DATA_DIR, "session-latest.json");
const PORT = Number(process.env.PORT || 8787);
const MAX_BODY_SIZE = 1024 * 1024 * 500;
const LOGIN_IDLE_TIMEOUT_DISABLED = /^(1|true|yes|on)$/i.test(String(process.env.DISABLE_LOGIN_IDLE_TIMEOUT || ""));
const LOGIN_TTL_MS_VALUE = Number(process.env.LOGIN_IDLE_TTL_MS ?? (5 * 60 * 1000));
const LOGIN_TTL_MS = LOGIN_IDLE_TIMEOUT_DISABLED ? 0 : (Number.isFinite(LOGIN_TTL_MS_VALUE) ? LOGIN_TTL_MS_VALUE : (5 * 60 * 1000));
const STORAGE_PROVIDER = String(process.env.SESSION_STORE || "local").trim().toLowerCase();
const REMOTE_BASE_URL = String(process.env.REMOTE_BASE_URL || "https://braggadocian-osteometrical-petronila.ngrok-free.dev").trim().replace(/\/+$/g, "");
const REMOTE_TIMEOUT_MS = Number(process.env.REMOTE_TIMEOUT_MS || 60000);
const REMOTE_SESSIONS_PATH = String(process.env.REMOTE_SESSIONS_PATH || "/api/sessions").trim() || "/api/sessions";
const REMOTE_SESSION_PATH = String(process.env.REMOTE_SESSION_PATH || "/api/session").trim() || "/api/session";
const REMOTE_AUDIO_PATH = String(process.env.REMOTE_AUDIO_PATH || "/api/audio").trim() || "/api/audio";
const IS_REMOTE_STORAGE = STORAGE_PROVIDER === "remote" || STORAGE_PROVIDER === "ngrok";
const USER_CREDENTIALS = {
  zhaoying: String(process.env.USER_PASSWORD_ZHAOYING || "zhaoying123"),
  rhys: String(process.env.USER_PASSWORD_RHYS || "rhys123")
};

module.exports = {
  PROJECT_ROOT,
  MGMT_DIR,
  LOGS_DIR,
  PUBLIC_DIR,
  FRONTEND_DIR,
  DATA_DIR,
  SESSIONS_DIR,
  AUDIO_DIR,
  SESSION_PATH,
  PORT,
  MAX_BODY_SIZE,
  LOGIN_IDLE_TIMEOUT_DISABLED,
  LOGIN_TTL_MS,
  STORAGE_PROVIDER,
  REMOTE_BASE_URL,
  REMOTE_TIMEOUT_MS,
  REMOTE_SESSIONS_PATH,
  REMOTE_SESSION_PATH,
  REMOTE_AUDIO_PATH,
  IS_REMOTE_STORAGE,
  USER_CREDENTIALS
};
