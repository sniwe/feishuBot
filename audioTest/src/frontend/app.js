(function () {
  const libraryView = document.getElementById("library-view");
  const playerView = document.getElementById("player-view");
  const uploadButton = document.getElementById("upload-button");
  const backButton = document.getElementById("back-button");
  const input = document.getElementById("audio-file");
  const cards = document.getElementById("audio-cards");
  const emptyState = document.getElementById("empty-state");
  const fileName = document.getElementById("file-name");
  const audio = document.getElementById("audio");
  const progress = document.getElementById("progress");
  const selectedSpanOverlay = document.getElementById("selected-span-overlay");
  const checkpointMarkers = document.getElementById("checkpoint-markers");
  const playhead = document.getElementById("playhead");
  const playheadTime = document.getElementById("playhead-time");

  const state = {
    objectUrl: null,
    currentFile: null,
    checkpoints: [],
    selectedSpanIndex: -1,
    markerSignature: "",
    isPlayerVisible: false,
    activeSessionId: null
  };

  input.addEventListener("change", handleFileChange);
  uploadButton.addEventListener("click", openFilePicker);
  backButton.addEventListener("click", goBackToLibrary);
  audio.addEventListener("loadedmetadata", updateUi);
  audio.addEventListener("timeupdate", updateUi);
  audio.addEventListener("durationchange", updateUi);
  document.addEventListener("keydown", handleKeyDown);

  initialize();

  async function initialize() {
    fileName.textContent = "";
    showLibraryView();
    await loadPersistedAudioCards();
  }

  function openFilePicker() {
    input.value = "";
    input.click();
  }

  async function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    state.activeSessionId = null;
    setAudioSource({ data: { file, displayName: file.name }, deps: {} });
    resetPlaybackState();
    showPlayerView();
    updateUi();
  }

  function handleKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.code === "Backspace") {
      if (state.isPlayerVisible) {
        event.preventDefault();
        goBackToLibrary();
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
      event.preventDefault();
      if (state.isPlayerVisible && audio.src) {
        saveSessionState().catch(function () {});
      }
      return;
    }

    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    if (!state.isPlayerVisible || !audio.src) {
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

  function showLibraryView() {
    libraryView.classList.remove("hidden");
    playerView.classList.add("hidden");
    state.isPlayerVisible = false;
  }

  function showPlayerView() {
    libraryView.classList.add("hidden");
    playerView.classList.remove("hidden");
    state.isPlayerVisible = true;
  }

  function goBackToLibrary() {
    if (!audio.paused) {
      audio.pause();
    }
    showLibraryView();
  }

  async function loadPersistedAudioCards() {
    try {
      const response = await fetch("/api/sessions", {
        method: "GET",
        cache: "no-store"
      });

      if (response.status === 404) {
        renderAudioCards([]);
        return;
      }

      if (!response.ok) {
        throw new Error("session_list_failed");
      }

      const payload = await response.json();
      const sessions = payload && Array.isArray(payload.sessions) ? payload.sessions : [];
      renderAudioCards(sessions);
    } catch {
      renderAudioCards([]);
    }
  }

  function renderAudioCards(sessions) {
    cards.innerHTML = "";

    if (!sessions.length) {
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");

    sessions.forEach(function (session) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "audio-card";
      button.addEventListener("click", function () {
        openPersistedSession(session.id).catch(function () {});
      });

      const title = document.createElement("span");
      title.className = "audio-card-title";
      title.textContent = (session.file && session.file.name) || "Untitled audio";

      const meta = document.createElement("span");
      meta.className = "audio-card-meta";
      meta.textContent = buildSessionMeta(session);

      button.appendChild(title);
      button.appendChild(meta);
      cards.appendChild(button);
    });
  }

  function buildSessionMeta(session) {
    const checkpointCount = Array.isArray(session.playback && session.playback.checkpoints)
      ? session.playback.checkpoints.length
      : 0;
    const when = formatSavedAt(session.savedAt);
    return when + "  |  checkpoints: " + String(checkpointCount);
  }

  function formatSavedAt(savedAt) {
    if (!savedAt) {
      return "saved";
    }
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime())) {
      return "saved";
    }
    return date.toLocaleString();
  }

  async function openPersistedSession(sessionId) {
    const response = await fetch("/api/session?id=" + encodeURIComponent(sessionId), {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error("session_load_failed");
    }

    const saved = await response.json();
    if (!saved || !saved.audioBase64) {
      throw new Error("session_payload_invalid");
    }

    applySavedSession(saved);
    state.activeSessionId = saved.id || sessionId;
    showPlayerView();
  }

  function resetPlaybackState() {
    state.checkpoints = [];
    state.selectedSpanIndex = -1;
    state.markerSignature = "";
  }

  function dropCheckpoint() {
    const seconds = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    state.checkpoints.push(seconds);
    state.checkpoints.sort(function (a, b) { return a - b; });
    state.selectedSpanIndex = -1;
    state.markerSignature = "";
    updateUi();
  }

  function cycleSpanSelection(step) {
    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;
    if (spanCount <= 0) {
      return;
    }

    if (state.selectedSpanIndex < 0 || state.selectedSpanIndex >= spanCount) {
      state.selectedSpanIndex = step > 0 ? 0 : spanCount - 1;
    } else {
      state.selectedSpanIndex = (state.selectedSpanIndex + step + spanCount) % spanCount;
    }

    audio.currentTime = allCheckpoints[state.selectedSpanIndex];
    updateUi();
  }

  function seekBy(deltaSeconds) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;

    if (state.selectedSpanIndex >= 0 && state.selectedSpanIndex < spanCount) {
      const spanStart = allCheckpoints[state.selectedSpanIndex];
      const spanEnd = allCheckpoints[state.selectedSpanIndex + 1];
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

    updateUi();
  }

  function updateUi() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = clampCurrentTimeWithinSelectedSpan({ data: { duration }, deps: {} });

    progress.value = duration > 0
      ? Math.min(1000, Math.round((current / duration) * 1000))
      : 0;

    const percent = duration > 0 ? Math.max(0, Math.min(100, (current / duration) * 100)) : 0;
    progress.style.setProperty("--progress-pct", String(percent) + "%");
    playhead.style.left = String(percent) + "%";
    playheadTime.textContent = formatTime(current);

    renderCheckpointMarkers();
    renderSelectedSpanOverlay();
  }

  function clampCurrentTimeWithinSelectedSpan(ctx) {
    const { data } = ctx;
    const { duration } = data;
    let current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;
    if (state.selectedSpanIndex >= 0 && state.selectedSpanIndex < spanCount) {
      const spanStart = allCheckpoints[state.selectedSpanIndex];
      const spanEnd = allCheckpoints[state.selectedSpanIndex + 1];
      if (spanEnd > spanStart && (current < spanStart || current >= spanEnd)) {
        const epsilon = Math.min(0.02, (spanEnd - spanStart) / 4);
        const loopTime = current < spanStart ? Math.max(spanStart, spanEnd - epsilon) : spanStart;
        audio.currentTime = loopTime;
        current = loopTime;
      }
    }

    if (duration <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(duration, current));
  }

  function renderCheckpointMarkers() {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const series = getCheckpointSeries();
    const signature = duration.toFixed(3) + "|" + series.map(function (v) { return v.toFixed(3); }).join(",");

    if (signature === state.markerSignature) {
      return;
    }

    state.markerSignature = signature;
    checkpointMarkers.innerHTML = "";

    if (duration <= 0) {
      return;
    }

    series.forEach(function (seconds) {
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
    if (duration <= 0 || state.selectedSpanIndex < 0 || state.selectedSpanIndex >= spanCount) {
      selectedSpanOverlay.style.display = "none";
      return;
    }

    const start = allCheckpoints[state.selectedSpanIndex];
    const end = allCheckpoints[state.selectedSpanIndex + 1];
    const startPercent = Math.max(0, Math.min(100, (start / duration) * 100));
    const endPercent = Math.max(0, Math.min(100, (end / duration) * 100));

    selectedSpanOverlay.style.display = "block";
    selectedSpanOverlay.style.left = String(startPercent) + "%";
    selectedSpanOverlay.style.width = String(Math.max(0, endPercent - startPercent)) + "%";
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

    const points = [0].concat(state.checkpoints).concat([duration]).sort(function (a, b) { return a - b; });
    const deduped = [];
    points.forEach(function (point) {
      if (!deduped.length || Math.abs(point - deduped[deduped.length - 1]) > 0.01) {
        deduped.push(point);
      }
    });
    return deduped;
  }

  async function saveSessionState() {
    if (!audio.src || !state.currentFile) {
      return;
    }

    const payload = {
      sessionId: state.activeSessionId,
      file: {
        name: state.currentFile.name,
        type: state.currentFile.type,
        size: state.currentFile.size,
        lastModified: state.currentFile.lastModified
      },
      playback: {
        checkpoints: state.checkpoints.slice(),
        selectedSpanIndex: state.selectedSpanIndex,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        wasPlaying: !audio.paused
      },
      audioBase64: await blobToBase64({ data: { blob: state.currentFile }, deps: {} })
    };

    const response = await fetch("/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error("session_save_failed");
    }

    const saved = await response.json();
    if (saved && saved.id) {
      state.activeSessionId = saved.id;
    }

    await loadPersistedAudioCards();
  }

  function applySavedSession(saved) {
    const savedFile = saved.file || {};
    const savedPlayback = saved.playback || {};
    const blobType = savedFile.type || "audio/*";
    const audioBlob = base64ToBlob({ data: { base64: saved.audioBase64, mimeType: blobType }, deps: {} });

    setAudioSource({ data: { file: audioBlob, displayName: savedFile.name || "Restored audio" }, deps: {} });

    state.currentFile = new File([audioBlob], savedFile.name || "restored-audio", {
      type: blobType,
      lastModified: savedFile.lastModified || Date.now()
    });

    state.checkpoints = Array.isArray(savedPlayback.checkpoints)
      ? savedPlayback.checkpoints.filter(function (v) { return Number.isFinite(v) && v >= 0; }).sort(function (a, b) { return a - b; })
      : [];

    state.selectedSpanIndex = Number.isInteger(savedPlayback.selectedSpanIndex) ? savedPlayback.selectedSpanIndex : -1;
    state.markerSignature = "";

    const resumeTime = Number.isFinite(savedPlayback.currentTime) ? savedPlayback.currentTime : 0;

    audio.addEventListener("loadedmetadata", function handleRestoreMetadata() {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      audio.currentTime = Math.max(0, Math.min(duration || resumeTime, resumeTime));
      updateUi();
    }, { once: true });

    updateUi();
  }

  function setAudioSource(ctx) {
    const { data } = ctx;
    const { file, displayName } = data;

    revokeObjectUrl();

    state.currentFile = file instanceof File
      ? file
      : new File([file], String(displayName || "audio.bin"), { type: file.type || "application/octet-stream", lastModified: Date.now() });

    state.objectUrl = URL.createObjectURL(file);
    audio.src = state.objectUrl;
    fileName.textContent = displayName || state.currentFile.name || "";
    state.markerSignature = "";
  }

  function revokeObjectUrl() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  }

  function blobToBase64(ctx) {
    const { data } = ctx;
    const { blob } = data;

    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || "");
        const marker = "base64,";
        const idx = result.indexOf(marker);
        resolve(idx >= 0 ? result.slice(idx + marker.length) : "");
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  function base64ToBlob(ctx) {
    const { data } = ctx;
    const { base64, mimeType } = data;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: mimeType || "application/octet-stream" });
  }

  window.addEventListener("beforeunload", revokeObjectUrl);
})();
