const { AUDIO_DIR } = require("./config");
const { normalizeUsername } = require("./auth");
const { buildSessionId, normalizeSessionId } = require("./session-store");

function getAudioBinaryPath(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  return deps.path.join(AUDIO_DIR, String(audioId) + ".bin");
}

function getAudioMetadataPath(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  return deps.path.join(AUDIO_DIR, String(audioId) + ".json");
}

async function saveLocalAudioFromBase64(ctx) {
  const { data, deps } = ctx;
  const { payload, owner } = data;
  const base64 = String(payload.audioBase64 || "");
  const marker = "base64,";
  const markerIndex = base64.indexOf(marker);
  const raw = markerIndex >= 0 ? base64.slice(markerIndex + marker.length) : base64;
  const buffer = Buffer.from(raw, "base64");
  const audioId = buildSessionId({ data: { fileName: payload.file && payload.file.name }, deps: {} });
  const binaryPath = getAudioBinaryPath({ data: { audioId }, deps: { path: deps.path } });
  const metadataPath = getAudioMetadataPath({ data: { audioId }, deps: { path: deps.path } });
  await deps.fsp.mkdir(AUDIO_DIR, { recursive: true });
  await deps.fsp.writeFile(binaryPath, buffer);
  await deps.fsp.writeFile(metadataPath, JSON.stringify({
    id: audioId,
    owner: normalizeUsername({ data: { username: owner }, deps: {} }),
    fileName: payload.file && payload.file.name ? String(payload.file.name) : "audio.bin",
    mimeType: payload.file && payload.file.type ? String(payload.file.type) : "application/octet-stream",
    size: buffer.length,
    lastModified: payload.file && Number.isFinite(Number(payload.file.lastModified)) ? Number(payload.file.lastModified) : Date.now(),
    savedAt: new Date().toISOString()
  }, null, 2), "utf8");
  return { id: audioId };
}

async function readAudioMetadata(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  const safeId = normalizeSessionId({ data: { sessionId: audioId }, deps: {} });
  if (!safeId) {
    return null;
  }
  const metadataPath = getAudioMetadataPath({ data: { audioId: safeId }, deps: { path: deps.path } });
  try {
    const raw = await deps.fsp.readFile(metadataPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function deleteAudioById(ctx) {
  const { data, deps } = ctx;
  const { audioId } = data;
  const safeId = normalizeSessionId({ data: { sessionId: audioId }, deps: {} });
  if (!safeId) {
    return;
  }
  const metadataPath = getAudioMetadataPath({ data: { audioId: safeId }, deps: { path: deps.path } });
  const binaryPath = getAudioBinaryPath({ data: { audioId: safeId }, deps: { path: deps.path } });
  await deps.fsp.unlink(metadataPath).catch(function () {});
  await deps.fsp.unlink(binaryPath).catch(function () {});
}

module.exports = {
  getAudioBinaryPath,
  getAudioMetadataPath,
  saveLocalAudioFromBase64,
  readAudioMetadata,
  deleteAudioById
};
