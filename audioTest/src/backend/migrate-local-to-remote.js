const fsp = require("node:fs/promises");
const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(PROJECT_ROOT, "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const REMOTE_BASE_URL = String(process.env.REMOTE_BASE_URL || "https://braggadocian-osteometrical-petronila.ngrok-free.dev").trim().replace(/\/+$/g, "");
const REMOTE_SESSION_PATH = String(process.env.REMOTE_SESSION_PATH || "/api/session").trim() || "/api/session";
const REMOTE_AUDIO_PATH = String(process.env.REMOTE_AUDIO_PATH || "/api/audio").trim() || "/api/audio";

function decodeBase64(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    return Buffer.alloc(0);
  }
  const marker = "base64,";
  const markerIndex = value.indexOf(marker);
  const base64 = markerIndex >= 0 ? value.slice(markerIndex + marker.length) : value;
  return Buffer.from(base64, "base64");
}

async function main() {
  if (!REMOTE_BASE_URL) {
    throw new Error("REMOTE_BASE_URL is required");
  }

  let entries = [];
  try {
    entries = await fsp.readdir(SESSIONS_DIR, { withFileTypes: true });
  } catch (error) {
    if (error && error.code !== "ENOENT") {
      throw error;
    }
  }

  const sessionFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(SESSIONS_DIR, entry.name));

  const stats = {
    scanned: sessionFiles.length,
    migrated: 0,
    skipped: 0,
    failed: 0,
    failures: []
  };

  for (const filePath of sessionFiles) {
    const raw = await fsp.readFile(filePath, "utf8");
    if (!raw.trim()) {
      stats.skipped += 1;
      continue;
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      stats.failed += 1;
      stats.failures.push({ filePath, reason: "invalid_json", detail: String(error && error.message ? error.message : error) });
      continue;
    }

    if (!payload || typeof payload !== "object" || !payload.file || !payload.playback || !payload.audioBase64) {
      stats.skipped += 1;
      continue;
    }

    const audioBuffer = decodeBase64(payload.audioBase64);
    if (!audioBuffer.length) {
      stats.skipped += 1;
      continue;
    }

    const audioQuery = new URLSearchParams();
    audioQuery.set("name", payload.file && payload.file.name ? String(payload.file.name) : "audio.bin");
    audioQuery.set("type", payload.file && payload.file.type ? String(payload.file.type) : "application/octet-stream");
    if (payload.file && payload.file.lastModified) {
      audioQuery.set("lastModified", String(payload.file.lastModified));
    }

    const uploadResponse = await fetch(REMOTE_BASE_URL + REMOTE_AUDIO_PATH + "?" + audioQuery.toString(), {
      method: "POST",
      headers: {
        "Content-Type": payload.file && payload.file.type ? String(payload.file.type) : "application/octet-stream"
      },
      body: audioBuffer
    });
    const uploadText = await uploadResponse.text();
    let uploadParsed = {};
    try {
      uploadParsed = uploadText ? JSON.parse(uploadText) : {};
    } catch {
      uploadParsed = { raw: uploadText };
    }
    if (!uploadResponse.ok || !uploadParsed.ok || !uploadParsed.audio || !uploadParsed.audio.id) {
      stats.failed += 1;
      stats.failures.push({ filePath, reason: "remote_audio_upload_failed", status: uploadResponse.status, detail: uploadParsed });
      continue;
    }

    const response = await fetch(REMOTE_BASE_URL + REMOTE_SESSION_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: payload.id,
        file: payload.file,
        playback: payload.playback,
        audioId: uploadParsed.audio.id
      })
    });

    const text = await response.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }

    if (!response.ok || !parsed.ok) {
      stats.failed += 1;
      stats.failures.push({ filePath, reason: "remote_save_failed", status: response.status, detail: parsed });
      continue;
    }

    stats.migrated += 1;
  }

  console.log(JSON.stringify(stats, null, 2));
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
