(function () {
  const LOGIN_STORAGE_KEY = "audioTest.auth";
  const LOGIN_TTL_MS = 10 * 60 * 1000;
  const ALLOWED_USERS = ["zhaoying", "rhys"];
  const loginView = document.getElementById("login-view");
  const loginForm = document.getElementById("login-form");
  const loginUsername = document.getElementById("login-username");
  const loginPassword = document.getElementById("login-password");
  const loginButton = document.getElementById("login-button");
  const loginStatus = document.getElementById("login-status");
  const libraryView = document.getElementById("library-view");
  const logoutButton = document.getElementById("logout-button");
  const playerView = document.getElementById("player-view");
  const uploadButton = document.getElementById("upload-button");
  const backButton = document.getElementById("back-button");
  const input = document.getElementById("audio-file");
  const cards = document.getElementById("audio-cards");
  const emptyState = document.getElementById("empty-state");
  const saveStatus = document.getElementById("save-status");
  const fileName = document.getElementById("file-name");
  const audio = document.getElementById("audio");
  const progress = document.getElementById("progress");
  const progressTrackMain = document.getElementById("progress-track-main");
  const selectedSpanOverlay = document.getElementById("selected-span-overlay");
  const subSegOverlays = document.getElementById("subseg-overlays");
  const checkpointMarkers = document.getElementById("checkpoint-markers");
  const checkpointMagnifier = document.getElementById("checkpoint-magnifier");
  const checkpointMagnifierTime = document.getElementById("checkpoint-magnifier-time");
  const playhead = document.getElementById("playhead");
  const playheadTime = document.getElementById("playhead-time");
  const playerLoading = document.getElementById("player-loading");
  const targetProgressWrap = document.getElementById("target-progress-wrap");
  const targetProgress = document.getElementById("target-progress");
  const targetSpanOverlay = document.getElementById("target-span-overlay");
  const targetSubSegActiveFill = document.getElementById("target-subseg-active-fill");
  const targetCheckpointMarkers = document.getElementById("target-checkpoint-markers");
  const targetPlayhead = document.getElementById("target-playhead");
  const targetPlayheadTime = document.getElementById("target-playhead-time");
  const subSegValuePanel = document.getElementById("subseg-value-panel");
  const subSegValueForm = document.getElementById("subseg-value-form");
  const subSegValueInput = document.getElementById("subseg-value-input");
  const subSegValueList = document.getElementById("subseg-value-list");

  const state = {
    objectUrl: null,
    currentFile: null,
    activeAudioId: null,
    activeAudioUrl: null,
    pendingUpload: null,
    loadingSessionId: null,
    isListLoading: false,
    openMenuSessionId: null,
    sessionsCache: [],
    checkpoints: [],
    subSegs: [],
    selectedSpanIndex: -1,
    targetSpanIndex: -1,
    targetStart: null,
    targetEnd: null,
    targetSubSegs: [],
    selectedTargetSubSegIndex: -1,
    activeSubSegValueKey: null,
    subSegValueEntries: {},
    subSegCardRecallPositions: {},
    subSegCardDeleteDialogKey: null,
    shiftHoldTss: null,
    hasAutoFocusedProgress: false,
    markerSignature: "",
    subSegSignature: "",
    targetMarkerSignature: "",
    isPlayerVisible: false,
    isPlayerLoading: false,
    checkpointDrag: null,
    checkpointPreviewTimerId: null,
    cycleLatch: { left: "", right: "" },
    authUser: null,
    authToken: null,
    activeSessionId: null,
    saveQueue: Promise.resolve(),
    isPersisting: false
  };

  const DEBUG_AUDIO = (function () {
    try {
      const qp = new URLSearchParams(window.location.search);
      if (qp.get("debugAudio") === "1") {
        return true;
      }
      return window.localStorage && window.localStorage.getItem("audioTest.debugAudio") === "1";
    } catch {
      return false;
    }
  })();

  function debugLog(label, detail) {
    if (!DEBUG_AUDIO) {
      return;
    }
    const stamp = new Date().toISOString();
    console.log("[audioTest][" + stamp + "] " + label, detail || {});
  }

  input.addEventListener("change", handleFileChange);
  loginForm.addEventListener("submit", handleLoginSubmit);
  if (subSegValueForm) {
    subSegValueForm.addEventListener("submit", handleSubSegValueSubmit);
  }
  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogoutClick);
  }
  uploadButton.addEventListener("click", openFilePicker);
  backButton.addEventListener("click", goBackToLibrary);
  audio.addEventListener("loadedmetadata", updateUi);
  audio.addEventListener("timeupdate", updateUi);
  audio.addEventListener("durationchange", updateUi);
  audio.addEventListener("play", function () {
    debugLog("audio.play", { currentTime: audio.currentTime, duration: audio.duration });
  });
  audio.addEventListener("pause", function () {
    debugLog("audio.pause", { currentTime: audio.currentTime, duration: audio.duration });
  });
  audio.addEventListener("seeking", function () {
    debugLog("audio.seeking", { currentTime: audio.currentTime, duration: audio.duration });
  });
  audio.addEventListener("seeked", function () {
    debugLog("audio.seeked", { currentTime: audio.currentTime, duration: audio.duration });
  });
  window.addEventListener("keydown", handleKeyDown, { capture: true });
  window.addEventListener("keyup", handleKeyUp, { capture: true });
  window.addEventListener("mousemove", handleCheckpointDragMove, { capture: true });
  window.addEventListener("mouseup", handleCheckpointDragEnd, { capture: true });
  document.addEventListener("click", handleGlobalClick);

  initialize();

  async function initialize() {
    fileName.textContent = "";
    setSaveStatus("Ready");
    progress.disabled = false;
    showLoginView();
    const restored = restoreLoginFromStorage();
    if (restored) {
      state.authUser = restored.username;
      state.authToken = restored.token;
      setLoginStatus("Welcome back, " + restored.username + ".");
      showLibraryView();
      await loadPersistedAudioCards();
      return;
    }
    setLoginStatus("Log in to continue.");
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    const usernameRaw = String(loginUsername.value || "").trim().toLowerCase();
    const password = String(loginPassword.value || "");

    if (!usernameRaw || !password) {
      setLoginStatus("Username and password are required.", true);
      return;
    }
    if (ALLOWED_USERS.indexOf(usernameRaw) < 0) {
      setLoginStatus("User is not allowed.", true);
      return;
    }

    loginButton.disabled = true;
    setLoginStatus("Signing in...");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: usernameRaw,
          password
        })
      });

      if (!response.ok) {
        const detail = await response.text().catch(function () { return ""; });
        throw new Error("login_failed status=" + String(response.status) + " detail=" + detail);
      }

      const payload = await response.json();
      if (!payload || !payload.ok || !payload.username || !payload.token) {
        throw new Error("invalid_login_response");
      }

      const ttl = Number.isFinite(Number(payload.ttlMs)) ? Number(payload.ttlMs) : LOGIN_TTL_MS;
      const loggedInAt = Number.isFinite(Number(payload.loggedInAt)) ? Number(payload.loggedInAt) : Date.now();
      persistLogin({
        username: payload.username,
        token: payload.token,
        loggedInAt,
        ttlMs: ttl
      });

      state.authUser = payload.username;
      state.authToken = payload.token;
      loginPassword.value = "";
      setLoginStatus("Signed in as " + payload.username + ".");
      showLibraryView();
      await loadPersistedAudioCards();
    } catch (error) {
      setLoginStatus("Login failed: " + normalizeErrorMessage(error), true);
    } finally {
      loginButton.disabled = false;
    }
  }

  function openFilePicker() {
    input.value = "";
    input.click();
  }

  function handleLogoutClick() {
    if (state.isPersisting) {
      return;
    }
    clearLoginState("Logged out.");
  }

  async function handleFileChange(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    state.activeSessionId = null;
    state.activeAudioId = null;
    state.activeAudioUrl = null;
    state.pendingUpload = {
      id: "pending-" + Date.now().toString(36),
      file: {
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified
      },
      progress: 0,
      phase: "uploading",
      savedAt: new Date().toISOString(),
      playback: { checkpoints: [] }
    };
    setAudioSource({ data: { file, displayName: file.name }, deps: {} });
    resetPlaybackState();
    showLibraryView();
    renderAudioCards(state.sessionsCache);
    await enqueueAutoSave();
  }

  function handleKeyDown(event) {
    if (event.defaultPrevented) {
      return;
    }
    const keyCode = String(event.code || "");
    const keyValue = String(event.key || "");
    const isArrowRight = keyCode === "ArrowRight" || keyValue === "ArrowRight" || keyValue === "Right";
    const isArrowLeft = keyCode === "ArrowLeft" || keyValue === "ArrowLeft" || keyValue === "Left";
    const isArrowUp = keyCode === "ArrowUp" || keyValue === "ArrowUp" || keyValue === "Up";
    const isArrowDown = keyCode === "ArrowDown" || keyValue === "ArrowDown" || keyValue === "Down";
    const isSpaceKey = keyCode === "Space" || keyValue === " " || keyValue === "Spacebar";
    const isEnterKey = keyCode === "Enter" || keyValue === "Enter";
    const isShiftKey = keyCode === "ShiftLeft" || keyCode === "ShiftRight" || keyValue === "Shift";
    const activeElement = document.activeElement;
    const isSubSegInputFocused = activeElement === subSegValueInput;
    const isSubSegCardInputFocused = Boolean(
      activeElement &&
      activeElement.classList &&
      activeElement.classList.contains("subseg-value-card-input")
    );
    debugLog("keydown", {
      code: keyCode,
      key: keyValue,
      ctrl: Boolean(event.ctrlKey || event.metaKey),
      shift: Boolean(event.shiftKey),
      isPlayerActive: isPlayerActive(),
      paused: audio.paused,
      currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
      selectedSpanIndex: state.selectedSpanIndex,
      targetSpanIndex: state.targetSpanIndex,
      selectedTargetSubSegIndex: state.selectedTargetSubSegIndex,
      shiftHoldTss: state.shiftHoldTss
    });

    if (isSubSegCardInputFocused) {
      if (handleFocusedSubSegCardKeyDown(event)) {
        return;
      }
      return;
    }

    if (isSubSegInputFocused) {
      if ((event.ctrlKey || event.metaKey) && (isArrowUp || isArrowDown)) {
        event.preventDefault();
        event.stopPropagation();
        moveFocusFromTopSubSegInput(isArrowDown ? 1 : -1);
      }
      return;
    }

    if (isShiftKey && isPlayerActive() && hasTargetSpan() && !Number.isFinite(state.shiftHoldTss)) {
      state.shiftHoldTss = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      debugLog("target:shiftHoldStart", { tss: state.shiftHoldTss });
      setSaveStatus("audSeg tss armed at " + formatTime(state.shiftHoldTss));
      return;
    }

    if ((event.ctrlKey || event.metaKey) && (keyCode === "Backspace" || keyValue === "Backspace")) {
      if (isPlayerActive()) {
        event.preventDefault();
        if (state.activeSubSegValueKey) {
          state.activeSubSegValueKey = null;
          if (subSegValueInput) {
            subSegValueInput.value = "";
          }
          renderSubSegValuePanel();
          setSaveStatus("audSeg subSeg value selection cleared");
          return;
        }
        if (state.selectedTargetSubSegIndex >= 0) {
          state.selectedTargetSubSegIndex = -1;
          updateUi();
          setSaveStatus("audSeg subSeg deselected");
          return;
        }
        if (hasTargetSpan()) {
          clearTargetSpanLock({ preserveSelection: true });
          updateUi();
          setSaveStatus("audSeg target unlocked");
          return;
        }
        if (state.selectedSpanIndex >= 0) {
          state.selectedSpanIndex = -1;
          updateUi();
          setSaveStatus("audSeg deselected");
          enqueueAutoSave();
        } else {
          goBackToLibrary();
        }
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && (keyCode === "KeyS" || keyValue.toLowerCase() === "s")) {
      event.preventDefault();
      if (isPlayerActive() && audio.src) {
        enqueueAutoSave();
      }
      return;
    }

    if (!isPlayerActive() || !audio.src) {
      return;
    }

    if (isEnterKey && isSubSegInputFocused) {
      return;
    }

    if (isEnterKey) {
      event.preventDefault();
      if (hasTargetSpan() && state.selectedTargetSubSegIndex >= 0) {
        activateSubSegValueSelection();
        return;
      }
      lockSelectedSpanAsTarget();
      return;
    }

    if ((isArrowRight || isArrowLeft) && event.ctrlKey) {
      const latchKey = isArrowRight ? "right" : "left";
      const latchMode = hasTargetSpan() ? "target" : "span";
      if (state.cycleLatch[latchKey] === latchMode || event.repeat) {
        event.preventDefault();
        return;
      }
      state.cycleLatch[latchKey] = latchMode;
      if (hasTargetSpan()) {
        event.preventDefault();
        cycleTargetSubSegSelection(isArrowRight ? 1 : -1);
        return;
      }
      if (getCheckpointSeries().length <= 1) {
        return;
      }
      event.preventDefault();
      cycleSpanSelection(isArrowRight ? 1 : -1);
      debugLog("keydown:cycleSpan", { dir: isArrowRight ? 1 : -1, selectedSpanIndex: state.selectedSpanIndex });
      return;
    }

    if (isArrowRight || isArrowLeft) {
      event.preventDefault();
      debugLog("keydown:seekBy", { delta: isArrowRight ? 5 : -5 });
      seekBy(isArrowRight ? 5 : -5);
      return;
    }

    if (!isSpaceKey) {
      return;
    }

    event.preventDefault();

    if (event.shiftKey) {
      if (hasTargetSpan()) {
        createTargetSubSegFromShiftHold();
        return;
      }
      dropCheckpoint();
      debugLog("keydown:checkpoint", { currentTime: audio.currentTime, checkpoints: state.checkpoints.slice() });
      return;
    }

    if (audio.paused) {
      audio.play().catch(function () {});
    } else {
      audio.pause();
    }
  }

  function handleKeyUp(event) {
    const keyCode = String(event.code || "");
    const keyValue = String(event.key || "");
    const isShiftKey = keyCode === "ShiftLeft" || keyCode === "ShiftRight" || keyValue === "Shift";
    const isArrowRight = keyCode === "ArrowRight" || keyValue === "ArrowRight" || keyValue === "Right";
    const isArrowLeft = keyCode === "ArrowLeft" || keyValue === "ArrowLeft" || keyValue === "Left";
    const isCtrlKey = keyCode === "ControlLeft" || keyCode === "ControlRight" || keyValue === "Control";
    const isMetaKey = keyCode === "MetaLeft" || keyCode === "MetaRight" || keyValue === "Meta";

    if (isArrowRight) {
      state.cycleLatch.right = "";
    }
    if (isArrowLeft) {
      state.cycleLatch.left = "";
    }
    if (isCtrlKey || isMetaKey) {
      state.cycleLatch.left = "";
      state.cycleLatch.right = "";
    }

    if (!isShiftKey || !Number.isFinite(state.shiftHoldTss)) {
      return;
    }
    state.shiftHoldTss = null;
    debugLog("target:shiftHoldClear", {});
    if (hasTargetSpan() && isPlayerActive()) {
      setSaveStatus("audSeg tss cleared");
    }
  }

  function beginCheckpointDrag(event, checkpointIndex) {
    if (!isPlayerActive() || state.isPlayerLoading) {
      return;
    }
    if (hasTargetSpan()) {
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration <= 0 || checkpointIndex < 0 || checkpointIndex >= state.checkpoints.length) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const prev = checkpointIndex > 0 ? state.checkpoints[checkpointIndex - 1] : 0;
    const next = checkpointIndex < (state.checkpoints.length - 1) ? state.checkpoints[checkpointIndex + 1] : duration;
    const wasPlaying = !audio.paused;
    if (wasPlaying) {
      audio.pause();
    }

    state.checkpointDrag = {
      index: checkpointIndex,
      prev: Number.isFinite(prev) ? prev : 0,
      next: Number.isFinite(next) ? next : duration,
      wasPlaying,
      lastAppliedTime: state.checkpoints[checkpointIndex]
    };

    const startTime = state.checkpoints[checkpointIndex];
    showCheckpointMagnifier(startTime);
    previewCheckpointPosition(startTime);
    updateUi();
  }

  function handleCheckpointDragMove(event) {
    if (!state.checkpointDrag) {
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration <= 0) {
      return;
    }
    event.preventDefault();

    const nextTime = resolveTimeFromClientX(event.clientX, duration);
    const epsilon = 0.02;
    const minTime = Math.max(0, state.checkpointDrag.prev + epsilon);
    const maxTime = Math.min(duration, state.checkpointDrag.next - epsilon);
    const clamped = Math.max(minTime, Math.min(maxTime, nextTime));
    if (!Number.isFinite(clamped)) {
      return;
    }
    if (Math.abs(clamped - state.checkpointDrag.lastAppliedTime) < 0.001) {
      return;
    }

    state.checkpoints[state.checkpointDrag.index] = clamped;
    state.checkpointDrag.lastAppliedTime = clamped;
    state.markerSignature = "";
    state.subSegSignature = "";
    state.targetMarkerSignature = "";
    syncTargetSubSegsFromCurrentBounds();
    showCheckpointMagnifier(clamped);
    previewCheckpointPosition(clamped);
    updateUi();
  }

  function handleCheckpointDragEnd() {
    if (!state.checkpointDrag) {
      return;
    }
    const dragState = state.checkpointDrag;
    state.checkpointDrag = null;
    hideCheckpointMagnifier();
    if (state.checkpointPreviewTimerId) {
      window.clearTimeout(state.checkpointPreviewTimerId);
      state.checkpointPreviewTimerId = null;
    }
    if (dragState.wasPlaying) {
      audio.play().catch(function () {});
    } else {
      audio.pause();
    }
    syncTargetSubSegsFromCurrentBounds();
    updateUi();
    enqueueAutoSave();
  }

  function clearCheckpointDragState() {
    state.checkpointDrag = null;
    if (state.checkpointPreviewTimerId) {
      window.clearTimeout(state.checkpointPreviewTimerId);
      state.checkpointPreviewTimerId = null;
    }
    hideCheckpointMagnifier();
  }

  function resolveTimeFromClientX(clientX, duration) {
    const trackRect = progressTrackMain ? progressTrackMain.getBoundingClientRect() : progress.getBoundingClientRect();
    const ratio = trackRect.width > 0 ? (clientX - trackRect.left) / trackRect.width : 0;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    return clampedRatio * duration;
  }

  function showCheckpointMagnifier(seconds) {
    if (!checkpointMagnifier) {
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const trackRect = progressTrackMain ? progressTrackMain.getBoundingClientRect() : progress.getBoundingClientRect();
    const percent = duration > 0 ? Math.max(0, Math.min(1, seconds / duration)) : 0;
    const x = percent * trackRect.width;
    const left = Math.max(0, Math.min(trackRect.width - 88, x - 44));
    checkpointMagnifier.style.left = String(left) + "px";
    checkpointMagnifier.classList.remove("hidden");
    if (checkpointMagnifierTime) {
      checkpointMagnifierTime.textContent = formatTime(seconds);
    }
  }

  function hideCheckpointMagnifier() {
    if (!checkpointMagnifier) {
      return;
    }
    checkpointMagnifier.classList.add("hidden");
  }

  function previewCheckpointPosition(seconds) {
    if (!Number.isFinite(seconds)) {
      return;
    }
    if (state.checkpointPreviewTimerId) {
      window.clearTimeout(state.checkpointPreviewTimerId);
      state.checkpointPreviewTimerId = null;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const safe = Math.max(0, Math.min(duration || seconds, seconds));
    audio.currentTime = safe;
    audio.play().catch(function () {});
    state.checkpointPreviewTimerId = window.setTimeout(function () {
      if (state.checkpointDrag) {
        const loopPoint = Number.isFinite(state.checkpointDrag.lastAppliedTime)
          ? state.checkpointDrag.lastAppliedTime
          : safe;
        previewCheckpointPosition(loopPoint);
        return;
      }
      audio.pause();
      state.checkpointPreviewTimerId = null;
    }, 1000);
  }

  function showLibraryView() {
    blurActiveEditable();
    clearCheckpointDragState();
    loginView.classList.add("hidden");
    libraryView.classList.remove("hidden");
    playerView.classList.add("hidden");
    setPlayerLoading(false);
    state.isPlayerVisible = false;
  }

  function showPlayerView() {
    blurActiveEditable();
    loginView.classList.add("hidden");
    libraryView.classList.add("hidden");
    playerView.classList.remove("hidden");
    state.isPlayerVisible = true;
  }

  function showLoginView() {
    blurActiveEditable();
    clearCheckpointDragState();
    loginView.classList.remove("hidden");
    libraryView.classList.add("hidden");
    playerView.classList.add("hidden");
    setPlayerLoading(false);
    state.isPlayerVisible = false;
  }

  function setPlayerLoading(isLoading, message) {
    const active = Boolean(isLoading);
    state.isPlayerLoading = active;
    playerView.classList.toggle("is-loading", active);
    if (playerLoading) {
      playerLoading.classList.toggle("hidden", !active);
      if (message) {
        const label = playerLoading.querySelector(".card-progress-label");
        if (label) {
          label.textContent = String(message);
        }
      }
    }
  }

  function blurActiveEditable() {
    const active = document.activeElement;
    if (!active) {
      return;
    }
    if (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable || active.tagName === "BUTTON") {
      try {
        active.blur();
      } catch {
        // Ignore blur failures.
      }
    }
  }

  function isPlayerActive() {
    return state.isPlayerVisible && !playerView.classList.contains("hidden");
  }

  async function goBackToLibrary() {
    if (!audio.paused) {
      audio.pause();
    }
    clearTargetSpanLock({ preserveSelection: false });
    showLibraryView();
    state.openMenuSessionId = null;
    state.isListLoading = true;
    renderAudioCards(state.sessionsCache);
    try {
      if (state.currentFile) {
        await enqueueAutoSave();
      } else {
        await loadPersistedAudioCards();
      }
    } finally {
      state.isListLoading = false;
      renderAudioCards(state.sessionsCache);
    }
  }

  function handleGlobalClick(event) {
    const target = event.target;
    if (!target || state.openMenuSessionId == null) {
      return;
    }
    const withinMenu = target.closest && target.closest(".item-actions");
    const withinSettingsButton = target.closest && target.closest(".item-settings-button");
    if (!withinMenu && !withinSettingsButton) {
      state.openMenuSessionId = null;
      renderAudioCards(state.sessionsCache);
    }
  }

  async function loadPersistedAudioCards() {
    if (!state.authUser || !state.authToken) {
      return;
    }
    try {
      const response = await fetch("/api/sessions", {
        method: "GET",
        cache: "no-store",
        headers: buildAuthHeaders()
      });
      if (response.status === 401) {
        clearLoginState("Login expired. Please sign in again.");
        return;
      }

      if (response.status === 404) {
        renderAudioCards([]);
        return;
      }

      if (!response.ok) {
        throw new Error("session_list_failed");
      }

      const payload = await response.json();
      const sessions = payload && Array.isArray(payload.sessions) ? payload.sessions : [];
      state.sessionsCache = sessions;
      renderAudioCards(sessions);
    } catch {
      state.sessionsCache = [];
      renderAudioCards([]);
    }
  }

  function renderAudioCards(sessions) {
    state.sessionsCache = Array.isArray(sessions) ? sessions : [];
    cards.innerHTML = "";

    const hasPending = Boolean(state.pendingUpload);
    if (!state.sessionsCache.length && !hasPending && !state.isListLoading) {
      emptyState.classList.remove("hidden");
      return;
    }

    emptyState.classList.add("hidden");

    if (state.isListLoading) {
      cards.appendChild(createListLoadingCard());
    }

    if (state.pendingUpload) {
      cards.appendChild(createPendingAudioCard(state.pendingUpload));
    }

    state.sessionsCache.forEach(function (session) {
      const row = document.createElement("div");
      row.className = "audio-card-row";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "audio-card audio-card-main";
      const isLoading = state.loadingSessionId && state.loadingSessionId === session.id;
      button.disabled = state.isPersisting;
      button.classList.toggle("is-disabled", state.isPersisting);
      button.classList.toggle("is-loading", Boolean(isLoading));
      button.addEventListener("click", function () {
        if (state.isPersisting || state.loadingSessionId) {
          return;
        }
        openPersistedSession(session.id).catch(function () {});
      });

      const title = document.createElement("span");
      title.className = "audio-card-title";
      title.textContent = (session.file && session.file.name) || "Untitled audio";

      const meta = document.createElement("span");
      meta.className = "audio-card-meta";
      meta.textContent = buildSessionMeta(session, isLoading ? "loading" : "");

      button.appendChild(title);
      button.appendChild(meta);
      if (isLoading) {
        button.appendChild(createProgressRow({ mode: "indeterminate", label: "Loading audio..." }));
      }
      row.appendChild(button);

      const settingsButton = document.createElement("button");
      settingsButton.type = "button";
      settingsButton.className = "item-settings-button";
      settingsButton.setAttribute("aria-label", "Item settings");
      settingsButton.title = "Item settings";
      settingsButton.textContent = "...";
      settingsButton.disabled = state.isPersisting || Boolean(state.loadingSessionId);
      settingsButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleSessionMenu(session.id);
      });
      row.appendChild(settingsButton);

      if (state.openMenuSessionId === session.id) {
        row.appendChild(createItemActionsMenu(session.id));
      }

      cards.appendChild(row);
    });
  }

  function createListLoadingCard() {
    const wrap = document.createElement("div");
    wrap.className = "audio-card is-pending";

    const title = document.createElement("span");
    title.className = "audio-card-title";
    title.textContent = "Refreshing list";

    const meta = document.createElement("span");
    meta.className = "audio-card-meta";
    meta.textContent = "Loading updated sessions...";

    wrap.appendChild(title);
    wrap.appendChild(meta);
    wrap.appendChild(createProgressRow({ mode: "indeterminate", label: "Loading..." }));
    return wrap;
  }

  function createItemActionsMenu(sessionId) {
    const menu = document.createElement("div");
    menu.className = "item-actions";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-action-button danger";
    del.textContent = "Delete";
    del.disabled = state.isPersisting || Boolean(state.loadingSessionId);
    del.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      deleteSession(sessionId).catch(function () {});
    });

    menu.appendChild(del);
    return menu;
  }

  function toggleSessionMenu(sessionId) {
    if (state.isPersisting || state.loadingSessionId) {
      return;
    }
    state.openMenuSessionId = state.openMenuSessionId === sessionId ? null : sessionId;
    renderAudioCards(state.sessionsCache);
  }

  function createPendingAudioCard(upload) {
    const wrap = document.createElement("div");
    wrap.className = "audio-card is-pending";

    const title = document.createElement("span");
    title.className = "audio-card-title";
    title.textContent = (upload.file && upload.file.name) || "Uploading audio";

    const phaseText = upload.phase === "saving"
      ? "Finalizing metadata..."
      : upload.phase === "failed"
        ? "Upload failed"
        : "Uploading audio...";

    const meta = document.createElement("span");
    meta.className = "audio-card-meta";
    meta.textContent = phaseText;

    const progress = createProgressRow({
      mode: upload.phase === "uploading" ? "percent" : upload.phase === "saving" ? "indeterminate" : "stopped",
      percent: upload.progress || 0,
      label: upload.phase === "failed"
        ? "Failed"
        : upload.phase === "saving"
          ? "Saving..."
          : String(Math.round((upload.progress || 0) * 100)) + "%"
    });

    wrap.appendChild(title);
    wrap.appendChild(meta);
    wrap.appendChild(progress);
    return wrap;
  }

  function createProgressRow(ctx) {
    const data = ctx || {};
    const row = document.createElement("div");
    row.className = "card-progress";

    const bar = document.createElement("span");
    bar.className = "card-progress-bar";
    if (data.mode === "indeterminate") {
      bar.classList.add("is-indeterminate");
    } else if (data.mode === "stopped") {
      bar.style.setProperty("--card-progress", "0%");
    } else {
      const pct = Math.max(0, Math.min(100, Math.round(Number(data.percent || 0) * 100)));
      bar.style.setProperty("--card-progress", String(pct) + "%");
    }

    const label = document.createElement("span");
    label.className = "card-progress-label";
    label.textContent = data.label || "";

    row.appendChild(bar);
    row.appendChild(label);
    return row;
  }

  function buildSessionMeta(session, mode) {
    const checkpointCount = Array.isArray(session.playback && session.playback.checkpoints)
      ? session.playback.checkpoints.length
      : 0;
    const when = formatSavedAt(session.savedAt);
    if (mode === "loading") {
      return "Opening...  |  checkpoints: " + String(checkpointCount);
    }
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
    if (state.isPersisting || state.loadingSessionId) {
      return;
    }
    state.loadingSessionId = sessionId;
    state.openMenuSessionId = null;
    debugLog("openPersistedSession:start", { sessionId });
    renderAudioCards(state.sessionsCache);

    try {
      showPlayerView();
      setPlayerLoading(true, "Restoring checkpoints and subSegs...");

      const response = await fetch("/api/session?id=" + encodeURIComponent(sessionId), {
        method: "GET",
        cache: "no-store",
        headers: buildAuthHeaders()
      });
      if (response.status === 401) {
        clearLoginState("Login expired. Please sign in again.");
        return;
      }

      if (!response.ok) {
        throw new Error("session_load_failed");
      }

      const saved = await response.json();
      if (!saved || typeof saved !== "object") {
        throw new Error("session_payload_invalid");
      }

      await applySavedSession(saved);
      state.activeSessionId = saved.id || sessionId;
      state.activeAudioId = typeof saved.audioId === "string" ? saved.audioId : null;
      state.activeAudioUrl = typeof saved.audioUrl === "string" ? saved.audioUrl : null;
      debugLog("openPersistedSession:loaded", {
        sessionId: state.activeSessionId,
        audioId: state.activeAudioId,
        audioUrl: state.activeAudioUrl,
        checkpoints: Array.isArray(saved.playback && saved.playback.checkpoints) ? saved.playback.checkpoints.length : 0
      });
      setPlayerLoading(false);
      focusProgressControl();
    } finally {
      setPlayerLoading(false);
      state.loadingSessionId = null;
      renderAudioCards(state.sessionsCache);
    }
  }

  function resetPlaybackState() {
    clearCheckpointDragState();
    state.checkpoints = [];
    state.subSegs = [];
    state.subSegValueEntries = {};
    state.subSegCardRecallPositions = {};
    state.subSegCardDeleteDialogKey = null;
    state.activeSubSegValueKey = null;
    state.selectedSpanIndex = -1;
    clearTargetSpanLock({ preserveSelection: false });
    state.shiftHoldTss = null;
    state.markerSignature = "";
    state.subSegSignature = "";
    state.targetMarkerSignature = "";
    renderSubSegValuePanel();
  }

  function dropCheckpoint() {
    if (hasTargetSpan()) {
      setSaveStatus("audSeg target mode: checkpoint set disabled");
      return;
    }
    const seconds = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    debugLog("dropCheckpoint:before", { seconds, checkpoints: state.checkpoints.slice() });
    state.checkpoints.push(seconds);
    state.checkpoints.sort(function (a, b) { return a - b; });
    state.selectedSpanIndex = -1;
    state.markerSignature = "";
    updateUi();
    enqueueAutoSave();
    debugLog("dropCheckpoint:after", { checkpoints: state.checkpoints.slice() });
  }

  function cycleSpanSelection(step) {
    if (hasTargetSpan()) {
      return;
    }
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

    snapToSelectedSpanStart();
    updateUi();
  }

  function snapToSelectedSpanStart() {
    const range = getSpanBoundsByIndex(state.selectedSpanIndex);
    if (!range) {
      return;
    }
    const spanLength = range.end - range.start;
    if (!Number.isFinite(spanLength) || spanLength <= 0) {
      return;
    }

    const epsilon = Math.min(0.02, Math.max(0.003, spanLength / 20));
    const target = Math.min(range.end - 0.001, range.start + epsilon);
    audio.currentTime = target;

    window.setTimeout(function () {
      const verifyRange = getSpanBoundsByIndex(state.selectedSpanIndex);
      if (!verifyRange) {
        return;
      }
      const current = Number.isFinite(audio.currentTime) ? audio.currentTime : target;
      if (current >= verifyRange.end || current < (verifyRange.start - 0.01)) {
        audio.currentTime = Math.min(verifyRange.end - 0.001, verifyRange.start + epsilon);
        updateUi();
      }
    }, 50);
  }

  function createTargetSubSegFromShiftHold() {
    if (!hasTargetSpan()) {
      return;
    }
    const tss = Number.isFinite(state.shiftHoldTss)
      ? state.shiftHoldTss
      : (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    if (!Number.isFinite(state.shiftHoldTss)) {
      state.shiftHoldTss = tss;
      debugLog("target:shiftHoldStart:auto", { tss });
    }

    const tse = Number.isFinite(audio.currentTime) ? audio.currentTime : tss;
    const bounds = getTargetSpanBounds();
    if (!bounds) {
      return;
    }

    const start = Math.max(bounds.start, Math.min(bounds.end, Math.min(tss, tse)));
    const end = Math.max(bounds.start, Math.min(bounds.end, Math.max(tss, tse)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || (end - start) <= 0.03) {
      setSaveStatus("audSeg subSeg ignored (too short)");
      return;
    }

    const created = { start, end };
    state.subSegs.push(created);
    state.subSegs = normalizeSubSegs(state.subSegs);
    syncTargetSubSegsFromCurrentBounds();
    state.subSegSignature = "";
    state.markerSignature = "";
    state.targetMarkerSignature = "";
    audio.currentTime = start;
    updateUi();
    debugLog("target:subSegCreated", {
      tss,
      tse,
      start,
      end,
      count: state.subSegs.length,
      selectedTargetSubSegIndex: state.selectedTargetSubSegIndex
    });
    setSaveStatus("audSeg subSeg created: " + formatTime(start) + " -> " + formatTime(end));
    enqueueAutoSave();
  }

  function cycleTargetSubSegSelection(step) {
    if (!hasTargetSpan()) {
      return;
    }
    syncTargetSubSegsFromCurrentBounds();
    const total = state.targetSubSegs.length;
    if (total <= 0) {
      setSaveStatus("No audSeg subSegs yet (Shift hold, then Shift+Space)");
      return;
    }
    if (state.selectedTargetSubSegIndex < 0 || state.selectedTargetSubSegIndex >= total) {
      state.selectedTargetSubSegIndex = step > 0 ? 0 : total - 1;
    } else {
      state.selectedTargetSubSegIndex = (state.selectedTargetSubSegIndex + step + total) % total;
    }
    const selected = state.targetSubSegs[state.selectedTargetSubSegIndex];
    if (selected) {
      audio.currentTime = selected.start;
      setSaveStatus(
        "audSeg subSeg " + String(state.selectedTargetSubSegIndex + 1) + "/" + String(total) +
        ": " + formatTime(selected.start) + " -> " + formatTime(selected.end)
      );
    }
    updateUi();
    debugLog("target:cycleSubSeg", {
      step,
      selectedTargetSubSegIndex: state.selectedTargetSubSegIndex,
      total
    });
    syncSubSegValueSelectionToCurrentTarget();
    renderSubSegValuePanel();
  }

  function getSubSegValueKey(seg) {
    if (!seg || !Number.isFinite(seg.start) || !Number.isFinite(seg.end)) {
      return "";
    }
    return seg.start.toFixed(3) + "|" + seg.end.toFixed(3);
  }

  function getSelectedTargetSubSegValueKey() {
    const seg = getTargetSubSegBoundsByIndex(state.selectedTargetSubSegIndex);
    return getSubSegValueKey(seg);
  }

  function activateSubSegValueSelection() {
    const key = getSelectedTargetSubSegValueKey();
    if (!key) {
      setSaveStatus("Select a subSeg first (Ctrl+Left/Right)");
      return;
    }
    state.activeSubSegValueKey = key;
    renderSubSegValuePanel();
    requestAnimationFrame(function () {
      if (!subSegValueInput) {
        return;
      }
      try {
        subSegValueInput.focus({ preventScroll: true });
      } catch {
        subSegValueInput.focus();
      }
    });
  }

  function syncSubSegValueSelectionToCurrentTarget() {
    if (!state.activeSubSegValueKey) {
      return;
    }
    const currentKey = getSelectedTargetSubSegValueKey();
    if (!currentKey || currentKey !== state.activeSubSegValueKey) {
      state.activeSubSegValueKey = null;
      if (subSegValueInput) {
        subSegValueInput.value = "";
      }
    }
  }

  function handleSubSegValueSubmit(event) {
    event.preventDefault();
    const key = state.activeSubSegValueKey;
    if (!key || !subSegValueInput) {
      return;
    }
    const text = String(subSegValueInput.value || "").trim();
    if (!text) {
      return;
    }
    if (!Array.isArray(state.subSegValueEntries[key])) {
      state.subSegValueEntries[key] = [];
    }
    const createdAt = new Date().toISOString();
    state.subSegValueEntries[key].push({
      value: text,
      createdAt,
      history: []
    });
    subSegValueInput.value = "";
    renderSubSegValuePanel();
    enqueueAutoSave();
  }

  function renderSubSegValuePanel() {
    if (!subSegValuePanel || !subSegValueList) {
      return;
    }
    const selectedKey = getSelectedTargetSubSegValueKey();
    const isVisible = Boolean(hasTargetSpan() && selectedKey && state.activeSubSegValueKey && selectedKey === state.activeSubSegValueKey);
    subSegValuePanel.classList.toggle("hidden", !isVisible);
    if (!isVisible) {
      subSegValueList.innerHTML = "";
      return;
    }

    const values = Array.isArray(state.subSegValueEntries[selectedKey]) ? state.subSegValueEntries[selectedKey] : [];
    subSegValueList.innerHTML = "";
    values.forEach(function (entry, entryIndex) {
      const card = document.createElement("div");
      card.className = "subseg-value-card";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "subseg-value-card-input";
      input.dataset.subSegValueKey = selectedKey;
      input.dataset.subSegValueIndex = String(entryIndex);
      const recallPosition = getCardRecallPosition(selectedKey, entryIndex, entry);
      const isRecalling = recallPosition < getCardCurrentPosition(entry);
      const recallMeta = getCardRecallMeta(entry, recallPosition);
      const version = document.createElement("div");
      version.className = "subseg-value-version";
      if (isRecalling && recallMeta) {
        version.textContent = "current -" + String(recallMeta.offset) + " | " + formatSavedAt(recallMeta.createdAt);
      } else {
        version.textContent = "current -0 | " + formatSavedAt(entry && entry.createdAt ? entry.createdAt : "");
      }
      card.appendChild(version);
      input.value = isRecalling ? getCardValueAtPosition(entry, recallPosition) : String(entry.value || "");
      input.readOnly = isRecalling;
      if (isRecalling) {
        input.classList.add("is-recalling");
      }
      input.addEventListener("change", handleSubSegCardInputChange);
      card.appendChild(input);

      const deleteDialogKey = getSubSegCardRecallStateKey(selectedKey, entryIndex);
      if (state.subSegCardDeleteDialogKey === deleteDialogKey) {
        const actions = document.createElement("div");
        actions.className = "subseg-value-delete-row";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "subseg-value-delete-cancel";
        cancelButton.dataset.subSegValueDeleteCancel = "1";
        cancelButton.dataset.subSegValueKey = selectedKey;
        cancelButton.dataset.subSegValueIndex = String(entryIndex);
        cancelButton.textContent = "Cancel";
        cancelButton.addEventListener("click", function () {
          state.subSegCardDeleteDialogKey = null;
          renderSubSegValuePanel();
          focusSubSegCardInput(selectedKey, entryIndex, isRecalling);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "subseg-value-delete-confirm";
        deleteButton.dataset.subSegValueDeleteConfirm = "1";
        deleteButton.dataset.subSegValueKey = selectedKey;
        deleteButton.dataset.subSegValueIndex = String(entryIndex);
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", function () {
          deleteSubSegValueCard(selectedKey, entryIndex);
        });

        actions.appendChild(cancelButton);
        actions.appendChild(deleteButton);
        card.appendChild(actions);
      }
      subSegValueList.appendChild(card);
    });
  }

  function handleSubSegCardInputChange(event) {
    const inputEl = event.target;
    const key = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValueKey || "" : "");
    const index = Number(inputEl && inputEl.dataset ? inputEl.dataset.subSegValueIndex : NaN);
    const entry = getSubSegValueEntry(key, index);
    if (!entry) {
      return;
    }
    const currentPos = getCardCurrentPosition(entry);
    const recallPos = getCardRecallPosition(key, index, entry);
    if (recallPos < currentPos) {
      inputEl.value = getCardValueAtPosition(entry, recallPos);
      return;
    }
    const nextValue = String(inputEl.value || "").trim();
    const prevValue = String(entry.value || "");
    if (!nextValue || nextValue === prevValue) {
      inputEl.value = prevValue;
      return;
    }
    if (!Array.isArray(entry.history)) {
      entry.history = [];
    }
    entry.history.push({
      value: prevValue,
      createdAt: entry.createdAt || new Date().toISOString()
    });
    if (entry.history.length > 200) {
      entry.history = entry.history.slice(entry.history.length - 200);
    }
    entry.value = nextValue;
    entry.createdAt = new Date().toISOString();
    inputEl.value = nextValue;
    enqueueAutoSave();
  }

  function getSubSegValueEntry(key, index) {
    if (!key || !Number.isFinite(index)) {
      return null;
    }
    const list = Array.isArray(state.subSegValueEntries[key]) ? state.subSegValueEntries[key] : null;
    if (!list || index < 0 || index >= list.length) {
      return null;
    }
    return list[index];
  }

  function getSubSegCardRecallStateKey(key, index) {
    return key + "#" + String(index);
  }

  function getCardCurrentPosition(entry) {
    const historyLen = Array.isArray(entry && entry.history) ? entry.history.length : 0;
    return historyLen;
  }

  function getCardRecallPosition(key, index, entry) {
    const stateKey = getSubSegCardRecallStateKey(key, index);
    const currentPos = getCardCurrentPosition(entry);
    const stored = Number(state.subSegCardRecallPositions[stateKey]);
    if (!Number.isFinite(stored) || stored < 0 || stored > currentPos) {
      return currentPos;
    }
    return stored;
  }

  function setCardRecallPosition(key, index, position) {
    const stateKey = getSubSegCardRecallStateKey(key, index);
    state.subSegCardRecallPositions[stateKey] = position;
  }

  function getCardValueAtPosition(entry, position) {
    const history = Array.isArray(entry && entry.history) ? entry.history : [];
    const currentPos = history.length;
    if (position < currentPos) {
      const item = history[position];
      if (item && typeof item === "object") {
        return String(item.value || "");
      }
      return String(item || "");
    }
    return String(entry && entry.value ? entry.value : "");
  }

  function getCardRecallMeta(entry, position) {
    const history = Array.isArray(entry && entry.history) ? entry.history : [];
    const currentPos = history.length;
    if (position >= currentPos) {
      return null;
    }
    const offset = currentPos - position;
    const item = history[position];
    const createdAt = item && typeof item === "object"
      ? String(item.createdAt || "")
      : "";
    return {
      offset,
      createdAt
    };
  }

  function handleFocusedSubSegCardKeyDown(event) {
    const active = document.activeElement;
    if (!active || !active.classList || !active.classList.contains("subseg-value-card-input")) {
      return false;
    }
    const keyCode = String(event.code || "");
    const keyValue = String(event.key || "");
    const isArrowRight = keyCode === "ArrowRight" || keyValue === "ArrowRight" || keyValue === "Right";
    const isArrowLeft = keyCode === "ArrowLeft" || keyValue === "ArrowLeft" || keyValue === "Left";
    const isArrowUp = keyCode === "ArrowUp" || keyValue === "ArrowUp" || keyValue === "Up";
    const isArrowDown = keyCode === "ArrowDown" || keyValue === "ArrowDown" || keyValue === "Down";
    const isSpace = keyCode === "Space" || keyValue === " " || keyValue === "Spacebar";
    const isBackspace = keyCode === "Backspace" || keyValue === "Backspace";
    const isCtrl = Boolean(event.ctrlKey || event.metaKey);
    const isShift = Boolean(event.shiftKey);
    if (!isCtrl) {
      return false;
    }

    const key = String(active.dataset.subSegValueKey || "");
    const index = Number(active.dataset.subSegValueIndex);
    const entry = getSubSegValueEntry(key, index);
    if (!entry) {
      return false;
    }
    const currentPos = getCardCurrentPosition(entry);
    let recallPos = getCardRecallPosition(key, index, entry);

    if (isSpace && (isCtrl || isShift)) {
      event.preventDefault();
      event.stopPropagation();
      if (audio.paused) {
        audio.play().catch(function () {});
      } else {
        audio.pause();
      }
      return true;
    }

    if (isBackspace && isCtrl) {
      event.preventDefault();
      event.stopPropagation();
      toggleSubSegCardDeleteDialog(key, index);
      return true;
    }

    if (isArrowUp || isArrowDown) {
      event.preventDefault();
      event.stopPropagation();
      moveFocusFromSubSegCardInput(key, index, isArrowDown ? 1 : -1);
      return true;
    }

    if ((isArrowLeft || isArrowRight)) {
      event.preventDefault();
      event.stopPropagation();
      if (isArrowLeft) {
        recallPos = Math.max(0, recallPos - 1);
      } else {
        recallPos = Math.min(currentPos, recallPos + 1);
      }
      setCardRecallPosition(key, index, recallPos);
      const isRecalling = recallPos < currentPos;
      renderSubSegValuePanel();
      focusSubSegCardInput(key, index, isRecalling);
      return true;
    }

    return false;
  }

  function focusSubSegCardInput(key, index, isRecalling) {
    requestAnimationFrame(function () {
      const selector = ".subseg-value-card-input[data-sub-seg-value-key=\"" + cssEscapeAttr(key) + "\"][data-sub-seg-value-index=\"" + String(index) + "\"]";
      const input = subSegValueList ? subSegValueList.querySelector(selector) : null;
      if (!input) {
        return;
      }
      input.readOnly = Boolean(isRecalling);
      input.classList.toggle("is-recalling", Boolean(isRecalling));
      try {
        input.focus({ preventScroll: true });
      } catch {
        input.focus();
      }
    });
  }

  function focusTopSubSegInput() {
    if (!subSegValueInput) {
      return;
    }
    requestAnimationFrame(function () {
      try {
        subSegValueInput.focus({ preventScroll: true });
      } catch {
        subSegValueInput.focus();
      }
    });
  }

  function moveFocusFromTopSubSegInput(delta) {
    const key = state.activeSubSegValueKey;
    const list = key && Array.isArray(state.subSegValueEntries[key]) ? state.subSegValueEntries[key] : [];
    const totalCards = list.length;
    if (totalCards <= 0) {
      return;
    }
    const totalSlots = totalCards + 1;
    const currentSlot = 0;
    const nextSlot = (currentSlot + delta + totalSlots) % totalSlots;
    if (nextSlot === 0) {
      focusTopSubSegInput();
      return;
    }
    const nextIndex = nextSlot - 1;
    const nextEntry = getSubSegValueEntry(key, nextIndex);
    if (!nextEntry) {
      return;
    }
    const nextCurrentPos = getCardCurrentPosition(nextEntry);
    const nextRecallPos = getCardRecallPosition(key, nextIndex, nextEntry);
    focusSubSegCardInput(key, nextIndex, nextRecallPos < nextCurrentPos);
  }

  function moveFocusFromSubSegCardInput(key, index, delta) {
    const list = Array.isArray(state.subSegValueEntries[key]) ? state.subSegValueEntries[key] : [];
    const totalCards = list.length;
    if (totalCards <= 0) {
      return;
    }
    const totalSlots = totalCards + 1;
    const currentSlot = index + 1;
    const nextSlot = (currentSlot + delta + totalSlots) % totalSlots;
    if (nextSlot === 0) {
      focusTopSubSegInput();
      return;
    }
    const nextIndex = nextSlot - 1;
    const nextEntry = getSubSegValueEntry(key, nextIndex);
    if (!nextEntry) {
      return;
    }
    const nextCurrentPos = getCardCurrentPosition(nextEntry);
    const nextRecallPos = getCardRecallPosition(key, nextIndex, nextEntry);
    focusSubSegCardInput(key, nextIndex, nextRecallPos < nextCurrentPos);
  }

  function cssEscapeAttr(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function toggleSubSegCardDeleteDialog(key, index) {
    const dialogKey = getSubSegCardRecallStateKey(key, index);
    if (state.subSegCardDeleteDialogKey === dialogKey) {
      state.subSegCardDeleteDialogKey = null;
      renderSubSegValuePanel();
      focusSubSegCardInput(key, index, false);
      return;
    }
    state.subSegCardDeleteDialogKey = dialogKey;
    renderSubSegValuePanel();
    focusSubSegDeleteCancel(key, index);
  }

  function focusSubSegDeleteCancel(key, index) {
    requestAnimationFrame(function () {
      const selector = "button[data-sub-seg-value-delete-cancel=\"1\"][data-sub-seg-value-key=\"" + cssEscapeAttr(key) + "\"][data-sub-seg-value-index=\"" + String(index) + "\"]";
      const btn = subSegValueList ? subSegValueList.querySelector(selector) : null;
      if (!btn) {
        return;
      }
      try {
        btn.focus({ preventScroll: true });
      } catch {
        btn.focus();
      }
    });
  }

  function deleteSubSegValueCard(key, index) {
    const list = Array.isArray(state.subSegValueEntries[key]) ? state.subSegValueEntries[key] : null;
    if (!list || index < 0 || index >= list.length) {
      return;
    }
    list.splice(index, 1);
    if (!list.length) {
      delete state.subSegValueEntries[key];
    }
    state.subSegCardDeleteDialogKey = null;
    const recallKeys = Object.keys(state.subSegCardRecallPositions);
    recallKeys.forEach(function (k) {
      if (k.startsWith(key + "#")) {
        delete state.subSegCardRecallPositions[k];
      }
    });
    renderSubSegValuePanel();
    enqueueAutoSave();
  }

  function seekBy(deltaSeconds) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const activeRange = getActiveLoopRange();
    debugLog("seekBy:start", {
      deltaSeconds,
      current,
      duration,
      selectedSpanIndex: state.selectedSpanIndex,
      targetSpanIndex: state.targetSpanIndex,
      activeRange
    });

    if (activeRange) {
      const spanStart = activeRange.start;
      const spanEnd = activeRange.end;
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
    debugLog("seekBy:end", {
      deltaSeconds,
      nextCurrent: Number.isFinite(audio.currentTime) ? audio.currentTime : null,
      selectedSpanIndex: state.selectedSpanIndex,
      targetSpanIndex: state.targetSpanIndex
    });
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

    renderMainSubSegOverlays();
    renderCheckpointMarkers();
    renderSelectedSpanOverlay();
    renderTargetProgress();
    syncSubSegValueSelectionToCurrentTarget();
    renderSubSegValuePanel();

    if (isPlayerActive() && duration > 0 && !state.hasAutoFocusedProgress) {
      state.hasAutoFocusedProgress = true;
      focusProgressControl();
    }
  }

  function clampCurrentTimeWithinSelectedSpan(ctx) {
    const { data } = ctx;
    const { duration } = data;
    let current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;

    const activeRange = getActiveLoopRange();
    if (activeRange) {
      const spanStart = activeRange.start;
      const spanEnd = activeRange.end;
      if (spanEnd > spanStart && (current < spanStart || current >= spanEnd)) {
        const epsilon = Math.min(0.02, (spanEnd - spanStart) / 4);
        const loopTime = current < spanStart ? Math.max(spanStart, spanEnd - epsilon) : spanStart;
        debugLog("clampCurrentTimeWithinSelectedSpan:loopClamp", {
          before: current,
          spanStart,
          spanEnd,
          loopTime,
          selectedSpanIndex: state.selectedSpanIndex,
          targetSpanIndex: state.targetSpanIndex
        });
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
    const targetSig = hasTargetSpan()
      ? String(state.targetStart.toFixed(3)) + "-" + String(state.targetEnd.toFixed(3))
      : "none";
    const signature = duration.toFixed(3) +
      "|" + state.checkpoints.map(function (v) { return v.toFixed(3); }).join(",") +
      "|" + String(Boolean(state.checkpointDrag)) +
      "|" + String(state.selectedSpanIndex) +
      "|" + targetSig;

    if (signature === state.markerSignature) {
      return;
    }

    state.markerSignature = signature;
    checkpointMarkers.innerHTML = "";

    if (duration <= 0) {
      return;
    }

    const selectedRange = hasTargetSpan() ? getTargetSpanBounds() : getSpanBoundsByIndex(state.selectedSpanIndex);
    const hasLockedTarget = hasTargetSpan();
    function classifyBoundary(seconds) {
      if (!selectedRange) {
        return "";
      }
      if (Math.abs(seconds - selectedRange.start) <= 0.01) {
        return "start";
      }
      if (Math.abs(seconds - selectedRange.end) <= 0.01) {
        return "end";
      }
      return "";
    }

    [0, duration].forEach(function (seconds) {
      const marker = document.createElement("span");
      marker.className = "checkpoint-marker";
      const percent = Math.max(0, Math.min(100, (seconds / duration) * 100));
      marker.style.left = String(percent) + "%";
      const boundaryRole = classifyBoundary(seconds);
      if (boundaryRole) {
        marker.classList.add("is-cycle-target-" + boundaryRole);
      }

      const tag = document.createElement("span");
      tag.className = "checkpoint-tag";
      if (boundaryRole) {
        tag.classList.add("cycle-target-tag", "cycle-target-tag-" + boundaryRole);
        if (hasLockedTarget && boundaryRole === "start") {
          tag.classList.add("checkpoint-tag-target-start");
        }
      }
      tag.textContent = formatTime(seconds);
      marker.appendChild(tag);

      checkpointMarkers.appendChild(marker);
    });

    const dragEnabled = !hasTargetSpan();
    state.checkpoints.forEach(function (seconds, checkpointIndex) {
      const marker = document.createElement("span");
      marker.className = "checkpoint-marker" + (dragEnabled ? " is-draggable" : "");
      if (state.checkpointDrag && state.checkpointDrag.index === checkpointIndex) {
        marker.classList.add("is-dragging");
      }
      const boundaryRole = classifyBoundary(seconds);
      if (boundaryRole) {
        marker.classList.add("is-cycle-target-" + boundaryRole);
      }
      const percent = Math.max(0, Math.min(100, (seconds / duration) * 100));
      marker.style.left = String(percent) + "%";
      marker.dataset.checkpointIndex = String(checkpointIndex);
      if (dragEnabled) {
        marker.addEventListener("mousedown", function (event) {
          beginCheckpointDrag(event, checkpointIndex);
        });
      }

      const tag = document.createElement("span");
      tag.className = "checkpoint-tag";
      if (boundaryRole) {
        tag.classList.add("cycle-target-tag", "cycle-target-tag-" + boundaryRole);
        if (hasLockedTarget && boundaryRole === "start") {
          tag.classList.add("checkpoint-tag-target-start");
        }
      }
      tag.textContent = formatTime(seconds);
      if (dragEnabled) {
        tag.addEventListener("mousedown", function (event) {
          beginCheckpointDrag(event, checkpointIndex);
        });
      }
      marker.appendChild(tag);

      checkpointMarkers.appendChild(marker);
    });
  }

  function renderMainSubSegOverlays() {
    if (!subSegOverlays) {
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const sig = duration.toFixed(3) + "|" + state.subSegs.map(function (seg, idx) {
      return String(idx) + ":" + seg.start.toFixed(3) + "-" + seg.end.toFixed(3);
    }).join(",");

    if (sig === state.subSegSignature) {
      return;
    }
    state.subSegSignature = sig;
    subSegOverlays.innerHTML = "";

    if (duration <= 0) {
      return;
    }

    state.subSegs.forEach(function (seg) {
      const start = Math.max(0, Math.min(duration, seg.start));
      const end = Math.max(0, Math.min(duration, seg.end));
      if (end <= start) {
        return;
      }
      const startPct = Math.max(0, Math.min(100, (start / duration) * 100));
      const endPct = Math.max(0, Math.min(100, (end / duration) * 100));
      const widthPct = Math.max(0.3, endPct - startPct);
      const span = document.createElement("span");
      span.className = "subseg-main-span";
      span.style.left = String(startPct) + "%";
      span.style.width = String(widthPct) + "%";
      subSegOverlays.appendChild(span);
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

  function renderTargetProgress() {
    if (!targetProgressWrap) {
      return;
    }
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const target = getTargetSpanBounds();
    if (!target || duration <= 0) {
      targetProgressWrap.classList.add("hidden");
      targetSpanOverlay.style.display = "none";
      if (targetSubSegActiveFill) {
        targetSubSegActiveFill.style.display = "none";
      }
      return;
    }

    targetProgressWrap.classList.remove("hidden");

    const current = Math.max(target.start, Math.min(target.end, Number.isFinite(audio.currentTime) ? audio.currentTime : target.start));
    const spanLength = Math.max(0, target.end - target.start);
    const spanPercent = spanLength > 0 ? Math.max(0, Math.min(100, ((current - target.start) / spanLength) * 100)) : 0;

    const selectedSubSeg = getTargetSubSegBoundsByIndex(state.selectedTargetSubSegIndex);
    const hasSelectedSubSeg = Boolean(selectedSubSeg && spanLength > 0);
    if (hasSelectedSubSeg) {
      targetProgress.value = 0;
      targetProgress.style.setProperty("--progress-pct", "0%");
    } else {
      targetProgress.value = Math.min(1000, Math.max(0, Math.round((spanPercent / 100) * 1000)));
      targetProgress.style.setProperty("--progress-pct", String(spanPercent) + "%");
    }
    targetPlayhead.style.left = String(spanPercent) + "%";
    targetPlayheadTime.textContent = formatTime(current);

    if (hasSelectedSubSeg && targetSubSegActiveFill) {
      const subSegStartPct = Math.max(0, Math.min(100, ((selectedSubSeg.start - target.start) / spanLength) * 100));
      const subSegCurrent = Math.max(selectedSubSeg.start, Math.min(selectedSubSeg.end, current));
      const subSegCurrentPct = Math.max(0, Math.min(100, ((subSegCurrent - target.start) / spanLength) * 100));
      const fillWidthPct = Math.max(0, subSegCurrentPct - subSegStartPct);
      targetSubSegActiveFill.style.display = "block";
      targetSubSegActiveFill.style.left = String(subSegStartPct) + "%";
      targetSubSegActiveFill.style.width = String(fillWidthPct) + "%";
    } else if (targetSubSegActiveFill) {
      targetSubSegActiveFill.style.display = "none";
    }

    targetSpanOverlay.style.display = "block";
    targetSpanOverlay.style.left = "0%";
    targetSpanOverlay.style.width = "100%";
    renderTargetMarkers(target);
  }

  function renderTargetMarkers(target) {
    const subSegSig = state.targetSubSegs.map(function (seg, idx) {
      return String(idx) + ":" + seg.start.toFixed(3) + "-" + seg.end.toFixed(3);
    }).join(",");
    const signature = [target.start, target.end, state.selectedTargetSubSegIndex, subSegSig]
      .map(function (v) { return String(v); })
      .join("|");
    if (state.targetMarkerSignature === signature) {
      return;
    }
    state.targetMarkerSignature = signature;
    targetCheckpointMarkers.innerHTML = "";

    [target.start, target.end].forEach(function (seconds, idx) {
      const marker = document.createElement("span");
      marker.className = "checkpoint-marker";
      marker.style.left = idx === 0 ? "0%" : "100%";

      const tag = document.createElement("span");
      tag.className = "checkpoint-tag";
      tag.textContent = formatTime(seconds);
      marker.appendChild(tag);

      targetCheckpointMarkers.appendChild(marker);
    });

    const spanLength = Math.max(0, target.end - target.start);
    if (spanLength <= 0) {
      return;
    }
    state.targetSubSegs.forEach(function (seg, idx) {
      const startPct = Math.max(0, Math.min(100, ((seg.start - target.start) / spanLength) * 100));
      const endPct = Math.max(0, Math.min(100, ((seg.end - target.start) / spanLength) * 100));
      const widthPct = Math.max(0.8, endPct - startPct);

      const span = document.createElement("span");
      span.className = "target-subseg-span" + (idx === state.selectedTargetSubSegIndex ? " selected" : "");
      span.style.left = String(startPct) + "%";
      span.style.width = String(widthPct) + "%";

      const tag = document.createElement("span");
      tag.className = "checkpoint-tag target-subseg-tag";
      tag.textContent = formatCompactedRange(seg.start, seg.end);
      span.appendChild(tag);

      targetCheckpointMarkers.appendChild(span);
    });
  }

  function formatTime(totalSeconds) {
    const safe = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
  }

  function formatCompactedRange(startSeconds, endSeconds) {
    const safeStart = Math.max(0, Math.floor(startSeconds));
    const safeEnd = Math.max(0, Math.floor(endSeconds));
    const startMinutes = Math.floor(safeStart / 60);
    const startRemainder = safeStart % 60;
    const endMinutes = Math.floor(safeEnd / 60);
    const endRemainder = safeEnd % 60;
    const startLabel = String(startMinutes).padStart(2, "0") + ":" + String(startRemainder).padStart(2, "0");
    if (startMinutes === endMinutes) {
      return startLabel + "-" + String(endRemainder);
    }
    return startLabel + "-" + String(endMinutes).padStart(2, "0") + ":" + String(endRemainder).padStart(2, "0");
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

  function normalizeSubSegs(subSegs) {
    const list = Array.isArray(subSegs) ? subSegs : [];
    const normalized = [];
    list.forEach(function (seg) {
      const start = Number(seg && seg.start);
      const end = Number(seg && seg.end);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return;
      }
      const clampedStart = Math.max(0, start);
      const clampedEnd = Math.max(0, end);
      if ((clampedEnd - clampedStart) <= 0.03) {
        return;
      }
      normalized.push({ start: clampedStart, end: clampedEnd });
    });
    normalized.sort(function (a, b) {
      if (Math.abs(a.start - b.start) > 0.01) {
        return a.start - b.start;
      }
      return a.end - b.end;
    });
    return normalized;
  }

  function normalizeSubSegValueEntries(rawEntries) {
    const source = rawEntries && typeof rawEntries === "object" ? rawEntries : {};
    const normalized = {};
    const nowIso = new Date().toISOString();
    Object.keys(source).forEach(function (key) {
      const values = Array.isArray(source[key]) ? source[key] : [];
      const cleaned = values
        .map(function (entry) {
          if (entry && typeof entry === "object") {
            const value = String(entry.value || "").trim();
            const createdAt = String(entry.createdAt || nowIso);
            const historyRaw = Array.isArray(entry.history) ? entry.history : [];
            const history = historyRaw
              .map(function (h) {
                if (h && typeof h === "object") {
                  const hv = String(h.value || "").trim();
                  if (!hv) {
                    return null;
                  }
                  return {
                    value: hv,
                    createdAt: String(h.createdAt || nowIso)
                  };
                }
                const hv = String(h || "").trim();
                if (!hv) {
                  return null;
                }
                return {
                  value: hv,
                  createdAt: nowIso
                };
              })
              .filter(function (h) { return Boolean(h); })
              .slice(0, 200);
            if (!value) {
              return null;
            }
            return { value, createdAt, history };
          }
          const value = String(entry || "").trim();
          if (!value) {
            return null;
          }
          return { value, createdAt: nowIso, history: [] };
        })
        .filter(function (v) { return Boolean(v); })
        .slice(0, 200);
      if (cleaned.length > 0) {
        normalized[key] = cleaned;
      }
    });
    return normalized;
  }

  function getSubSegsForBounds(bounds) {
    if (!bounds) {
      return [];
    }
    return state.subSegs.filter(function (seg) {
      return seg.start >= bounds.start - 0.01 && seg.end <= bounds.end + 0.01;
    });
  }

  function syncTargetSubSegsFromCurrentBounds(ctx) {
    const data = ctx || {};
    const selectedStart = Number(data.selectedStart);
    const selectedEnd = Number(data.selectedEnd);
    const bounds = getTargetSpanBounds();
    state.targetSubSegs = getSubSegsForBounds(bounds);
    if (!state.targetSubSegs.length) {
      state.selectedTargetSubSegIndex = -1;
      return;
    }

    if (Number.isFinite(selectedStart) && Number.isFinite(selectedEnd)) {
      const idx = state.targetSubSegs.findIndex(function (seg) {
        return Math.abs(seg.start - selectedStart) <= 0.01 && Math.abs(seg.end - selectedEnd) <= 0.01;
      });
      if (idx >= 0) {
        state.selectedTargetSubSegIndex = idx;
        return;
      }
    }

    if (state.selectedTargetSubSegIndex < 0 || state.selectedTargetSubSegIndex >= state.targetSubSegs.length) {
      state.selectedTargetSubSegIndex = -1;
    }
  }

  function getSpanBoundsByIndex(index) {
    const allCheckpoints = getCheckpointSeries();
    const spanCount = allCheckpoints.length - 1;
    if (index < 0 || index >= spanCount) {
      return null;
    }
    const start = allCheckpoints[index];
    const end = allCheckpoints[index + 1];
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    return { start, end, index };
  }

  function hasTargetSpan() {
    return Number.isFinite(state.targetStart) && Number.isFinite(state.targetEnd) && state.targetEnd > state.targetStart;
  }

  function getTargetSpanBounds() {
    if (!hasTargetSpan()) {
      return null;
    }
    return {
      start: state.targetStart,
      end: state.targetEnd,
      index: Number.isFinite(state.targetSpanIndex) ? state.targetSpanIndex : -1
    };
  }

  function getTargetSubSegBoundsByIndex(index) {
    if (index < 0 || index >= state.targetSubSegs.length) {
      return null;
    }
    const seg = state.targetSubSegs[index];
    if (!seg || !Number.isFinite(seg.start) || !Number.isFinite(seg.end) || seg.end <= seg.start) {
      return null;
    }
    return { start: seg.start, end: seg.end, index };
  }

  function getActiveLoopRange() {
    if (state.checkpointDrag) {
      return null;
    }
    const subSeg = getTargetSubSegBoundsByIndex(state.selectedTargetSubSegIndex);
    if (subSeg) {
      return subSeg;
    }
    const target = getTargetSpanBounds();
    if (target) {
      return target;
    }
    return getSpanBoundsByIndex(state.selectedSpanIndex);
  }

  function clearTargetSpanLock(ctx) {
    const data = ctx || {};
    const preserveSelection = Boolean(data.preserveSelection);
    const priorIndex = Number.isFinite(state.targetSpanIndex) ? state.targetSpanIndex : -1;
    state.targetSpanIndex = -1;
    state.targetStart = null;
    state.targetEnd = null;
    state.targetSubSegs = [];
    state.selectedTargetSubSegIndex = -1;
    state.subSegCardRecallPositions = {};
    state.subSegCardDeleteDialogKey = null;
    state.activeSubSegValueKey = null;
    state.shiftHoldTss = null;
    state.targetMarkerSignature = "";
    if (preserveSelection && priorIndex >= 0) {
      state.selectedSpanIndex = priorIndex;
    }
    debugLog("target:cleared", { preserveSelection, priorIndex, selectedSpanIndex: state.selectedSpanIndex });
  }

  function lockSelectedSpanAsTarget() {
    const span = getSpanBoundsByIndex(state.selectedSpanIndex);
    if (!span) {
      setSaveStatus("Select an audSeg first (Ctrl+Left/Right)");
      return;
    }
    if (!audio.paused) {
      audio.pause();
    }
    state.targetSpanIndex = span.index;
    state.targetStart = span.start;
    state.targetEnd = span.end;
    state.shiftHoldTss = null;
    syncTargetSubSegsFromCurrentBounds();
    state.selectedTargetSubSegIndex = -1;
    state.targetMarkerSignature = "";
    const spanLength = span.end - span.start;
    const epsilon = Math.min(0.02, Math.max(0.003, spanLength / 20));
    audio.currentTime = Math.min(span.end - 0.001, span.start + epsilon);
    updateUi();
    debugLog("target:locked", { index: span.index, start: span.start, end: span.end });
    setSaveStatus("audSeg target locked (playback reset to start)");
  }

  function enqueueAutoSave() {
    if (!state.currentFile || !audio.src) {
      return state.saveQueue;
    }

    state.isPersisting = true;
    setSaveStatus("Saving...");
    refreshCardInteractivity();
    renderAudioCards(state.sessionsCache);
    state.saveQueue = state.saveQueue
      .then(function () {
        return saveSessionState();
      })
      .then(function () {
        state.isPersisting = false;
        setSaveStatus("Saved");
        refreshCardInteractivity();
        renderAudioCards(state.sessionsCache);
      })
      .catch(function (error) {
        state.isPersisting = false;
        if (state.pendingUpload) {
          state.pendingUpload.phase = "failed";
        }
        setSaveStatus("Save failed: " + normalizeErrorMessage(error), true);
        refreshCardInteractivity();
        renderAudioCards(state.sessionsCache);
      });

    return state.saveQueue;
  }

  function refreshCardInteractivity() {
    const cardButtons = cards.querySelectorAll(".audio-card");
    cardButtons.forEach(function (button) {
      if (button.tagName === "BUTTON") {
        button.disabled = state.isPersisting;
      }
      button.classList.toggle("is-disabled", state.isPersisting);
    });
  }

  async function deleteSession(sessionId) {
    if (!sessionId || state.isPersisting || state.loadingSessionId) {
      return;
    }

    state.loadingSessionId = sessionId;
    state.openMenuSessionId = null;
    renderAudioCards(state.sessionsCache);

    try {
      const response = await fetch("/api/session?id=" + encodeURIComponent(sessionId), {
        method: "DELETE",
        headers: buildAuthHeaders()
      });
      if (response.status === 401) {
        clearLoginState("Login expired. Please sign in again.");
        return;
      }
      if (!response.ok) {
        const detail = await response.text().catch(function () { return ""; });
        throw new Error("session_delete_failed status=" + String(response.status) + " detail=" + detail);
      }

      if (state.activeSessionId === sessionId) {
        state.activeSessionId = null;
        state.activeAudioId = null;
        state.activeAudioUrl = null;
      }

      setSaveStatus("Deleted");
      await loadPersistedAudioCards();
    } catch (error) {
      setSaveStatus("Delete failed: " + normalizeErrorMessage(error), true);
    } finally {
      state.loadingSessionId = null;
      renderAudioCards(state.sessionsCache);
    }
  }

  function setSaveStatus(text, isError) {
    saveStatus.textContent = text;
    saveStatus.classList.toggle("error", Boolean(isError));
  }

  function setLoginStatus(text, isError) {
    if (!loginStatus) {
      return;
    }
    loginStatus.textContent = text;
    loginStatus.classList.toggle("error", Boolean(isError));
  }

  function normalizeErrorMessage(error) {
    const raw = String(error && error.message ? error.message : error || "unknown_error");
    return raw.length > 180 ? raw.slice(0, 180) + "..." : raw;
  }

  function persistLogin(record) {
    try {
      const safe = {
        username: String(record.username || "").toLowerCase(),
        token: String(record.token || ""),
        loggedInAt: Number(record.loggedInAt || Date.now()),
        ttlMs: Number(record.ttlMs || LOGIN_TTL_MS)
      };
      window.localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(safe));
    } catch {
      // Ignore storage failures.
    }
  }

  function restoreLoginFromStorage() {
    try {
      const raw = window.localStorage.getItem(LOGIN_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      const username = String(parsed && parsed.username ? parsed.username : "").toLowerCase();
      const token = String(parsed && parsed.token ? parsed.token : "");
      const loggedInAt = Number(parsed && parsed.loggedInAt);
      const ttlMs = Number(parsed && parsed.ttlMs ? parsed.ttlMs : LOGIN_TTL_MS);
      if (ALLOWED_USERS.indexOf(username) < 0 || !token || !Number.isFinite(loggedInAt) || !Number.isFinite(ttlMs) || ttlMs <= 0) {
        return null;
      }
      if ((Date.now() - loggedInAt) > ttlMs) {
        window.localStorage.removeItem(LOGIN_STORAGE_KEY);
        return null;
      }
      return { username, token, loggedInAt, ttlMs };
    } catch {
      return null;
    }
  }

  function buildAuthHeaders() {
    if (!state.authUser || !state.authToken) {
      return {};
    }
    return {
      "x-audio-user": state.authUser,
      "x-audio-auth": state.authToken
    };
  }

  function buildAuthenticatedAudioUrl(audioId) {
    const query = new URLSearchParams();
    query.set("id", String(audioId || ""));
    if (state.authUser) {
      query.set("username", state.authUser);
    }
    if (state.authToken) {
      query.set("authToken", state.authToken);
    }
    return "/api/audio?" + query.toString();
  }

  function clearLoginState(message) {
    state.authUser = null;
    state.authToken = null;
    state.activeSessionId = null;
    state.activeAudioId = null;
    state.activeAudioUrl = null;
    state.sessionsCache = [];
    state.openMenuSessionId = null;
    try {
      window.localStorage.removeItem(LOGIN_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    showLoginView();
    renderAudioCards([]);
    setLoginStatus(message || "Log in to continue.", true);
  }

  async function saveSessionState() {
    if (!audio.src || !state.currentFile) {
      return;
    }

    const uploadedAudio = await ensureAudioUploaded();

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
        subSegs: state.subSegs.map(function (seg) {
          return { start: seg.start, end: seg.end };
        }),
        subSegValueEntries: state.subSegValueEntries,
        selectedSpanIndex: -1,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        wasPlaying: !audio.paused
      },
      audioId: uploadedAudio.id
    };

    const response = await fetch("/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders()
      },
      body: JSON.stringify(payload)
    });
    if (response.status === 401) {
      clearLoginState("Login expired. Please sign in again.");
      throw new Error("auth_required");
    }

    if (!response.ok) {
      const detail = await response.text().catch(function () { return ""; });
      throw new Error("session_save_failed status=" + String(response.status) + " detail=" + detail);
    }

    const saved = await response.json();
    if (saved && saved.id) {
      state.activeSessionId = saved.id;
    }
    if (uploadedAudio && uploadedAudio.id) {
      state.activeAudioId = uploadedAudio.id;
      state.activeAudioUrl = uploadedAudio.url || null;
    }
    state.pendingUpload = null;

    await loadPersistedAudioCards();
  }

  async function applySavedSession(saved) {
    const savedFile = saved.file || {};
    const savedPlayback = saved.playback || {};
    debugLog("applySavedSession:start", {
      id: saved && saved.id,
      audioId: saved && saved.audioId,
      hasAudioUrl: Boolean(saved && saved.audioUrl),
      hasAudioBase64: Boolean(saved && saved.audioBase64),
      savedCurrentTime: savedPlayback.currentTime,
      savedSelectedSpanIndex: savedPlayback.selectedSpanIndex
    });
    if (saved && typeof saved.audioId === "string" && saved.audioId) {
      setAudioSourceFromRemoteUrl({
        data: {
          url: buildAuthenticatedAudioUrl(saved.audioId),
          displayName: savedFile.name || "Restored audio",
          fileMeta: savedFile
        },
        deps: {}
      });
    } else if (saved && typeof saved.audioUrl === "string" && saved.audioUrl) {
      setAudioSourceFromRemoteUrl({
        data: {
          url: saved.audioUrl,
          displayName: savedFile.name || "Restored audio",
          fileMeta: savedFile
        },
        deps: {}
      });
    } else {
      const audioBlob = await fetchSavedAudioBlob(saved);
      const blobType = savedFile.type || audioBlob.type || "audio/*";

      setAudioSource({ data: { file: audioBlob, displayName: savedFile.name || "Restored audio" }, deps: {} });

      state.currentFile = new File([audioBlob], savedFile.name || "restored-audio", {
        type: blobType,
        lastModified: savedFile.lastModified || Date.now()
      });
    }

    state.checkpoints = Array.isArray(savedPlayback.checkpoints)
      ? savedPlayback.checkpoints.filter(function (v) { return Number.isFinite(v) && v >= 0; }).sort(function (a, b) { return a - b; })
      : [];
    state.subSegs = normalizeSubSegs(savedPlayback.subSegs);
    state.subSegValueEntries = normalizeSubSegValueEntries(savedPlayback.subSegValueEntries);
    state.activeSubSegValueKey = null;

    state.selectedSpanIndex = -1;
    clearTargetSpanLock({ preserveSelection: false });
    state.markerSignature = "";
    state.subSegSignature = "";
    state.targetMarkerSignature = "";

    const resumeTime = Number.isFinite(savedPlayback.currentTime) ? savedPlayback.currentTime : 0;
    await waitForAudioReady();
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    const safeResume = Math.max(0, Math.min(duration || resumeTime, resumeTime));
    debugLog("applySavedSession:loadedmetadata", { duration, current, safeResume });
    if (safeResume > 0.05 && current <= 0.05) {
      audio.currentTime = safeResume;
      debugLog("applySavedSession:resumeApplied", { safeResume });
    }
    updateUi();
  }

  function setAudioSource(ctx) {
    const { data } = ctx;
    const { file, displayName } = data;

    revokeObjectUrl();

    state.currentFile = file instanceof File
      ? file
      : new File([file], String(displayName || "audio.bin"), { type: file.type || "application/octet-stream", lastModified: Date.now() });

    state.objectUrl = URL.createObjectURL(state.currentFile);
    audio.src = state.objectUrl;
    fileName.textContent = displayName || state.currentFile.name || "";
    state.hasAutoFocusedProgress = false;
    clearTargetSpanLock({ preserveSelection: false });
    state.markerSignature = "";
    state.subSegSignature = "";
    state.targetMarkerSignature = "";
  }

  function setAudioSourceFromRemoteUrl(ctx) {
    const { data } = ctx;
    const { url, displayName, fileMeta } = data;
    revokeObjectUrl();
    state.currentFile = {
      name: (fileMeta && fileMeta.name) || displayName || "audio",
      type: (fileMeta && fileMeta.type) || "audio/*",
      size: (fileMeta && fileMeta.size) || 0,
      lastModified: (fileMeta && fileMeta.lastModified) || Date.now()
    };
    audio.src = String(url || "");
    debugLog("setAudioSourceFromRemoteUrl", { url: audio.src, file: state.currentFile });
    fileName.textContent = displayName || state.currentFile.name || "";
    state.hasAutoFocusedProgress = false;
    clearTargetSpanLock({ preserveSelection: false });
    state.markerSignature = "";
    state.subSegSignature = "";
    state.targetMarkerSignature = "";
  }

  function focusProgressControl() {
    requestAnimationFrame(function () {
      try {
        progress.focus({ preventScroll: true });
      } catch {
        try {
          progress.focus();
        } catch {
          // Ignore focus failures.
        }
      }
    });
  }

  function waitForAudioReady() {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      return Promise.resolve();
    }
    return new Promise(function (resolve) {
      let settled = false;
      function done() {
        if (settled) {
          return;
        }
        settled = true;
        audio.removeEventListener("loadedmetadata", done);
        audio.removeEventListener("canplay", done);
        resolve();
      }
      audio.addEventListener("loadedmetadata", done, { once: true });
      audio.addEventListener("canplay", done, { once: true });
      window.setTimeout(done, 3000);
    });
  }

  function revokeObjectUrl() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  }

  async function ensureAudioUploaded() {
    if (state.activeAudioId) {
      return { id: state.activeAudioId, url: state.activeAudioUrl || buildAuthenticatedAudioUrl(state.activeAudioId) };
    }
    if (!state.currentFile) {
      throw new Error("missing_current_file");
    }

    setSaveStatus("Uploading audio...");

    const query = new URLSearchParams();
    query.set("name", state.currentFile.name || "audio.bin");
    query.set("type", state.currentFile.type || "application/octet-stream");
    query.set("lastModified", String(state.currentFile.lastModified || Date.now()));

    const payload = await uploadAudioWithProgress({
      data: {
        file: state.currentFile,
        queryString: query.toString()
      },
      deps: {}
    });

    if (!payload || !payload.ok || !payload.audio || !payload.audio.id) {
      throw new Error("audio_upload_invalid_response");
    }

    if (state.pendingUpload) {
      state.pendingUpload.progress = 1;
      state.pendingUpload.phase = "saving";
      renderAudioCards(state.sessionsCache);
    }

    state.activeAudioId = payload.audio.id;
    state.activeAudioUrl = payload.audio.url || null;
    return { id: state.activeAudioId, url: state.activeAudioUrl };
  }

  function uploadAudioWithProgress(ctx) {
    const { data } = ctx;
    const { file, queryString } = data;

    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/audio?" + queryString);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      const authHeaders = buildAuthHeaders();
      if (authHeaders["x-audio-user"]) {
        xhr.setRequestHeader("x-audio-user", authHeaders["x-audio-user"]);
      }
      if (authHeaders["x-audio-auth"]) {
        xhr.setRequestHeader("x-audio-auth", authHeaders["x-audio-auth"]);
      }

      xhr.upload.onprogress = function (event) {
        if (!event.lengthComputable || !state.pendingUpload) {
          return;
        }
        state.pendingUpload.progress = event.total > 0 ? event.loaded / event.total : 0;
        state.pendingUpload.phase = "uploading";
        renderAudioCards(state.sessionsCache);
      };

      xhr.onerror = function () {
        reject(new Error("audio_upload_network_error"));
      };

      xhr.onload = function () {
        let parsed = {};
        try {
          parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {};
        } catch {
          parsed = {};
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error("audio_upload_failed status=" + String(xhr.status)));
          return;
        }
        resolve(parsed);
      };

      xhr.send(file);
    });
  }

  async function fetchSavedAudioBlob(saved) {
    const blobType = saved && saved.file && saved.file.type ? saved.file.type : "application/octet-stream";
    if (saved && typeof saved.audioId === "string" && saved.audioId) {
      const response = await fetch("/api/audio?id=" + encodeURIComponent(saved.audioId), {
        method: "GET",
        cache: "no-store",
        headers: buildAuthHeaders()
      });
      if (!response.ok) {
        throw new Error("audio_fetch_failed");
      }
      return response.blob();
    }
    if (saved && typeof saved.audioUrl === "string" && saved.audioUrl) {
      const response = await fetch(saved.audioUrl, {
        method: "GET",
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("audio_fetch_failed");
      }
      return response.blob();
    }
    if (saved && typeof saved.audioBase64 === "string" && saved.audioBase64) {
      return base64ToBlob({ data: { base64: saved.audioBase64, mimeType: blobType }, deps: {} });
    }
    throw new Error("session_missing_audio_reference");
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
