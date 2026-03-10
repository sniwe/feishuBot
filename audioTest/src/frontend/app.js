(function () {
  const input = document.getElementById("audio-file");
  const fileName = document.getElementById("file-name");
  const audio = document.getElementById("audio");
  const progress = document.getElementById("progress");
  const selectedSpanOverlay = document.getElementById("selected-span-overlay");
  const checkpointMarkers = document.getElementById("checkpoint-markers");
  const playhead = document.getElementById("playhead");
  const playheadTime = document.getElementById("playhead-time");

  const SESSION_DB_NAME = "audioTestSessions";
  const SESSION_STORE = "sessions";
  const SESSION_KEY = "latest";

  let objectUrl = null;
  let currentFile = null;
  let checkpoints = [];
  let selectedSpanIndex = -1;

  input.addEventListener("change", handleFileChange);
  audio.addEventListener("loadedmetadata", refreshProgressVisuals);
  audio.addEventListener("timeupdate", refreshProgressVisuals);
  audio.addEventListener("durationchange", refreshProgressVisuals);
  document.addEventListener("keydown", handleKeyDown);

  restoreSessionOnLaunch();

  function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    currentFile = file;
    objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
    fileName.textContent = file.name;
    checkpoints = [];
    selectedSpanIndex = -1;
    renderCheckpointMarkers();
    refreshProgressVisuals();
  }

  function handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
      event.preventDefault();
      if (audio.src) {
        saveSessionState().catch(function () {});
      }
      return;
    }

    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    if (!audio.src) {
      return;
    }

    if ((event.code === "ArrowRight" || event.code === "ArrowLeft") && event.ctrlKey && getCheckpointSeries().length > 1) {
      event.preventDefault();
      cycleSpanSelection(event.code === "ArrowRight" ? 1 : -1);
      return;
    }

    if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
      event.preventDefault();
      seekBy(event.code === "ArrowRight" ? 5 : -5);
      return;
    }

    if (event.code !== "Space") {
      return;
    }

    event.preventDefault();

    if (event.shiftKey) {
      dropCheckpoint();
      return;
    }

    if (audio.paused) {
      audio.play().catch(function () {});
    } else {
      audio.pause();
    }
  }

  function dropCheckpoint() {
    const seconds = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    checkpoints.push(seconds);
    checkpoints.sort(function (a, b) { return a - b; });
    selectedSpanIndex = -1;
    renderCheckpointMarkers();
    renderSelectedSpanOverlay();
  }

  function cycleSpanSelection(step) {
    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;
    if (spanCount <= 0) {
      return;
    }

    if (selectedSpanIndex < 0 || selectedSpanIndex >= spanCount) {
      selectedSpanIndex = step > 0 ? 0 : spanCount - 1;
    } else {
      selectedSpanIndex = (selectedSpanIndex + step + spanCount) % spanCount;
    }

    audio.currentTime = allCheckpoints[selectedSpanIndex];
    refreshProgressVisuals();
    renderCheckpointMarkers();
    renderSelectedSpanOverlay();
  }

  function seekBy(deltaSeconds) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;

    if (selectedSpanIndex >= 0 && selectedSpanIndex < spanCount) {
      const spanStart = allCheckpoints[selectedSpanIndex];
      const spanEnd = allCheckpoints[selectedSpanIndex + 1];
      const spanLength = spanEnd - spanStart;

      if (spanLength > 0) {
        let offset = (current + deltaSeconds) - spanStart;
        offset = ((offset % spanLength) + spanLength) % spanLength;
        audio.currentTime = spanStart + offset;
      }
    } else {
      const next = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, current + deltaSeconds));
      audio.currentTime = next;
    }

    refreshProgressVisuals();
    renderCheckpointMarkers();
    renderSelectedSpanOverlay();
  }

  function renderCheckpointMarkers() {
    checkpointMarkers.innerHTML = "";
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration <= 0) {
      return;
    }

    getCheckpointSeries().forEach(function (seconds) {
      const marker = document.createElement("span");
      marker.className = "checkpoint-marker";
      const percent = Math.max(0, Math.min(100, (seconds / duration) * 100));
      marker.style.left = String(percent) + "%";

      const tag = document.createElement("span");
      tag.className = "checkpoint-tag";
      tag.textContent = formatTime(seconds);
      marker.appendChild(tag);

      checkpointMarkers.appendChild(marker);
    });
  }

  function renderSelectedSpanOverlay() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;
    if (duration <= 0 || selectedSpanIndex < 0 || selectedSpanIndex >= spanCount) {
      selectedSpanOverlay.style.display = "none";
      return;
    }

    const start = allCheckpoints[selectedSpanIndex];
    const end = allCheckpoints[selectedSpanIndex + 1];
    const startPercent = Math.max(0, Math.min(100, (start / duration) * 100));
    const endPercent = Math.max(0, Math.min(100, (end / duration) * 100));

    selectedSpanOverlay.style.display = "block";
    selectedSpanOverlay.style.left = String(startPercent) + "%";
    selectedSpanOverlay.style.width = String(Math.max(0, endPercent - startPercent)) + "%";
  }

  function refreshProgressVisuals() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    let current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;
    if (selectedSpanIndex >= 0 && selectedSpanIndex < spanCount) {
      const spanStart = allCheckpoints[selectedSpanIndex];
      const spanEnd = allCheckpoints[selectedSpanIndex + 1];
      if (spanEnd > spanStart && (current < spanStart || current >= spanEnd)) {
        const epsilon = Math.min(0.02, (spanEnd - spanStart) / 4);
        const loopTime = current < spanStart ? Math.max(spanStart, spanEnd - epsilon) : spanStart;
        audio.currentTime = loopTime;
        current = loopTime;
      }
    }

    if (duration > 0) {
      progress.value = Math.min(1000, Math.round((current / duration) * 1000));
    } else {
      progress.value = 0;
    }

    const percent = duration > 0 ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
    progress.style.setProperty("--progress-pct", String(percent) + "%");
    playhead.style.left = String(percent) + "%";
    playheadTime.textContent = formatTime(current);

    renderCheckpointMarkers();
    renderSelectedSpanOverlay();
  }

  function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function getCheckpointSeries() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration <= 0) {
      return [];
    }

    const points = [0].concat(checkpoints).concat([duration]).sort(function (a, b) { return a - b; });
    const deduped = [];
    points.forEach(function (point) {
      if (!deduped.length || Math.abs(point - deduped[deduped.length - 1]) > 0.01) {
        deduped.push(point);
      }
    });
    return deduped;
  }

  async function saveSessionState() {
    if (!window.indexedDB || !audio.src || !currentFile) {
      return;
    }

    const db = await openSessionDb();
    const payload = {
      id: SESSION_KEY,
      savedAt: new Date().toISOString(),
      file: {
        name: currentFile.name,
        type: currentFile.type,
        size: currentFile.size,
        lastModified: currentFile.lastModified
      },
      playback: {
        checkpoints: checkpoints.slice(),
        selectedSpanIndex: selectedSpanIndex,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        wasPlaying: !audio.paused
      },
      audioBlob: currentFile
    };

    await putSessionRecord(db, payload);
  }

  async function restoreSessionOnLaunch() {
    if (!window.indexedDB) {
      return;
    }

    try {
      const db = await openSessionDb();
      const saved = await getSessionRecord(db, SESSION_KEY);
      if (!saved || !saved.audioBlob) {
        return;
      }
      applySavedSession(saved);
    } catch {
      // Ignore corrupted or unavailable stored session.
    }
  }

  function applySavedSession(saved) {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }

    const savedFile = saved.file || {};
    const savedPlayback = saved.playback || {};
    const blobType = savedFile.type || saved.audioBlob.type || "audio/*";

    currentFile = new File([saved.audioBlob], savedFile.name || "restored-audio", {
      type: blobType,
      lastModified: savedFile.lastModified || Date.now()
    });

    objectUrl = URL.createObjectURL(saved.audioBlob);
    audio.src = objectUrl;
    fileName.textContent = savedFile.name || "Restored audio";

    checkpoints = Array.isArray(savedPlayback.checkpoints)
      ? savedPlayback.checkpoints.filter(function (v) { return Number.isFinite(v) && v >= 0; }).sort(function (a, b) { return a - b; })
      : [];

    selectedSpanIndex = Number.isInteger(savedPlayback.selectedSpanIndex) ? savedPlayback.selectedSpanIndex : -1;
    const resumeTime = Number.isFinite(savedPlayback.currentTime) ? savedPlayback.currentTime : 0;
    const shouldResumePlayback = Boolean(savedPlayback.wasPlaying);

    audio.addEventListener("loadedmetadata", function handleRestoreMetadata() {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      audio.currentTime = Math.max(0, Math.min(duration || resumeTime, resumeTime));
      refreshProgressVisuals();
      if (shouldResumePlayback) {
        audio.play().catch(function () {});
      }
    }, { once: true });

    renderCheckpointMarkers();
    renderSelectedSpanOverlay();
    refreshProgressVisuals();
  }

  function openSessionDb() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(SESSION_DB_NAME, 1);
      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          db.createObjectStore(SESSION_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function getSessionRecord(db, id) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(SESSION_STORE, "readonly");
      const store = tx.objectStore(SESSION_STORE);
      const request = store.get(id);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function putSessionRecord(db, record) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(SESSION_STORE, "readwrite");
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
      tx.objectStore(SESSION_STORE).put(record);
    });
  }

  window.addEventListener("beforeunload", function () {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  });
})();
