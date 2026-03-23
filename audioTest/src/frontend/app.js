(function () {
  const LOGIN_STORAGE_KEY = "audioTest.auth";
  const GUIDE_SEEN_STORAGE_KEY = "audioTest.guideSeenByUser";
  const GUIDE_FEATURE_VERSION = "cards-feature-pack-2026-03-21d";
  const LOGIN_TTL_MS = 5 * 60 * 1000;
  const AUTH_PING_MIN_INTERVAL_MS = 30 * 1000;
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
  const subSegTimeline = document.getElementById("subseg-timeline");
  const subSegTimelineStart = document.getElementById("subseg-timeline-start");
  const subSegTimelineEnd = document.getElementById("subseg-timeline-end");
  const subSegTimelineTrack = document.getElementById("subseg-timeline-track");
  const subSegValueList = document.getElementById("subseg-value-list");
  const deleteConfirmDialog = document.getElementById("delete-confirm-dialog");
  const deleteConfirmText = document.getElementById("delete-confirm-text");
  const deleteConfirmCancel = document.getElementById("delete-confirm-cancel");
  const deleteConfirmDelete = document.getElementById("delete-confirm-delete");
  const guideButtonList = document.getElementById("guide-button-list");
  const guideButtonPlayer = document.getElementById("guide-button-player");
  const guideOverlay = document.getElementById("guide-overlay");
  const guideSpotlight = document.getElementById("guide-spotlight");
  const guideTooltip = document.getElementById("guide-tooltip");
  const guideCloseButton = document.getElementById("guide-close-button");
  const guideStepTitle = document.getElementById("guide-step-title");
  const guideStepText = document.getElementById("guide-step-text");
  const guideLanguagePicker = document.getElementById("guide-language-picker");
  const guideLangEn = document.getElementById("guide-lang-en");
  const guideLangZh = document.getElementById("guide-lang-zh");
  const guidePrevButton = document.getElementById("guide-prev-button");
  const guideNextButton = document.getElementById("guide-next-button");
  const guideStepCounter = document.getElementById("guide-step-counter");

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
    subSegCardLiveValueOverrides: {},
    subSegCardCommitTimerIds: {},
    subSegCardInternalChangeGuards: {},
    subSegCardBubbleValues: {},
    subSegCardBubbleCommitTimerIds: {},
    subSegCardDeleteDialogKey: null,
    subSegValueNodeIdCounter: 0,
    subSegTextMeasureCanvas: null,
    subSegTextMeasureCanvasContext: null,
    subSegTimelines: {},
    subSegTimelineEventIdCounter: 0,
    subSegTimelineVisible: false,
    subSegTimelineTraversal: false,
    subSegTimelineKey: "",
    subSegTimelineNodeIndex: -1,
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
    activeRevision: 0,
    saveQueue: Promise.resolve(),
    isPersisting: false,
    isGuideMode: false,
    guideStepIndex: -1,
    guideSteps: [],
    guideRafId: null,
    guideNavBlinkTimerId: null,
    guideNavBlinkIndex: 0,
    guideLanguage: "en",
    guidePhase: "list-language",
    guideTooltipLocked: false,
    deleteTargetType: "",
    deleteTargetIndex: -1,
    deleteConfirmOpen: false,
    guideFeatureBadgeVisible: false,
    guideFeatureSpotlightTimerId: null,
    authInactivityTimerId: null,
    lastActivityAt: 0,
    lastAuthPingAt: 0
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
  if (deleteConfirmCancel) {
    deleteConfirmCancel.addEventListener("click", function () {
      closeDeleteConfirmDialog();
      setSaveStatus("Delete cancelled");
    });
  }
  if (deleteConfirmDelete) {
    deleteConfirmDelete.addEventListener("click", function () {
      confirmDeleteTarget();
    });
  }
  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogoutClick);
  }
  uploadButton.addEventListener("click", openFilePicker);
  backButton.addEventListener("click", goBackToLibrary);
  if (guideButtonList) {
    guideButtonList.addEventListener("click", function () {
      startGuideMode({ deps: {} });
    });
  }
  if (guideButtonPlayer) {
    guideButtonPlayer.addEventListener("click", function () {
      startGuideMode({ deps: {} });
    });
  }
  if (guideCloseButton) {
    guideCloseButton.addEventListener("click", function () {
      stopGuideMode({ data: { reason: "closed" }, deps: {} });
    });
  }
  if (guidePrevButton) {
    guidePrevButton.addEventListener("click", function () {
      moveGuideStep({ data: { delta: -1 }, deps: {} });
    });
  }
  if (guideNextButton) {
    guideNextButton.addEventListener("click", function () {
      moveGuideStep({ data: { delta: 1 }, deps: {} });
    });
  }
  if (guideOverlay) {
    guideOverlay.addEventListener("click", handleGuideOverlayClick);
  }
  if (guideLangEn) {
    guideLangEn.addEventListener("click", function () {
      setGuideLanguage({ data: { language: "en" }, deps: {} });
    });
  }
  if (guideLangZh) {
    guideLangZh.addEventListener("click", function () {
      setGuideLanguage({ data: { language: "zh" }, deps: {} });
    });
  }
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
  window.addEventListener("resize", handleGuideViewportChanged);
  window.addEventListener("scroll", handleGuideViewportChanged, { capture: true });
  document.addEventListener("click", handleGlobalClick);
  ["pointerdown", "keydown", "input", "wheel", "touchstart"].forEach(function (eventName) {
    window.addEventListener(eventName, handleAuthActivity, { capture: true });
  });

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
      state.lastActivityAt = Number(restored.lastActivityAt || Date.now());
      state.lastAuthPingAt = 0;
      scheduleInactivityLogout();
      renderGuideFeatureBadge();
      setLoginStatus("Welcome back, " + restored.username + ".");
      showLibraryView();
      await loadPersistedAudioCards();
      return;
    }
    renderGuideFeatureBadge();
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
        ttlMs: ttl,
        lastActivityAt: Date.now()
      });

      state.authUser = payload.username;
      state.authToken = payload.token;
      state.lastActivityAt = Date.now();
      state.lastAuthPingAt = 0;
      scheduleInactivityLogout();
      renderGuideFeatureBadge();
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
    state.activeRevision = 0;
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
    const isDeleteKey = keyCode === "Delete" || keyValue === "Delete" || keyValue === "Del";
    const isBackspaceKey = keyCode === "Backspace" || keyValue === "Backspace";
    const isSpaceKey = keyCode === "Space" || keyValue === " " || keyValue === "Spacebar";
    const isEnterKey = keyCode === "Enter" || keyValue === "Enter";
    const isEscapeKey = keyCode === "Escape" || keyValue === "Escape" || keyValue === "Esc";
    const isShiftKey = keyCode === "ShiftLeft" || keyCode === "ShiftRight" || keyValue === "Shift";
    const activeElement = document.activeElement;
    const isSubSegInputFocused = activeElement === subSegValueInput;
    const isSubSegCardInputFocused = Boolean(
      activeElement &&
      activeElement.classList &&
      activeElement.classList.contains("subseg-value-card-input")
    );
    const isSubSegCardBubbleInputFocused = Boolean(
      activeElement &&
      activeElement.classList &&
      activeElement.classList.contains("subseg-value-card-bubble-input")
    );
    const isSubSegDeleteDialogButtonFocused = Boolean(
      activeElement &&
      activeElement.tagName === "BUTTON" &&
      activeElement.dataset &&
      (activeElement.dataset.subSegValueDeleteCancel === "1" || activeElement.dataset.subSegValueDeleteConfirm === "1")
    );
    const isDeleteConfirmControlFocused = Boolean(
      activeElement &&
      (activeElement === deleteConfirmCancel || activeElement === deleteConfirmDelete)
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

    if (state.isGuideMode) {
      const guideControlFocus = Boolean(
        activeElement &&
        activeElement.closest &&
        activeElement.closest("#guide-tooltip") &&
        (activeElement.tagName === "BUTTON" ||
          activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          activeElement.tagName === "SELECT")
      );
      if (isEscapeKey) {
        event.preventDefault();
        event.stopPropagation();
        stopGuideMode({ data: { reason: "escape" }, deps: {} });
        return;
      }
      if (guideControlFocus) {
        return;
      }
      if (isArrowLeft) {
        event.preventDefault();
        event.stopPropagation();
        moveGuideStep({ data: { delta: -1 }, deps: {} });
        return;
      }
      if (isArrowRight || isEnterKey || isSpaceKey) {
        event.preventDefault();
        event.stopPropagation();
        moveGuideStep({ data: { delta: 1 }, deps: {} });
        return;
      }
    }

    if (state.deleteConfirmOpen) {
      if (isEscapeKey || ((event.ctrlKey || event.metaKey) && isBackspaceKey)) {
        event.preventDefault();
        event.stopPropagation();
        clearDeleteTarget({ silent: false });
        updateUi();
        return;
      }
      if (isEnterKey) {
        event.preventDefault();
        event.stopPropagation();
        if (isDeleteConfirmControlFocused && activeElement === deleteConfirmDelete) {
          confirmDeleteTarget();
        } else {
          closeDeleteConfirmDialog();
          setSaveStatus("Delete cancelled");
        }
        return;
      }
      if (keyCode === "Tab") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (isSubSegCardInputFocused) {
      if (handleFocusedSubSegCardKeyDown(event)) {
        return;
      }
      return;
    }

    if (isSubSegDeleteDialogButtonFocused) {
      return;
    }

    if (isSubSegCardBubbleInputFocused) {
      return;
    }

    if (isSubSegInputFocused) {
      if ((event.ctrlKey || event.metaKey) && (isArrowLeft || isArrowRight)) {
        event.preventDefault();
        event.stopPropagation();
        traverseSubSegTimeline(isArrowRight ? 1 : -1);
      } else if ((event.ctrlKey || event.metaKey) && isBackspaceKey) {
        event.preventDefault();
        event.stopPropagation();
        if (state.subSegTimelineVisible) {
          hideSubSegTimeline();
          setSaveStatus("audSeg subSeg timeline hidden");
        } else {
          state.activeSubSegValueKey = null;
          resetSubSegTimelineUiState();
          state.subSegCardDeleteDialogKey = null;
          renderSubSegValuePanel();
          setSaveStatus("audSeg subSeg value selection exited");
        }
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (isArrowUp || isArrowDown)) {
        event.preventDefault();
        event.stopPropagation();
        moveFocusFromTopSubSegInput(isArrowDown ? 1 : -1);
      } else if ((event.ctrlKey || event.metaKey) && isDeleteKey) {
        event.preventDefault();
        event.stopPropagation();
        state.activeSubSegValueKey = null;
        resetSubSegTimelineUiState();
        state.subSegCardDeleteDialogKey = null;
        renderSubSegValuePanel();
        setSaveStatus("audSeg subSeg value selection exited");
      }
      return;
    }

    if (isShiftKey && isPlayerActive() && hasTargetSpan() && !Number.isFinite(state.shiftHoldTss)) {
      state.shiftHoldTss = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      debugLog("target:shiftHoldStart", { tss: state.shiftHoldTss });
      setSaveStatus("audSeg tss armed at " + formatTime(state.shiftHoldTss));
      return;
    }

    if ((event.ctrlKey || event.metaKey) && isBackspaceKey) {
      if (isPlayerActive()) {
        event.preventDefault();
        if (state.deleteConfirmOpen || hasDeleteTargetSelection()) {
          clearDeleteTarget({ silent: false });
          updateUi();
          return;
        }
        if (state.activeSubSegValueKey) {
          if (state.subSegTimelineVisible) {
            hideSubSegTimeline();
            setSaveStatus("audSeg subSeg timeline hidden");
          } else {
            state.activeSubSegValueKey = null;
            resetSubSegTimelineUiState();
            if (subSegValueInput) {
              subSegValueInput.value = "";
            }
            renderSubSegValuePanel();
            setSaveStatus("audSeg subSeg value selection cleared");
          }
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

    if ((event.ctrlKey || event.metaKey) && (isArrowUp || isArrowDown)) {
      event.preventDefault();
      cycleDeleteTarget(isArrowDown ? 1 : -1);
      return;
    }

    if (isEnterKey && hasDeleteTargetSelection()) {
      event.preventDefault();
      openDeleteConfirmDialog();
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
    if (state.isGuideMode && state.guidePhase.indexOf("list-") !== 0) {
      stopGuideMode({ data: { reason: "view-hidden", silent: true }, deps: {} });
    }
    blurActiveEditable();
    clearCheckpointDragState();
    loginView.classList.add("hidden");
    libraryView.classList.remove("hidden");
    playerView.classList.add("hidden");
    setPlayerLoading(false);
    state.isPlayerVisible = false;
    clearDeleteTarget({ silent: true });
  }

  function showPlayerView() {
    blurActiveEditable();
    loginView.classList.add("hidden");
    libraryView.classList.add("hidden");
    playerView.classList.remove("hidden");
    state.isPlayerVisible = true;
  }

  function showLoginView() {
    if (state.isGuideMode) {
      stopGuideMode({ data: { reason: "view-hidden", silent: true }, deps: {} });
    }
    blurActiveEditable();
    clearCheckpointDragState();
    loginView.classList.remove("hidden");
    libraryView.classList.add("hidden");
    playerView.classList.add("hidden");
    setPlayerLoading(false);
    state.isPlayerVisible = false;
    clearDeleteTarget({ silent: true });
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

  function handleGuideOverlayClick(event) {
    if (!state.isGuideMode || !guideOverlay || !guideTooltip) {
      return;
    }
    const target = event.target;
    const withinTooltip = target && target.closest && target.closest("#guide-tooltip");
    if (!withinTooltip) {
      stopGuideMode({ data: { reason: "backdrop" }, deps: {} });
    }
  }

  function handleGuideViewportChanged() {
    scheduleGuideStepRender({ deps: {} });
  }

  function getGuideCopy(ctx) {
    const { deps } = ctx;
    void deps;
    const copy = {
      en: {
        next: "Next",
        finish: "Finish",
        closed: "Guide mode closed",
        complete: "Guide complete",
        languageTitle: "Language",
        languageText: "Choose guide language. You can switch later in this same step.",
        uploadButtonTitle: "Upload Button",
        uploadButtonText: "Click Upload, choose your audio file, then wait for it to appear in the list.",
        demoCardReadyTitle: "Select Audio Item",
        demoCardReadyText: "When a file appears in the list, click its card to open it.",
        demoCardUploadTitle: "Watch Processing Progress",
        demoCardUploadText: "Use the progress state to confirm upload/processing is still running before you open the item.",
        demoCardLoadingTitle: "Enter Player",
        demoCardLoadingText: "After you click a card, wait for loading to finish, then continue in the player screen.",
        playerOverviewTitle: "Player Screen",
        playerOverviewText: "This is where playback editing happens. Follow the next steps in order during real work.",
        playerMainTitle: "Main Timeline",
        playerMainText: "Press Space to toggle play/pause on this timeline, then listen for structure points before adding checkpoints. Each span between two checkpoints is an audSeg.",
        checkpointSetTitle: "Add Checkpoint At Cursor",
        checkpointSetText: "Move playback to a logical boundary. Here the cursor is at 01:25. Press Shift+Space to add a checkpoint at this exact time.",
        checkpointAddTitle: "Checkpoint Timestamps",
        checkpointAddText: "Checkpoint tags are shown as timestamps, matching runtime view. Each pair of timestamps defines one audSeg boundary.",
        checkpointDeleteTargetTitle: "Delete Checkpoint Target",
        checkpointDeleteTargetText: "On the audEp bar, press Ctrl+Up/Down to cycle delete targets across checkpoint tags.",
        checkpointDeleteConfirmTitle: "Delete Checkpoint Confirm",
        checkpointDeleteConfirmText: "Press Enter to open delete dialog. In dialog, Enter on Delete confirms; Esc or Ctrl+Backspace cancels.",
        checkpointCycleTitle: "Cycle-Select Span",
        checkpointCycleText: "Use Ctrl+Left/Right to cycle checkpoint spans, then press Enter to lock the current span as target audSeg.",
        playerFocusTitle: "Target audSeg Bar",
        playerFocusText: "This lower bar shows the target audSeg you locked with Enter, so you can work inside that exact span.",
        subSegCardTitle: "subSeg Purpose",
        subSegCardText: "Use subSeg for short unclear audio you want to understand better (or cannot fully catch). Keep it very short, usually less than one sentence.",
        subSegStartTitle: "Set subSeg Start",
        subSegStartText: "At the beginning of unclear audio, hold Shift to set subSeg start, then keep listening for the end point.",
        subSegEndTitle: "Set subSeg End",
        subSegEndText: "At the end of that unclear audio, press Shift+Space to set subSeg end and finalize the subSeg.",
        subSegSelectTitle: "Select subSeg For Input",
        subSegSelectText: "Press Ctrl+Left/Right to cycle subSegs inside this audSeg. Stop on your target subSeg, then press Enter to open text input mode.",
        subSegDeleteTargetTitle: "Delete subSeg Target",
        subSegDeleteTargetText: "Inside target audSeg, press Ctrl+Up/Down to cycle delete targets across subSeg tags.",
        subSegDeleteConfirmTitle: "Delete subSeg Confirm",
        subSegDeleteConfirmText: "Press Enter to open delete dialog. In dialog, Enter on Delete confirms; Esc or Ctrl+Backspace cancels.",
        guideCheckpointDeleteSummary: "checkpoint at 02:12",
        guideSubSegDeleteSummary: "subSeg 01:41-49",
        inputTitle: "Text Input",
        inputText: "Purpose: write your best attempt of the target subSeg audio. If words are uncertain, approximate from hearing only. Do not use dictionary or outside sources.",
        firstCardInputTitle: "Enter First Card Value",
        firstCardInputText: "Type your first best-attempt text (example: 'å‰åŽä¸¤æ¸…') in the top input and press Enter to create the first card version.",
        cardsTitle: "First Version Saved",
        cardsText: "After Enter, the first input becomes the first version on this card.",
        cardEditTitle: "Edit To New Version",
        cardEditText: "Focus this card, update your text after re-listening (example now: 'é’±è´§ä¸¤æ¸…'), then save. The prior text remains as version history on the same card.",
        cardChildSelectTitle: "Create Child Cards",
        cardChildSelectText: "Goal: split a long parent phrase into a smaller focused idea you want to track as its own child card. On parent text 'é’±è´§ä¸¤æ¸…', focus the parent input, highlight 'é’±è´§', then press Enter.",
        cardChildCreatedTitle: "Child Card Created",
        cardChildCreatedText: "After Enter, a child card appears directly under the parent using the selected substring. Repeat on any child to nest deeper. Siblings are ordered by earliest highlighted index in parent text, and each child indents +5px per level.",
        cardNavVerticalTitle: "Move Between Cards",
        cardNavVerticalText: "Press Ctrl+Up or Ctrl+Down to move focus to another card.",
        cardNavHistoryTitle: "Review Earlier Wording",
        cardNavHistoryText: "On the focused card, press Ctrl+Left or Ctrl+Right to switch between older and newer versions.",
        cardDeleteTitle: "Card Delete Dialog",
        cardDeleteText: "On a focused card input, press Ctrl+Backspace to open card delete actions.",
        cardDeleteConfirmTitle: "Card Delete Actions",
        cardDeleteConfirmText: "Use Cancel to close the dialog or Delete to remove the current card.",
        exitValueModeTitle: "Exit Input Mode",
        exitValueModeText: "Press Ctrl+Backspace while in top value input mode to exit value-entry mode.",
        exitSubSegTitle: "Exit subSeg Selection",
        exitSubSegText: "Press Ctrl+Backspace again to clear current subSeg selection.",
        exitTargetTitle: "Exit target audSeg",
        exitTargetText: "Press Ctrl+Backspace again to unlock and exit target audSeg mode.",
        exitAudSegTitle: "Exit audSeg Selection",
        exitAudSegText: "Press Ctrl+Backspace again to clear current audSeg selection on the main timeline.",
        exitListTitle: "Return to List",
        exitListText: "Press Ctrl+Backspace once more (with no selection active) to return to the list page."
      },
      zh: {
        next: "\u4e0b\u4e00\u6b65",
        finish: "\u5b8c\u6210",
        closed: "\u5f15\u5bfc\u6a21\u5f0f\u5df2\u5173\u95ed",
        complete: "\u5f15\u5bfc\u5b8c\u6210",
        languageTitle: "\u8bed\u8a00",
        languageText: "\u8bf7\u9009\u62e9\u5f15\u5bfc\u8bed\u8a00\u3002\u4f60\u53ef\u4ee5\u5728\u672c\u6b65\u9aa4\u968f\u65f6\u5207\u6362\u3002",
        uploadButtonTitle: "\u4e0a\u4f20\u6309\u94ae",
        uploadButtonText: "\u70b9\u51fb\u4e0a\u4f20\uff0c\u9009\u62e9\u97f3\u9891\u6587\u4ef6\uff0c\u7136\u540e\u7b49\u5f85\u5b83\u51fa\u73b0\u5728\u5217\u8868\u91cc\u3002",
        demoCardReadyTitle: "\u9009\u62e9\u97f3\u9891\u6761\u76ee",
        demoCardReadyText: "\u5f53\u6587\u4ef6\u51fa\u73b0\u5728\u5217\u8868\u4e2d\uff0c\u70b9\u51fb\u8be5\u5361\u7247\u8fdb\u5165\u64ad\u653e\u9875\u3002",
        demoCardUploadTitle: "\u67e5\u770b\u5904\u7406\u8fdb\u5ea6",
        demoCardUploadText: "\u5148\u786e\u8ba4\u4e0a\u4f20/\u5904\u7406\u8fdb\u5ea6\u8fd8\u5728\u8fd0\u884c\uff0c\u518d\u53bb\u6253\u5f00\u8be5\u6761\u76ee\u3002",
        demoCardLoadingTitle: "\u8fdb\u5165\u64ad\u653e\u9875",
        demoCardLoadingText: "\u70b9\u51fb\u5361\u7247\u540e\uff0c\u7b49\u5f85\u52a0\u8f7d\u5b8c\u6210\uff0c\u7136\u540e\u5728\u64ad\u653e\u9875\u7ee7\u7eed\u64cd\u4f5c\u3002",
        playerOverviewTitle: "\u64ad\u653e\u5668\u9875\u9762",
        playerOverviewText: "\u8fd9\u91cc\u662f\u64ad\u653e\u4e0e\u6807\u6ce8\u7684\u4e3b\u5de5\u4f5c\u533a\u3002\u6309\u7167\u540e\u7eed\u6b65\u9aa4\u5373\u53ef\u5b8c\u6210\u5b9e\u9645\u64cd\u4f5c\u3002",
        playerMainTitle: "\u4e3b\u65f6\u95f4\u8f74",
        playerMainText: "\u5728\u4e3b\u65f6\u95f4\u8f74\u6309 Space \u5207\u6362\u64ad\u653e/\u6682\u505c\uff0c\u5148\u542c\u51fa\u5185\u5bb9\u7ed3\u6784\u65ad\u70b9\uff0c\u518d\u6dfb\u52a0\u68c0\u67e5\u70b9\u3002\u6bcf\u4e24\u4e2a\u68c0\u67e5\u70b9\u4e4b\u95f4\u7684\u7247\u6bb5\u79f0\u4e3a audSeg\u3002",
        checkpointSetTitle: "\u5728\u5149\u6807\u5904\u6dfb\u52a0\u68c0\u67e5\u70b9",
        checkpointSetText: "\u5c06\u64ad\u653e\u5b9a\u4f4d\u5230\u903b\u8f91\u8fb9\u754c\u3002\u6b64\u5904\u5149\u6807\u5728 01:25\uff0c\u6309 Shift+Space \u5373\u53ef\u5728\u8be5\u65f6\u95f4\u6dfb\u52a0\u68c0\u67e5\u70b9\u3002",
        checkpointAddTitle: "\u68c0\u67e5\u70b9\u65f6\u95f4\u6233",
        checkpointAddText: "\u68c0\u67e5\u70b9\u6807\u7b7e\u4ee5\u65f6\u95f4\u6233\u663e\u793a\uff08\u4e0e\u8fd0\u884c\u754c\u9762\u4e00\u81f4\uff09\u3002\u6bcf\u4e24\u4e2a\u65f6\u95f4\u6233\u5b9a\u4e49\u4e00\u4e2a audSeg \u8fb9\u754c\u3002",
        checkpointDeleteTargetTitle: "\u9009\u62e9\u8981\u5220\u9664\u7684 checkpoint",
        checkpointDeleteTargetText: "\u5728 audEp \u8fdb\u5ea6\u6761\u4e0a\u6309 Ctrl+\u4e0a/\u4e0b\uff0c\u5728 checkpoint \u6807\u7b7e\u95f4\u5faa\u73af\u9009\u62e9\u5220\u9664\u76ee\u6807\u3002",
        checkpointDeleteConfirmTitle: "\u786e\u8ba4\u5220\u9664 checkpoint",
        checkpointDeleteConfirmText: "\u6309 Enter \u6253\u5f00\u5220\u9664\u786e\u8ba4\u6846\u3002\u5728\u786e\u8ba4\u6846\u4e2d\uff0c\u5bf9\u7740 Delete \u6309 Enter \u6267\u884c\u5220\u9664\uff1bEsc \u6216 Ctrl+Backspace \u53d6\u6d88\u3002",
        checkpointCycleTitle: "\u5faa\u73af\u9009\u62e9\u8303\u56f4",
        checkpointCycleText: "\u4f7f\u7528 Ctrl+\u5de6/\u53f3 \u5728\u68c0\u67e5\u70b9\u5206\u6bb5\u95f4\u5faa\u73af\u9009\u62e9\uff0c\u7136\u540e\u6309 Enter \u5c06\u5f53\u524d\u5206\u6bb5\u9501\u5b9a\u4e3a target audSeg\u3002",
        playerFocusTitle: "\u76ee\u6807 audSeg \u8303\u56f4\u6761",
        playerFocusText: "\u8fd9\u4e2a\u4e0b\u65b9\u8303\u56f4\u6761\u5c31\u662f\u4f60\u7528 Enter \u9501\u5b9a\u7684 target audSeg\uff0c\u7528\u4e8e\u5728\u8be5\u8303\u56f4\u5185\u7cbe\u7ec6\u64cd\u4f5c\u3002",
        subSegCardTitle: "subSeg \u7528\u9014",
        subSegCardText: "subSeg \u7528\u4e8e\u622a\u53d6\u4f60\u542c\u4e0d\u592a\u61c2\u3001\u60f3\u8fdb\u4e00\u6b65\u7406\u89e3\u6216\u65e0\u6cd5\u786e\u5b9a\u7684\u77ed\u97f3\u9891\u7247\u6bb5\u3002\u5c3d\u91cf\u4fdd\u6301\u5f88\u77ed\uff0c\u901a\u5e38\u5c11\u4e8e\u4e00\u53e5\u8bdd\u3002",
        subSegStartTitle: "\u8bbe\u7f6e subSeg \u8d77\u70b9",
        subSegStartText: "\u5728\u542c\u4e0d\u6e05\u5185\u5bb9\u7684\u8d77\u70b9\u6309\u4f4f Shift \u8bbe\u5b9a subSeg \u5f00\u59cb\uff0c\u7136\u540e\u7ee7\u7eed\u542c\u5230\u7ed3\u675f\u70b9\u3002",
        subSegEndTitle: "\u8bbe\u7f6e subSeg \u7ec8\u70b9",
        subSegEndText: "\u5728\u8be5\u542c\u4e0d\u6e05\u7247\u6bb5\u7684\u7ed3\u675f\u70b9\u6309 Shift+Space\uff0c\u8bbe\u7f6e subSeg \u7ec8\u70b9\u5e76\u5b8c\u6210 subSeg\u3002",
        subSegSelectTitle: "\u9009\u62e9\u8981\u8f93\u5165\u7684 subSeg",
        subSegSelectText: "\u6309 Ctrl+\u5de6/\u53f3 \u5728\u5f53\u524d audSeg \u5185\u5faa\u73af\u9009\u62e9 subSeg\u3002\u9009\u4e2d\u76ee\u6807 subSeg \u540e\uff0c\u6309 Enter \u8fdb\u5165\u6587\u672c\u8f93\u5165\u6a21\u5f0f\u3002",
        subSegDeleteTargetTitle: "\u9009\u62e9\u8981\u5220\u9664\u7684 subSeg",
        subSegDeleteTargetText: "\u5728 target audSeg \u5185\u6309 Ctrl+\u4e0a/\u4e0b\uff0c\u5728 subSeg \u6807\u7b7e\u95f4\u5faa\u73af\u9009\u62e9\u5220\u9664\u76ee\u6807\u3002",
        subSegDeleteConfirmTitle: "\u786e\u8ba4\u5220\u9664 subSeg",
        subSegDeleteConfirmText: "\u6309 Enter \u6253\u5f00\u5220\u9664\u786e\u8ba4\u6846\u3002\u5728\u786e\u8ba4\u6846\u4e2d\uff0c\u5bf9\u7740 Delete \u6309 Enter \u6267\u884c\u5220\u9664\uff1bEsc \u6216 Ctrl+Backspace \u53d6\u6d88\u3002",
        guideCheckpointDeleteSummary: "checkpoint at 02:12",
        guideSubSegDeleteSummary: "subSeg 01:41-49",
        inputTitle: "\u6587\u672c\u8f93\u5165\u6846",
        inputText: "\u76ee\u7684\uff1a\u5c06 target subSeg \u7684\u97f3\u9891\u5185\u5bb9\u5c3d\u529b\u5199\u4e0b\u6765\u3002\u4e0d\u786e\u5b9a\u7684\u8bcd\u8bf7\u6309\u542c\u611f\u8fd1\u4f3c\u62fc\u5199\uff0c\u4e0d\u8981\u67e5\u5b57\u5178\uff0c\u4e5f\u4e0d\u8981\u4f9d\u8d56\u5916\u90e8\u8d44\u6e90\u3002",
        firstCardInputTitle: "\u8f93\u5165\u7b2c\u4e00\u7248\u5361\u7247\u5185\u5bb9",
        firstCardInputText: "\u5728\u9876\u90e8\u8f93\u5165\u6846\u8f93\u5165\u7b2c\u4e00\u6b21\u542c\u5199\uff08\u793a\u4f8b\uff1a\u201c\u524d\u540e\u4e24\u6e05\u201d\uff09\uff0c\u7136\u540e\u6309 Enter \u521b\u5efa\u7b2c\u4e00\u7248\u3002",
        cardsTitle: "\u7b2c\u4e00\u7248\u5df2\u4fdd\u5b58",
        cardsText: "\u6309 Enter \u540e\uff0c\u8f93\u5165\u5185\u5bb9\u4f1a\u4f5c\u4e3a\u8fd9\u5f20\u5361\u7684\u7b2c\u4e00\u4e2a\u7248\u672c\u3002",
        cardEditTitle: "\u4fee\u6539\u4e3a\u65b0\u7248\u672c",
        cardEditText: "\u805a\u7126\u8be5\u5361\u540e\uff0c\u91cd\u542c\u97f3\u9891\u5e76\u4fee\u6539\u6587\u5b57\uff08\u793a\u4f8b\u66f4\u65b0\u4e3a\u201c\u94b1\u8d27\u4e24\u6e05\u201d\uff09\uff0c\u518d\u4fdd\u5b58\u3002\u65e7\u7248\u672c\u4f1a\u7559\u5728\u540c\u4e00\u5f20\u5361\u7684\u5386\u53f2\u4e2d\u3002",
        cardChildSelectTitle: "\u521b\u5efa\u5b50\u5361\u7247",
        cardChildSelectText: "\u76ee\u7684\uff1a\u628a\u8f83\u957f\u7684\u7236\u5361\u77ed\u8bed\u62c6\u6210\u4e00\u4e2a\u66f4\u805a\u7126\u7684\u5b50\u610f\u601d\uff0c\u4f5c\u4e3a\u72ec\u7acb\u5b50\u5361\u8ddf\u8e2a\u3002\u4ee5\u201c\u94b1\u8d27\u4e24\u6e05\u201d\u4e3a\u7236\u5361\uff0c\u805a\u7126\u7236\u5361\u8f93\u5165\u6846\uff0c\u9ad8\u4eae\u9009\u4e2d\u201c\u94b1\u8d27\u201d\uff0c\u7136\u540e\u6309 Enter\u3002",
        cardChildCreatedTitle: "\u5b50\u5361\u5df2\u521b\u5efa",
        cardChildCreatedText: "\u6309 Enter \u540e\uff0c\u4f1a\u5728\u7236\u5361\u4e0b\u65b9\u521b\u5efa\u4e00\u5f20\u5b50\u5361\uff08\u5185\u5bb9\u4e3a\u9009\u4e2d\u5b50\u4e32\uff09\u3002\u53ef\u5728\u5b50\u5361\u4e0a\u7ee7\u7eed\u6267\u884c\u76f8\u540c\u64cd\u4f5c\u4ee5\u5d4c\u5957\u3002\u540c\u7ea7\u5b50\u5361\u4f1a\u6309\u7236\u6587\u672c\u4e2d\u9ad8\u4eae\u8d77\u59cb\u4f4d\u7f6e\u6392\u5e8f\uff0c\u6bcf\u5c42\u76f8\u5bf9\u7236\u5361\u5411\u53f3\u7f29\u8fdb +5px\u3002",
        cardNavVerticalTitle: "\u5728\u5361\u7247\u95f4\u79fb\u52a8",
        cardNavVerticalText: "\u6309 Ctrl+\u4e0a \u6216 Ctrl+\u4e0b\uff0c\u628a\u7126\u70b9\u79fb\u5230\u5176\u4ed6\u5361\u7247\u3002",
        cardNavHistoryTitle: "\u67e5\u770b\u524d\u540e\u7248\u672c",
        cardNavHistoryText: "\u5728\u5f53\u524d\u5df2\u805a\u7126\u5361\u7247\u4e0a\uff0c\u6309 Ctrl+\u5de6 \u6216 Ctrl+\u53f3\uff0c\u5207\u6362\u66f4\u65e9/\u66f4\u65b0\u6587\u672c\u7248\u672c\u3002",
        cardDeleteTitle: "\u6253\u5f00\u5361\u7247\u5220\u9664\u5bf9\u8bdd",
        cardDeleteText: "\u5728\u5df2\u805a\u7126\u7684\u5361\u7247\u8f93\u5165\u6846\u4e0a\u6309 Ctrl+Backspace\uff0c\u6253\u5f00\u8be5\u5361\u7247\u7684\u5220\u9664\u64cd\u4f5c\u3002",
        cardDeleteConfirmTitle: "\u5361\u7247\u5220\u9664\u64cd\u4f5c",
        cardDeleteConfirmText: "\u70b9 Cancel \u5173\u95ed\u5bf9\u8bdd\uff0c\u70b9 Delete \u5220\u9664\u5f53\u524d\u5361\u7247\u3002",
        exitValueModeTitle: "\u9000\u51fa\u8f93\u5165\u6a21\u5f0f",
        exitValueModeText: "\u5728\u9876\u90e8\u503c\u8f93\u5165\u6a21\u5f0f\u4e0b\u6309 Ctrl+Backspace\uff0c\u9000\u51fa\u503c\u8f93\u5165\u6a21\u5f0f\u3002",
        exitSubSegTitle: "\u9000\u51fa subSeg \u9009\u4e2d",
        exitSubSegText: "\u518d\u6309\u4e00\u6b21 Ctrl+Backspace\uff0c\u6e05\u9664\u5f53\u524d subSeg \u9009\u4e2d\u3002",
        exitTargetTitle: "\u9000\u51fa target audSeg",
        exitTargetText: "\u518d\u6309\u4e00\u6b21 Ctrl+Backspace\uff0c\u89e3\u9501\u5e76\u9000\u51fa target audSeg \u6a21\u5f0f\u3002",
        exitAudSegTitle: "\u9000\u51fa audSeg \u9009\u4e2d",
        exitAudSegText: "\u518d\u6309\u4e00\u6b21 Ctrl+Backspace\uff0c\u6e05\u9664\u4e3b\u65f6\u95f4\u8f74\u4e0a\u5f53\u524d audSeg \u9009\u4e2d\u3002",
        exitListTitle: "\u8fd4\u56de\u5217\u8868\u9875",
        exitListText: "\u65e0\u4efb\u4f55\u9009\u4e2d\u65f6\uff0c\u518d\u6309\u4e00\u6b21 Ctrl+Backspace \u8fd4\u56de\u5217\u8868\u9875\u3002"
      }
    };
    return copy[state.guideLanguage] || copy.en;
  }
  function setGuideLanguage(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    const next = data.language === "zh" ? "zh" : "en";
    state.guideLanguage = next;
    renderGuideLanguagePicker({ deps: {} });
    if (state.isGuideMode) {
      renderGuideStep({ deps: {} });
    }
  }

  function renderGuideLanguagePicker(ctx) {
    const { deps } = ctx;
    void deps;
    if (!guideLanguagePicker || !guideLangEn || !guideLangZh) {
      return;
    }
    guideLangEn.classList.toggle("is-active", state.guideLanguage === "en");
    guideLangZh.classList.toggle("is-active", state.guideLanguage === "zh");
  }

  function isGuideListPhase(ctx) {
    const { deps } = ctx;
    void deps;
    return state.guidePhase.indexOf("list-") === 0;
  }

  function applyGuidePhase(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    const phase = String(data.phase || "");
    state.guidePhase = phase;

    if (phase.indexOf("list-") === 0) {
      showLibraryView();
      state.openMenuSessionId = null;
      cards.innerHTML = "";
      renderGuideAudioCards({ deps: {} });
      return;
    }

    showPlayerView();
    setPlayerLoading(false);
    renderGuidePlayerState({ data: { phase }, deps: {} });
  }

  function renderGuideAudioCards(ctx) {
    const { deps } = ctx;
    void deps;
    cards.innerHTML = "";
    emptyState.classList.add("hidden");
    const phase = state.guidePhase;

    if (phase === "list-language" || phase === "list-overview" || phase === "list-card-ready") {
      cards.appendChild(createGuideReadyCard({ deps: {} }));
      return;
    }

    if (phase === "list-card-upload") {
      cards.appendChild(createPendingAudioCard({
        file: { name: "Guide Demo - New Recording.mp3" },
        phase: "uploading",
        progress: 0.62
      }));
      return;
    }

    if (phase === "list-card-loading") {
      cards.appendChild(createGuideLoadingCard({ deps: {} }));
      return;
    }

    cards.appendChild(createGuideReadyCard({ deps: {} }));
  }

  function createGuideReadyCard(ctx) {
    const { deps } = ctx;
    void deps;
    const row = document.createElement("div");
    row.className = "audio-card-row";
    row.id = "guide-demo-card-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "audio-card audio-card-main";
    button.id = "guide-demo-card";

    const title = document.createElement("span");
    title.className = "audio-card-title";
    title.textContent = "Guide Demo - Episode 01.mp3";

    const meta = document.createElement("span");
    meta.className = "audio-card-meta";
    meta.textContent = "Guide sample  |  checkpoints: 6";

    button.appendChild(title);
    button.appendChild(meta);
    row.appendChild(button);

    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "item-settings-button";
    settingsButton.textContent = "...";
    settingsButton.disabled = true;
    row.appendChild(settingsButton);
    return row;
  }

  function createGuideLoadingCard(ctx) {
    const { deps } = ctx;
    void deps;
    const row = document.createElement("div");
    row.className = "audio-card-row";
    row.id = "guide-demo-card-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "audio-card audio-card-main is-loading";
    button.id = "guide-demo-card";
    button.disabled = true;

    const title = document.createElement("span");
    title.className = "audio-card-title";
    title.textContent = "Guide Demo - Episode 01.mp3";
    const meta = document.createElement("span");
    meta.className = "audio-card-meta";
    meta.textContent = "Opening...";
    button.appendChild(title);
    button.appendChild(meta);
    button.appendChild(createProgressRow({ mode: "indeterminate", label: "Loading audio..." }));
    row.appendChild(button);
    return row;
  }

  function renderGuideCheckpointMarkers(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    const markers = Array.isArray(data.markers) ? data.markers : [];
    checkpointMarkers.innerHTML = "";
    markers.forEach(function (markerDef) {
      const marker = document.createElement("span");
      marker.className = "checkpoint-marker";
      if (markerDef.boundary === "start" || markerDef.boundary === "end") {
        marker.classList.add("is-cycle-target-" + markerDef.boundary);
        marker.classList.add("is-tag-target");
      }
      marker.style.left = String(markerDef.pct || 0) + "%";

      const tag = document.createElement("span");
      tag.className = "checkpoint-tag";
      if (markerDef.deleteTarget) {
        tag.classList.add("is-delete-target");
        marker.classList.add("is-tag-target");
      }
      if (markerDef.boundary === "start" || markerDef.boundary === "end") {
        tag.classList.add("cycle-target-tag", "cycle-target-tag-" + markerDef.boundary);
      }
      tag.textContent = String(markerDef.label || "");
      marker.appendChild(tag);
      checkpointMarkers.appendChild(marker);
    });
  }

  function renderGuideBoundaryTagMarkers(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    const container = data.container;
    const startLabel = String(data.startLabel || "");
    const endLabel = String(data.endLabel || "");
    const tagExtraClass = String(data.tagExtraClass || "");
    if (!container) {
      return;
    }
    [
      { pct: 0, label: startLabel },
      { pct: 100, label: endLabel }
    ].forEach(function (item) {
      const marker = document.createElement("span");
      marker.className = "checkpoint-marker";
      marker.style.left = String(item.pct) + "%";
      const tag = document.createElement("span");
      tag.className = "checkpoint-tag" + (tagExtraClass ? " " + tagExtraClass : "");
      tag.textContent = item.label;
      marker.appendChild(tag);
      container.appendChild(marker);
    });
  }

  function renderGuideTargetSubSeg(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    const mode = String(data.mode || "complete");
    const deleteTarget = Boolean(data.deleteTarget);
    if (targetSubSegActiveFill) {
      if (mode === "complete") {
        targetSubSegActiveFill.style.display = "block";
        targetSubSegActiveFill.style.left = "34%";
        targetSubSegActiveFill.style.width = "18%";
      } else {
        targetSubSegActiveFill.style.display = "none";
      }
    }
    if (targetCheckpointMarkers) {
      targetCheckpointMarkers.innerHTML = "";
      renderGuideBoundaryTagMarkers({
        data: {
          container: targetCheckpointMarkers,
          startLabel: "01:25",
          endLabel: "02:12",
          tagExtraClass: "target-subseg-tag"
        },
        deps: {}
      });
      if (mode === "start-only") {
        const marker = document.createElement("span");
        marker.className = "checkpoint-marker is-cycle-target-start";
        marker.style.left = "34.4%";
        const tag = document.createElement("span");
        tag.className = "checkpoint-tag cycle-target-tag cycle-target-tag-start checkpoint-tag-target-start";
        tag.textContent = "subSeg start";
        marker.appendChild(tag);
        targetCheckpointMarkers.appendChild(marker);
      } else {
        const span = document.createElement("span");
        span.className = "target-subseg-span selected";
        span.style.left = "34.4%";
        span.style.width = "18.7%";
        const tag = document.createElement("span");
        tag.className = "checkpoint-tag target-subseg-tag";
        if (deleteTarget) {
          tag.classList.add("is-delete-target");
        }
        tag.textContent = "01:41-49";
        span.appendChild(tag);
        targetCheckpointMarkers.appendChild(span);
      }
    }
  }

  function hideGuideDeleteDialog() {
    if (!deleteConfirmDialog) {
      return;
    }
    deleteConfirmDialog.classList.add("hidden");
  }

  function showGuideDeleteDialog(summary) {
    if (!deleteConfirmDialog || !deleteConfirmText) {
      return;
    }
    deleteConfirmText.textContent = "Delete " + String(summary || "target") + "? This cannot be undone.";
    deleteConfirmDialog.classList.remove("hidden");
  }

  function renderGuideMainSubSegOverlay(ctx) {
    const { deps } = ctx;
    void deps;
    if (!subSegOverlays) {
      return;
    }
    subSegOverlays.innerHTML = "";
    const span = document.createElement("span");
    span.className = "subseg-main-span";
    span.style.left = "44%";
    span.style.width = "7%";
    subSegOverlays.appendChild(span);
  }

  function renderGuidePlayerState(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    const phase = String(data.phase || "");
    const guideCopy = getGuideCopy({ deps: {} });
    stopGuideNavInputBlink();
    fileName.textContent = "Guide Demo - Episode 01.mp3";
    hideGuideDeleteDialog();
    progress.disabled = true;
    progress.value = 320;
    progress.style.setProperty("--progress-pct", "32%");
    playhead.style.left = "32%";
    playheadTime.textContent = "01:12";
    if (subSegOverlays) {
      subSegOverlays.innerHTML = "";
    }
    selectedSpanOverlay.style.display = "none";
    selectedSpanOverlay.style.left = "0%";
    selectedSpanOverlay.style.width = "0%";

    if (phase === "player-main" || phase === "player-overview") {
      checkpointMarkers.innerHTML = "";
      renderGuideBoundaryTagMarkers({
        data: {
          container: checkpointMarkers,
          startLabel: "00:00",
          endLabel: "03:45"
        },
        deps: {}
      });
      targetProgressWrap.classList.add("hidden");
      subSegValuePanel.classList.add("hidden");
      subSegValueList.innerHTML = "";
      return;
    }

    if (
      phase === "player-checkpoint-set" ||
      phase === "player-checkpoint-add" ||
      phase === "player-checkpoint-delete-target" ||
      phase === "player-checkpoint-delete-confirm" ||
      phase === "player-checkpoint-cycle"
    ) {
      if (phase === "player-checkpoint-set") {
        progress.value = 378;
        progress.style.setProperty("--progress-pct", "37.8%");
        playhead.style.left = "37.8%";
        playheadTime.textContent = "01:25";
      } else {
        progress.value = 378;
        progress.style.setProperty("--progress-pct", "37.8%");
        playhead.style.left = "37.8%";
        playheadTime.textContent = "01:25";
      }
      renderGuideCheckpointMarkers({
        data: {
          markers: phase === "player-checkpoint-set"
            ? [
              { pct: 13.8, label: "00:31" },
              { pct: 58.7, label: "02:12" },
              { pct: 84, label: "03:09" }
            ]
            : [
              { pct: 13.8, label: "00:31" },
              { pct: 37.8, label: "01:25", boundary: "start" },
              { pct: 58.7, label: "02:12", boundary: "end", deleteTarget: phase === "player-checkpoint-delete-target" || phase === "player-checkpoint-delete-confirm" },
              { pct: 84, label: "03:09" }
            ]
        },
        deps: {}
      });
      renderGuideBoundaryTagMarkers({
        data: {
          container: checkpointMarkers,
          startLabel: "00:00",
          endLabel: "03:45"
        },
        deps: {}
      });
      if (phase === "player-checkpoint-cycle") {
        selectedSpanOverlay.style.display = "block";
        selectedSpanOverlay.style.left = "37.8%";
        selectedSpanOverlay.style.width = "20.9%";
      }
      if (phase === "player-checkpoint-delete-confirm") {
        showGuideDeleteDialog(guideCopy.guideCheckpointDeleteSummary || "checkpoint at 02:12");
      }
      targetProgressWrap.classList.add("hidden");
      subSegValuePanel.classList.add("hidden");
      subSegValueList.innerHTML = "";
      return;
    }

    targetProgressWrap.classList.remove("hidden");
    targetProgress.disabled = true;
    progress.value = 413;
    progress.style.setProperty("--progress-pct", "41.3%");
    playhead.style.left = "41.3%";
    playheadTime.textContent = "01:33";
    targetProgress.value = 170;
    targetProgress.style.setProperty("--progress-pct", "17%");
    targetPlayhead.style.left = "17%";
    targetPlayheadTime.textContent = "01:33";
    if (phase === "player-subseg-start") {
      progress.value = 449;
      progress.style.setProperty("--progress-pct", "44.9%");
      playhead.style.left = "44.9%";
      playheadTime.textContent = "01:41";
      targetProgress.value = 344;
      targetProgress.style.setProperty("--progress-pct", "34.4%");
      targetPlayhead.style.left = "34.4%";
      targetPlayheadTime.textContent = "01:41";
    } else if (phase === "player-subseg-end") {
      progress.value = 486;
      progress.style.setProperty("--progress-pct", "48.6%");
      playhead.style.left = "48.6%";
      playheadTime.textContent = "01:49";
      targetProgress.value = 531;
      targetProgress.style.setProperty("--progress-pct", "53.1%");
      targetPlayhead.style.left = "53.1%";
      targetPlayheadTime.textContent = "01:49";
    }
    if (targetSubSegActiveFill) {
      targetSubSegActiveFill.style.display = "none";
      targetSubSegActiveFill.style.left = "0%";
      targetSubSegActiveFill.style.width = "0%";
    }
    if (targetCheckpointMarkers) {
      targetCheckpointMarkers.innerHTML = "";
      renderGuideBoundaryTagMarkers({
        data: {
          container: targetCheckpointMarkers,
          startLabel: "01:25",
          endLabel: "02:12",
          tagExtraClass: "target-subseg-tag"
        },
        deps: {}
      });
    }

    if (phase === "player-focus") {
      subSegValuePanel.classList.add("hidden");
      subSegValueList.innerHTML = "";
      return;
    }

    if (
      phase === "player-subseg-start" ||
      phase === "player-subseg-end" ||
      phase === "player-subseg-select" ||
      phase === "player-subseg-delete-target" ||
      phase === "player-subseg-delete-confirm" ||
      phase === "player-input" ||
      phase === "player-card-first-input" ||
      phase === "player-cards" ||
      phase === "player-card-edit" ||
      phase === "player-card-nav-history" ||
      phase === "player-card-child-select" ||
      phase === "player-card-child-created" ||
      phase === "player-card-nav-list" ||
      phase === "player-card-delete" ||
      phase === "player-card-delete-confirm" ||
      phase === "player-exit-value-mode" ||
      phase === "player-exit-subseg" ||
      phase === "player-exit-target" ||
      phase === "player-exit-audseg" ||
      phase === "player-exit-list"
    ) {
      const targetMode = phase === "player-subseg-start" ? "start-only" : "complete";
      renderGuideTargetSubSeg({
        data: {
          mode: targetMode,
          deleteTarget: phase === "player-subseg-delete-target" || phase === "player-subseg-delete-confirm"
        },
        deps: {}
      });
      if (targetMode === "complete") {
        renderGuideMainSubSegOverlay({ deps: {} });
      }
    }

    if (phase === "player-exit-audseg" || phase === "player-exit-list") {
      if (targetSubSegActiveFill) {
        targetSubSegActiveFill.style.display = "none";
      }
      if (targetCheckpointMarkers) {
        targetCheckpointMarkers.innerHTML = "";
      }
    }

    if (phase === "player-exit-audseg" || phase === "player-exit-list") {
      targetProgressWrap.classList.add("hidden");
      selectedSpanOverlay.style.display = "block";
      selectedSpanOverlay.style.left = "37.8%";
      selectedSpanOverlay.style.width = "20.9%";
    }

    if (phase === "player-exit-list") {
      selectedSpanOverlay.style.display = "none";
    }

    if (phase === "player-subseg-delete-confirm") {
      showGuideDeleteDialog(guideCopy.guideSubSegDeleteSummary || "subSeg 01:41-49");
    }

    if (
      phase === "player-subseg-card" ||
      phase === "player-subseg-start" ||
      phase === "player-subseg-end" ||
      phase === "player-subseg-select" ||
      phase === "player-subseg-delete-target" ||
      phase === "player-subseg-delete-confirm"
    ) {
      subSegValuePanel.classList.add("hidden");
      subSegValueList.innerHTML = "";
      return;
    }

    subSegValuePanel.classList.remove("hidden");
    subSegValueInput.value = "";

    if (phase === "player-input") {
      subSegValueList.innerHTML = "";
      return;
    }
    if (phase === "player-card-first-input") {
      subSegValueInput.value = "å‰åŽä¸¤æ¸…";
      subSegValueList.innerHTML = "";
      return;
    }

    if (
      phase === "player-card-edit" ||
      phase === "player-cards" ||
      phase === "player-card-nav-history" ||
      phase === "player-card-child-select" ||
      phase === "player-card-child-created" ||
      phase === "player-card-nav-list" ||
      phase === "player-card-delete" ||
      phase === "player-card-delete-confirm" ||
      phase === "player-exit-value-mode" ||
      phase === "player-exit-subseg"
    ) {
      subSegValueList.innerHTML = "";
      if (phase === "player-card-child-select" || phase === "player-card-child-created") {
        const showCreated = phase === "player-card-child-created";
        const cluster = document.createElement("div");
        if (showCreated) {
          cluster.id = "guide-card-child-cluster";
        }
        const rootCard = document.createElement("div");
        rootCard.className = "subseg-value-card";
        const rootVersion = document.createElement("div");
        rootVersion.className = "subseg-value-version";
        rootVersion.textContent = "current -0 | current version";
        const rootInput = document.createElement("input");
        rootInput.type = "text";
        rootInput.className = "subseg-value-card-input";
        rootInput.value = "é’±è´§ä¸¤æ¸…";
        rootInput.readOnly = true;
        rootInput.style.outline = "2px solid #6e92c9";
        rootInput.style.borderRadius = "4px";
        if (!showCreated) {
          rootInput.id = "guide-card-child-select-target";
        }
        rootCard.appendChild(rootVersion);
        rootCard.appendChild(rootInput);
        cluster.appendChild(rootCard);

        if (showCreated) {
          const childCard = document.createElement("div");
          childCard.className = "subseg-value-card is-nested is-last-sibling";
          childCard.style.setProperty("--subseg-card-depth", "1");
          childCard.style.setProperty("--subseg-card-line-left", "-4px");
          childCard.style.setProperty("--subseg-card-bridge-left", "-4px");
          childCard.style.setProperty("--subseg-card-bridge-width", "4px");
          const childVersion = document.createElement("div");
          childVersion.className = "subseg-value-version";
          childVersion.textContent = "current -0 | child card";
          const childInput = document.createElement("input");
          childInput.type = "text";
          childInput.className = "subseg-value-card-input";
          childInput.value = "é’±è´§";
          childInput.readOnly = true;
          childCard.appendChild(childVersion);
          childCard.appendChild(childInput);
          cluster.appendChild(childCard);
        }

        subSegValueList.appendChild(cluster);
        if (!showCreated) {
          requestAnimationFrame(function () {
            try {
              rootInput.focus({ preventScroll: true });
            } catch {
              rootInput.focus();
            }
            try {
              rootInput.setSelectionRange(0, 2);
            } catch {
              // Ignore selection failures.
            }
          });
        }
        return;
      }
      if (phase === "player-card-nav-list") {
        const cluster = document.createElement("div");
        cluster.id = "guide-card-nav-list-cluster";

        const rootCard = document.createElement("div");
        rootCard.className = "subseg-value-card";
        const rootVersion = document.createElement("div");
        rootVersion.className = "subseg-value-version";
        rootVersion.textContent = "current -0 | current version";
        const rootInput = document.createElement("input");
        rootInput.type = "text";
        rootInput.className = "subseg-value-card-input";
        rootInput.id = "guide-nav-parent-input";
        rootInput.value = "é’±è´§ä¸¤æ¸…";
        rootInput.readOnly = false;
        rootInput.classList.add("guide-nav-caret-demo");
        rootInput.addEventListener("beforeinput", function (event) {
          event.preventDefault();
        });
        rootInput.addEventListener("keydown", function (event) {
          event.preventDefault();
        });
        rootCard.appendChild(rootVersion);
        rootCard.appendChild(rootInput);
        cluster.appendChild(rootCard);

        const childCard = document.createElement("div");
        childCard.className = "subseg-value-card is-nested is-last-sibling";
        childCard.style.setProperty("--subseg-card-depth", "1");
        childCard.style.setProperty("--subseg-card-line-left", "-4px");
        childCard.style.setProperty("--subseg-card-bridge-left", "-4px");
        childCard.style.setProperty("--subseg-card-bridge-width", "4px");
        const childVersion = document.createElement("div");
        childVersion.className = "subseg-value-version";
        childVersion.textContent = "current -0 | child card";
        const childInput = document.createElement("input");
        childInput.type = "text";
        childInput.className = "subseg-value-card-input";
        childInput.id = "guide-nav-child-input";
        childInput.value = "é’±è´§";
        childInput.readOnly = false;
        childInput.classList.add("guide-nav-caret-demo");
        childInput.addEventListener("beforeinput", function (event) {
          event.preventDefault();
        });
        childInput.addEventListener("keydown", function (event) {
          event.preventDefault();
        });
        childCard.appendChild(childVersion);
        childCard.appendChild(childInput);
        cluster.appendChild(childCard);

        subSegValueList.appendChild(cluster);
        startGuideNavInputBlink([rootInput, childInput]);
        return;
      }
      const card = document.createElement("div");
      card.className = "subseg-value-card";
      const recalled = phase === "player-card-nav-history";
      const editing = phase === "player-card-edit";

      const version = document.createElement("div");
      version.className = "subseg-value-version";
      version.textContent = recalled ? "current -1 | previous version" : "current -0 | current version";

      const inputEl = document.createElement("input");
      inputEl.type = "text";
      inputEl.className = "subseg-value-card-input";
      inputEl.value = (recalled || phase === "player-cards") ? "\u524d\u540e\u4e24\u6e05" : "\u94b1\u8d27\u4e24\u6e05";
      inputEl.readOnly = true;
      if (recalled) {
        inputEl.classList.add("is-recalling");
      }
      if (phase === "player-card-delete" || phase === "player-card-delete-confirm") {
        inputEl.style.outline = "2px solid #6e92c9";
        inputEl.style.borderRadius = "4px";
        inputEl.id = "guide-card-delete-target";
      }
      if (editing) {
        inputEl.style.outline = "2px solid #6e92c9";
        inputEl.style.borderRadius = "4px";
      }

      card.appendChild(version);
      card.appendChild(inputEl);

      if (!recalled) {
        const historyHint = document.createElement("div");
        historyHint.className = "subseg-value-version";
        historyHint.textContent = phase === "player-cards"
          ? "history: (none yet)"
          : (editing
            ? "history: \u524d\u540e\u4e24\u6e05 | current: \u94b1\u8d27\u4e24\u6e05"
            : "history: \u524d\u540e\u4e24\u6e05");
        card.appendChild(historyHint);
      }

      if (phase === "player-card-delete" || phase === "player-card-delete-confirm") {
        const actions = document.createElement("div");
        actions.className = "subseg-value-delete-row";
        actions.id = "guide-card-delete-actions";
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "subseg-value-delete-cancel";
        cancelButton.id = "guide-delete-cancel";
        cancelButton.textContent = "Cancel";
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "subseg-value-delete-confirm";
        deleteButton.id = "guide-delete-confirm";
        deleteButton.textContent = "Delete";
        actions.appendChild(cancelButton);
        actions.appendChild(deleteButton);
        card.appendChild(actions);
      }

      subSegValueList.appendChild(card);
    }
  }

  function stopGuideNavInputBlink() {
    if (state.guideNavBlinkTimerId) {
      window.clearInterval(state.guideNavBlinkTimerId);
      state.guideNavBlinkTimerId = null;
    }
    state.guideNavBlinkIndex = 0;
  }

  function startGuideNavInputBlink(inputs) {
    const list = Array.isArray(inputs)
      ? inputs.filter(function (el) { return Boolean(el); })
      : [];
    if (list.length < 2) {
      return;
    }
    stopGuideNavInputBlink();
    function focusIndex(index) {
      const target = list[index % list.length];
      if (!target) {
        return;
      }
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
      const len = String(target.value || "").length;
      try {
        target.setSelectionRange(len, len);
      } catch {
        // Ignore selection failures.
      }
    }
    focusIndex(0);
    state.guideNavBlinkIndex = 0;
    state.guideNavBlinkTimerId = window.setInterval(function () {
      state.guideNavBlinkIndex = (state.guideNavBlinkIndex + 1) % list.length;
      focusIndex(state.guideNavBlinkIndex);
    }, 650);
  }

  function startGuideMode(ctx) {
    const { deps } = ctx;
    void deps;
    if (loginView && !loginView.classList.contains("hidden")) {
      setLoginStatus("Log in first, then start Guide.", true);
      return;
    }
    if (!guideOverlay || !guideSpotlight || !guideTooltip || !guideStepTitle || !guideStepText || !guideStepCounter) {
      return;
    }
    if (!audio.paused) {
      audio.pause();
    }
    showLibraryView();
    state.guideSteps = buildGuideSteps({ deps: {} });
    if (!Array.isArray(state.guideSteps) || state.guideSteps.length === 0) {
      return;
    }
    state.isGuideMode = true;
    state.guideStepIndex = 0;
    state.guidePhase = "list-language";
    state.guideTooltipLocked = false;
    markGuideFeatureSeenForCurrentUser();
    renderGuideFeatureBadge();
    guideOverlay.classList.remove("hidden");
    renderGuideLanguagePicker({ deps: {} });
    renderGuideStep({ deps: {} });
  }

  function stopGuideMode(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    if (!state.isGuideMode && (!guideOverlay || guideOverlay.classList.contains("hidden"))) {
      return;
    }
    state.isGuideMode = false;
    state.guideStepIndex = -1;
    state.guideSteps = [];
    state.guideTooltipLocked = false;
    stopGuideNavInputBlink();
    if (state.guideRafId) {
      cancelAnimationFrame(state.guideRafId);
      state.guideRafId = null;
    }
    if (guideOverlay) {
      guideOverlay.classList.add("hidden");
    }
    if (guideLanguagePicker) {
      guideLanguagePicker.classList.add("hidden");
    }
    targetProgressWrap.classList.add("hidden");
    subSegValuePanel.classList.add("hidden");
    subSegValueList.innerHTML = "";
    showLibraryView();
    renderAudioCards(state.sessionsCache);
    if (!data.silent) {
      setSaveStatus(getGuideCopy({ deps: {} }).closed);
    }
  }

  function moveGuideStep(ctx) {
    const { data = {}, deps } = ctx;
    void deps;
    if (!state.isGuideMode || !Array.isArray(state.guideSteps) || state.guideSteps.length === 0) {
      return;
    }
    const delta = Number.isFinite(data.delta) ? data.delta : 0;
    if (!delta) {
      return;
    }
    const nextIndex = state.guideStepIndex + delta;
    if (nextIndex < 0) {
      state.guideStepIndex = 0;
      renderGuideStep({ deps: {} });
      return;
    }
    if (nextIndex >= state.guideSteps.length) {
      stopGuideMode({ data: { reason: "complete", silent: true }, deps: {} });
      setSaveStatus(getGuideCopy({ deps: {} }).complete);
      return;
    }
    state.guideStepIndex = nextIndex;
    renderGuideStep({ deps: {} });
  }

  function scheduleGuideStepRender(ctx) {
    const { deps } = ctx;
    void deps;
    if (!state.isGuideMode) {
      return;
    }
    if (state.guideRafId) {
      cancelAnimationFrame(state.guideRafId);
      state.guideRafId = null;
    }
    state.guideRafId = requestAnimationFrame(function () {
      state.guideRafId = null;
      renderGuideStep({ deps: {} });
    });
  }

  function renderGuideStep(ctx) {
    const { deps } = ctx;
    void deps;
    if (!state.isGuideMode || !Array.isArray(state.guideSteps) || state.guideSteps.length === 0) {
      return;
    }
    const safeIndex = Math.max(0, Math.min(state.guideSteps.length - 1, state.guideStepIndex));
    state.guideStepIndex = safeIndex;
    const step = state.guideSteps[safeIndex];
    if (!step) {
      return;
    }
    applyGuidePhase({ data: { phase: step.phase }, deps: {} });

    if (guideLanguagePicker) {
      guideLanguagePicker.classList.toggle("hidden", step.id !== "language");
    }
    renderGuideLanguagePicker({ deps: {} });

    const resolved = resolveGuideStepTarget({ data: { step }, deps: {} });
    if (!resolved) {
      return;
    }

    const targetRect = resolved.getBoundingClientRect();
    const isOffscreen = targetRect.bottom < 0 || targetRect.top > window.innerHeight;
    if (isOffscreen && resolved.scrollIntoView) {
      resolved.scrollIntoView({ block: "center", inline: "nearest" });
      scheduleGuideStepRender({ deps: {} });
      return;
    }

    const copy = getGuideCopy({ deps: {} });
    const titleText = copy[step.titleKey] || "Guide";
    const bodyText = copy[step.textKey] || "";
    guideStepTitle.textContent = titleText;
    guideStepText.textContent = bodyText;
    guideStepCounter.textContent = String(safeIndex + 1) + " / " + String(state.guideSteps.length);
    if (guidePrevButton) {
      guidePrevButton.disabled = safeIndex <= 0;
    }
    if (guideNextButton) {
      guideNextButton.textContent = safeIndex >= state.guideSteps.length - 1 ? copy.finish : copy.next;
    }
    const noSpotlight = Boolean(step.noSpotlight);
    if (guideSpotlight) {
      guideSpotlight.classList.toggle("hidden", noSpotlight);
    }
    if (!noSpotlight) {
      if (step.fullViewport) {
        positionGuideSpotlight({
          data: {
            rect: {
              top: 0,
              left: 0,
              width: window.innerWidth,
              height: window.innerHeight
            },
            minWidth: window.innerWidth,
            minHeight: window.innerHeight
          },
          deps: {}
        });
      } else {
        positionGuideSpotlight({
          data: {
            rect: targetRect,
            element: resolved,
            padding: step.spotlightPadding || null,
            minWidth: step.spotlightMinWidth || null,
            minHeight: step.spotlightMinHeight || null
          },
          deps: {}
        });
      }
    }
    if (step.id === "language") {
      if (!state.guideTooltipLocked) {
        positionGuideTooltipCentered({ deps: {} });
        state.guideTooltipLocked = true;
      }
    } else {
      state.guideTooltipLocked = false;
      positionGuideTooltip({ data: { rect: targetRect }, deps: {} });
    }
  }

  function resolveGuideStepTarget(ctx) {
    const { data, deps } = ctx;
    void deps;
    const { step } = data;
    if (!step) {
      return null;
    }
    const target = step.getTarget ? step.getTarget({ deps: {} }) : null;
    if (target && isGuideElementVisible({ data: { element: target }, deps: {} })) {
      return target;
    }
    return cards || progressTrackMain || libraryView || playerView;
  }

  function isGuideElementVisible(ctx) {
    const { data, deps } = ctx;
    void deps;
    const { element } = data;
    if (!element || !element.getBoundingClientRect || !element.isConnected) {
      return false;
    }
    if (element.classList && element.classList.contains("hidden")) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function positionGuideSpotlight(ctx) {
    const { data, deps } = ctx;
    void deps;
    const { rect, element, padding, minWidth, minHeight } = data;
    if (!guideSpotlight || !rect) {
      return;
    }
    const hasTags = Boolean(
      element &&
      element.querySelector &&
      element.querySelector(".checkpoint-tag, .target-subseg-tag")
    );
    const padTop = padding && Number.isFinite(Number(padding.top)) ? Number(padding.top) : (hasTags ? 34 : 10);
    const padRight = padding && Number.isFinite(Number(padding.right)) ? Number(padding.right) : 12;
    const padBottom = padding && Number.isFinite(Number(padding.bottom)) ? Number(padding.bottom) : 12;
    const padLeft = padding && Number.isFinite(Number(padding.left)) ? Number(padding.left) : 12;
    const top = Math.max(0, rect.top - padTop);
    const left = Math.max(0, rect.left - padLeft);
    const width = Math.max(24, Number.isFinite(Number(minWidth)) ? Number(minWidth) : 24, rect.width + padLeft + padRight);
    const height = Math.max(24, Number.isFinite(Number(minHeight)) ? Number(minHeight) : 24, rect.height + padTop + padBottom);
    guideSpotlight.style.top = String(top) + "px";
    guideSpotlight.style.left = String(left) + "px";
    guideSpotlight.style.width = String(width) + "px";
    guideSpotlight.style.height = String(height) + "px";
  }

  function positionGuideTooltip(ctx) {
    const { data, deps } = ctx;
    void deps;
    const { rect } = data;
    if (!guideTooltip || !rect) {
      return;
    }
    const viewportPad = 12;
    const width = Math.max(220, Math.min(320, window.innerWidth - viewportPad * 2));
    guideTooltip.style.width = String(width) + "px";
    const tipRect = guideTooltip.getBoundingClientRect();
    const idealTop = rect.bottom + 12;
    const top = idealTop + tipRect.height <= window.innerHeight - viewportPad
      ? idealTop
      : Math.max(viewportPad, rect.top - tipRect.height - 12);
    const left = Math.max(viewportPad, Math.min(window.innerWidth - tipRect.width - viewportPad, rect.left));
    guideTooltip.style.top = String(top) + "px";
    guideTooltip.style.left = String(left) + "px";
  }

  function positionGuideTooltipCentered(ctx) {
    const { deps } = ctx;
    void deps;
    if (!guideTooltip) {
      return;
    }
    const viewportPad = 12;
    const width = Math.max(220, Math.min(320, window.innerWidth - viewportPad * 2));
    guideTooltip.style.width = String(width) + "px";
    const tipRect = guideTooltip.getBoundingClientRect();
    const top = Math.max(viewportPad, Math.round((window.innerHeight - tipRect.height) / 2));
    const left = Math.max(viewportPad, Math.round((window.innerWidth - tipRect.width) / 2));
    guideTooltip.style.top = String(top) + "px";
    guideTooltip.style.left = String(left) + "px";
  }

  function buildGuideSteps(ctx) {
    const { deps } = ctx;
    void deps;
    return [
      {
        id: "language",
        phase: "list-language",
        titleKey: "languageTitle",
        textKey: "languageText",
        noSpotlight: true,
        getTarget: function () { return guideLanguagePicker || guideTooltip; }
      },
      {
        id: "list-overview",
        phase: "list-overview",
        titleKey: "uploadButtonTitle",
        textKey: "uploadButtonText",
        getTarget: function () { return uploadButton || libraryView.querySelector(".library-head-row"); }
      },
      {
        id: "list-card-ready",
        phase: "list-card-ready",
        titleKey: "demoCardReadyTitle",
        textKey: "demoCardReadyText",
        getTarget: function () { return document.getElementById("guide-demo-card") || cards; }
      },
      {
        id: "list-card-upload",
        phase: "list-card-upload",
        titleKey: "demoCardUploadTitle",
        textKey: "demoCardUploadText",
        getTarget: function () { return cards.querySelector(".audio-card"); }
      },
      {
        id: "list-card-loading",
        phase: "list-card-loading",
        titleKey: "demoCardLoadingTitle",
        textKey: "demoCardLoadingText",
        getTarget: function () { return document.getElementById("guide-demo-card") || cards; }
      },
      {
        id: "player-overview",
        phase: "player-overview",
        titleKey: "playerOverviewTitle",
        textKey: "playerOverviewText",
        fullViewport: true,
        getTarget: function () { return playerView || progressTrackMain; }
      },
      {
        id: "player-main",
        phase: "player-main",
        titleKey: "playerMainTitle",
        textKey: "playerMainText",
        getTarget: function () { return progressTrackMain; }
      },
      {
        id: "player-checkpoint-set",
        phase: "player-checkpoint-set",
        titleKey: "checkpointSetTitle",
        textKey: "checkpointSetText",
        getTarget: function () { return progressTrackMain; }
      },
      {
        id: "player-checkpoint-add",
        phase: "player-checkpoint-add",
        titleKey: "checkpointAddTitle",
        textKey: "checkpointAddText",
        getTarget: function () { return checkpointMarkers || progressTrackMain; }
      },
      {
        id: "player-checkpoint-delete-target",
        phase: "player-checkpoint-delete-target",
        titleKey: "checkpointDeleteTargetTitle",
        textKey: "checkpointDeleteTargetText",
        getTarget: function () { return checkpointMarkers || progressTrackMain; }
      },
      {
        id: "player-checkpoint-delete-confirm",
        phase: "player-checkpoint-delete-confirm",
        titleKey: "checkpointDeleteConfirmTitle",
        textKey: "checkpointDeleteConfirmText",
        getTarget: function () { return deleteConfirmDialog || checkpointMarkers || progressTrackMain; }
      },
      {
        id: "player-checkpoint-cycle",
        phase: "player-checkpoint-cycle",
        titleKey: "checkpointCycleTitle",
        textKey: "checkpointCycleText",
        getTarget: function () { return selectedSpanOverlay || progressTrackMain; }
      },
      {
        id: "player-focus",
        phase: "player-focus",
        titleKey: "playerFocusTitle",
        textKey: "playerFocusText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-subseg-card",
        phase: "player-subseg-card",
        titleKey: "subSegCardTitle",
        textKey: "subSegCardText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-subseg-start",
        phase: "player-subseg-start",
        titleKey: "subSegStartTitle",
        textKey: "subSegStartText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-subseg-end",
        phase: "player-subseg-end",
        titleKey: "subSegEndTitle",
        textKey: "subSegEndText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-subseg-select",
        phase: "player-subseg-select",
        titleKey: "subSegSelectTitle",
        textKey: "subSegSelectText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-subseg-delete-target",
        phase: "player-subseg-delete-target",
        titleKey: "subSegDeleteTargetTitle",
        textKey: "subSegDeleteTargetText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-subseg-delete-confirm",
        phase: "player-subseg-delete-confirm",
        titleKey: "subSegDeleteConfirmTitle",
        textKey: "subSegDeleteConfirmText",
        getTarget: function () { return deleteConfirmDialog || targetProgressWrap; }
      },
      {
        id: "player-input",
        phase: "player-input",
        titleKey: "inputTitle",
        textKey: "inputText",
        getTarget: function () { return subSegValueInput || subSegValuePanel; }
      },
      {
        id: "player-card-first-input",
        phase: "player-card-first-input",
        titleKey: "firstCardInputTitle",
        textKey: "firstCardInputText",
        getTarget: function () { return subSegValueInput || subSegValuePanel; }
      },
      {
        id: "player-cards",
        phase: "player-cards",
        titleKey: "cardsTitle",
        textKey: "cardsText",
        spotlightPadding: { top: 20, right: 20, bottom: 20, left: 20 },
        spotlightMinWidth: 380,
        getTarget: function () { return subSegValueList.querySelector(".subseg-value-card-input") || subSegValuePanel; }
      },
      {
        id: "player-card-edit",
        phase: "player-card-edit",
        titleKey: "cardEditTitle",
        textKey: "cardEditText",
        spotlightPadding: { top: 20, right: 20, bottom: 20, left: 20 },
        spotlightMinWidth: 380,
        getTarget: function () { return subSegValueList.querySelector(".subseg-value-card-input") || subSegValuePanel; }
      },
      {
        id: "player-card-nav-history",
        phase: "player-card-nav-history",
        titleKey: "cardNavHistoryTitle",
        textKey: "cardNavHistoryText",
        spotlightPadding: { top: 18, right: 18, bottom: 18, left: 18 },
        spotlightMinWidth: 360,
        getTarget: function () { return subSegValueList || subSegValuePanel; }
      },
      {
        id: "player-card-child-select",
        phase: "player-card-child-select",
        titleKey: "cardChildSelectTitle",
        textKey: "cardChildSelectText",
        spotlightPadding: { top: 20, right: 20, bottom: 20, left: 20 },
        spotlightMinWidth: 380,
        getTarget: function () { return document.getElementById("guide-card-child-select-target") || subSegValueList || subSegValuePanel; }
      },
      {
        id: "player-card-child-created",
        phase: "player-card-child-created",
        titleKey: "cardChildCreatedTitle",
        textKey: "cardChildCreatedText",
        spotlightPadding: { top: 20, right: 20, bottom: 20, left: 20 },
        spotlightMinWidth: 380,
        getTarget: function () { return document.getElementById("guide-card-child-cluster") || subSegValueList || subSegValuePanel; }
      },
      {
        id: "player-card-nav-list",
        phase: "player-card-nav-list",
        titleKey: "cardNavVerticalTitle",
        textKey: "cardNavVerticalText",
        spotlightPadding: { top: 18, right: 18, bottom: 18, left: 18 },
        spotlightMinWidth: 360,
        getTarget: function () { return document.getElementById("guide-card-nav-list-cluster") || subSegValueList || subSegValuePanel; }
      },
      {
        id: "player-card-delete",
        phase: "player-card-delete",
        titleKey: "cardDeleteTitle",
        textKey: "cardDeleteText",
        spotlightPadding: { top: 20, right: 20, bottom: 20, left: 20 },
        spotlightMinWidth: 380,
        getTarget: function () { return document.getElementById("guide-card-delete-target") || subSegValueList; }
      },
      {
        id: "player-card-delete-confirm",
        phase: "player-card-delete-confirm",
        titleKey: "cardDeleteConfirmTitle",
        textKey: "cardDeleteConfirmText",
        getTarget: function () { return document.getElementById("guide-card-delete-actions") || subSegValueList; }
      },
      {
        id: "player-exit-value-mode",
        phase: "player-exit-value-mode",
        titleKey: "exitValueModeTitle",
        textKey: "exitValueModeText",
        getTarget: function () { return subSegValueInput || subSegValuePanel; }
      },
      {
        id: "player-exit-subseg",
        phase: "player-exit-subseg",
        titleKey: "exitSubSegTitle",
        textKey: "exitSubSegText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-exit-target",
        phase: "player-exit-target",
        titleKey: "exitTargetTitle",
        textKey: "exitTargetText",
        getTarget: function () { return targetProgressWrap; }
      },
      {
        id: "player-exit-audseg",
        phase: "player-exit-audseg",
        titleKey: "exitAudSegTitle",
        textKey: "exitAudSegText",
        getTarget: function () { return progressTrackMain; }
      },
      {
        id: "player-exit-list",
        phase: "player-exit-list",
        titleKey: "exitListTitle",
        textKey: "exitListText",
        getTarget: function () { return backButton || playerView; }
      }
    ];
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
    if (state.isGuideMode && isGuideListPhase({ deps: {} })) {
      renderGuideAudioCards({ deps: {} });
      return;
    }
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
    const playback = session && session.playback ? session.playback : {};
    const checkpointCount = Array.isArray(playback.checkpoints) ? playback.checkpoints.length : 0;
    const subSegCount = Array.isArray(playback.subSegs) ? playback.subSegs.length : 0;
    const subSegValueEntries = playback.subSegValueEntries && typeof playback.subSegValueEntries === "object"
      ? playback.subSegValueEntries
      : {};
    const fallbackInputCardCount = Object.keys(subSegValueEntries).reduce(function (sum, key) {
      const list = Array.isArray(subSegValueEntries[key]) ? subSegValueEntries[key] : [];
      return sum + list.length;
    }, 0);
    const subSegEntryKeyCount = Object.keys(subSegValueEntries).length;
    const stats = playback.stats && typeof playback.stats === "object" ? playback.stats : {};
    const audSegCount = Number.isFinite(Number(stats.audSegs)) ? Number(stats.audSegs) : Math.max(0, checkpointCount + 1);
    const statsSubSegCount = Number.isFinite(Number(stats.subSegs)) ? Number(stats.subSegs) : 0;
    const resolvedSubSegCount = Math.max(statsSubSegCount, subSegCount, subSegEntryKeyCount);
    const inputCardCount = Number.isFinite(Number(stats.inputCards)) ? Number(stats.inputCards) : fallbackInputCardCount;
    const countsText = "audSegs: " + String(audSegCount) +
      "  |  subSegs: " + String(resolvedSubSegCount) +
      "  |  cards: " + String(inputCardCount);
    const when = formatSavedAt(session.savedAt);
    if (mode === "loading") {
      return "Opening...  |  " + countsText;
    }
    return when + "  |  " + countsText;
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

  function getTimestampOrFallback(value, fallback) {
    const stamp = new Date(value).getTime();
    if (Number.isFinite(stamp)) {
      return stamp;
    }
    return fallback;
  }

  function getEarliestEntryCreatedAt(entries) {
    const queue = Array.isArray(entries) ? entries.slice() : [];
    let bestIso = "";
    let bestStamp = Number.POSITIVE_INFINITY;
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const createdAt = String(entry.createdAt || "");
      const stamp = new Date(createdAt).getTime();
      if (Number.isFinite(stamp) && stamp < bestStamp) {
        bestStamp = stamp;
        bestIso = createdAt;
      }
      if (Array.isArray(entry.children) && entry.children.length > 0) {
        queue.push.apply(queue, entry.children);
      }
    }
    return bestIso;
  }

  function formatTimelineElapsed(ms) {
    const safeMs = Math.max(0, Number.isFinite(ms) ? ms : 0);
    const totalSeconds = Math.round(safeMs / 1000);
    if (totalSeconds < 60) {
      return String(totalSeconds) + "s";
    }
    const totalMinutes = Math.round(totalSeconds / 60);
    if (totalMinutes < 60) {
      return String(totalMinutes) + "m";
    }
    const totalHours = totalMinutes / 60;
    if (totalHours < 24) {
      const rounded = totalHours >= 10 ? Math.round(totalHours) : Math.round(totalHours * 10) / 10;
      return String(rounded) + "h";
    }
    const totalDays = totalHours / 24;
    const roundedDays = totalDays >= 10 ? Math.round(totalDays) : Math.round(totalDays * 10) / 10;
    return String(roundedDays) + "d";
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

      state.activeSessionId = saved.id || sessionId;
      state.activeRevision = normalizeRevision(saved.revision);
      state.activeAudioId = typeof saved.audioId === "string" ? saved.audioId : null;
      state.activeAudioUrl = typeof saved.audioUrl === "string" ? saved.audioUrl : null;
      await applySavedSession(saved);
      debugLog("openPersistedSession:loaded", {
        sessionId: state.activeSessionId,
        revision: state.activeRevision,
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
    state.subSegTimelines = {};
    state.subSegTimelineEventIdCounter = 0;
    state.subSegCardRecallPositions = {};
    state.subSegCardInternalChangeGuards = {};
    state.subSegCardBubbleValues = {};
    clearAllSubSegCardBubbleCommitTimers();
    state.subSegCardDeleteDialogKey = null;
    state.activeSubSegValueKey = null;
    resetSubSegTimelineUiState();
    state.selectedSpanIndex = -1;
    clearTargetSpanLock({ preserveSelection: false });
    state.shiftHoldTss = null;
    state.markerSignature = "";
    state.subSegSignature = "";
    state.targetMarkerSignature = "";
    clearDeleteTarget({ silent: true });
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

    const created = {
      start,
      end,
      createdAt: new Date().toISOString()
    };
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

  function hasDeleteTargetSelection() {
    return (state.deleteTargetType === "checkpoint" || state.deleteTargetType === "subseg") &&
      Number.isFinite(state.deleteTargetIndex) &&
      state.deleteTargetIndex >= 0;
  }

  function clearDeleteTarget(ctx) {
    const data = ctx || {};
    const silent = Boolean(data.silent);
    const hadTarget = hasDeleteTargetSelection() || state.deleteConfirmOpen;
    state.deleteTargetType = "";
    state.deleteTargetIndex = -1;
    state.deleteConfirmOpen = false;
    state.markerSignature = "";
    state.targetMarkerSignature = "";
    if (deleteConfirmDialog) {
      deleteConfirmDialog.classList.add("hidden");
    }
    if (!silent && hadTarget) {
      setSaveStatus("Delete target cleared");
    }
  }

  function cycleDeleteTarget(step) {
    if (!isPlayerActive() || !audio.src) {
      return;
    }
    syncTargetSubSegsFromCurrentBounds();
    let targetType = "";
    let total = 0;
    if (hasTargetSpan() && state.targetSubSegs.length > 0) {
      targetType = "subseg";
      total = state.targetSubSegs.length;
    } else if (!hasTargetSpan() && state.checkpoints.length > 0) {
      targetType = "checkpoint";
      total = state.checkpoints.length;
    }
    if (!targetType || total <= 0) {
      setSaveStatus(hasTargetSpan() ? "No subSeg tags available for delete target" : "No checkpoints available for delete target");
      return;
    }
    if (state.deleteTargetType !== targetType || state.deleteTargetIndex < 0 || state.deleteTargetIndex >= total) {
      state.deleteTargetIndex = step > 0 ? 0 : total - 1;
    } else {
      state.deleteTargetIndex = (state.deleteTargetIndex + step + total) % total;
    }
    state.deleteTargetType = targetType;
    state.deleteConfirmOpen = false;
    state.markerSignature = "";
    state.targetMarkerSignature = "";
    updateUi();

    if (targetType === "checkpoint") {
      const point = state.checkpoints[state.deleteTargetIndex];
      setSaveStatus(
        "Delete target checkpoint " + String(state.deleteTargetIndex + 1) + "/" + String(total) +
        ": " + formatTime(Number.isFinite(point) ? point : 0)
      );
      return;
    }
    const seg = state.targetSubSegs[state.deleteTargetIndex];
    setSaveStatus(
      "Delete target subSeg " + String(state.deleteTargetIndex + 1) + "/" + String(total) +
      ": " + formatCompactedRange(seg ? seg.start : 0, seg ? seg.end : 0)
    );
  }

  function openDeleteConfirmDialog() {
    const target = getActiveDeleteTarget();
    if (!target) {
      setSaveStatus("Select a delete target first (Ctrl+Up/Down)");
      return;
    }
    state.deleteConfirmOpen = true;
    renderDeleteConfirmDialog();
    requestAnimationFrame(function () {
      if (!deleteConfirmCancel) {
        return;
      }
      try {
        deleteConfirmCancel.focus({ preventScroll: true });
      } catch {
        deleteConfirmCancel.focus();
      }
    });
    setSaveStatus("Confirm delete target");
  }

  function closeDeleteConfirmDialog() {
    state.deleteConfirmOpen = false;
    renderDeleteConfirmDialog();
  }

  function getActiveDeleteTarget() {
    if (!hasDeleteTargetSelection()) {
      return null;
    }
    if (state.deleteTargetType === "checkpoint") {
      const idx = state.deleteTargetIndex;
      const seconds = state.checkpoints[idx];
      if (!Number.isFinite(seconds)) {
        return null;
      }
      return {
        type: "checkpoint",
        index: idx,
        summary: "checkpoint at " + formatTime(seconds)
      };
    }
    if (state.deleteTargetType === "subseg") {
      syncTargetSubSegsFromCurrentBounds();
      const idx = state.deleteTargetIndex;
      const seg = state.targetSubSegs[idx];
      if (!seg || !Number.isFinite(seg.start) || !Number.isFinite(seg.end) || seg.end <= seg.start) {
        return null;
      }
      return {
        type: "subseg",
        index: idx,
        start: seg.start,
        end: seg.end,
        summary: "subSeg " + formatCompactedRange(seg.start, seg.end)
      };
    }
    return null;
  }

  function confirmDeleteTarget() {
    const target = getActiveDeleteTarget();
    if (!target) {
      clearDeleteTarget({ silent: true });
      updateUi();
      setSaveStatus("Delete target is no longer valid");
      return;
    }

    if (target.type === "checkpoint") {
      const deletedTime = state.checkpoints[target.index];
      state.checkpoints.splice(target.index, 1);
      state.selectedSpanIndex = -1;
      state.markerSignature = "";
      state.targetMarkerSignature = "";
      clearDeleteTarget({ silent: true });
      updateUi();
      enqueueAutoSave();
      setSaveStatus("Deleted checkpoint " + formatTime(Number.isFinite(deletedTime) ? deletedTime : 0));
      return;
    }

    const subSegIndex = state.subSegs.findIndex(function (seg) {
      return Math.abs(seg.start - target.start) <= 0.01 && Math.abs(seg.end - target.end) <= 0.01;
    });
    if (subSegIndex < 0) {
      clearDeleteTarget({ silent: true });
      updateUi();
      setSaveStatus("Delete target is no longer valid");
      return;
    }
    state.subSegs.splice(subSegIndex, 1);
    const valueKey = getSubSegValueKey(target);
    if (valueKey && Object.prototype.hasOwnProperty.call(state.subSegValueEntries, valueKey)) {
      delete state.subSegValueEntries[valueKey];
    }
    if (valueKey && Object.prototype.hasOwnProperty.call(state.subSegTimelines, valueKey)) {
      delete state.subSegTimelines[valueKey];
    }
    if (state.subSegTimelineKey === valueKey) {
      resetSubSegTimelineUiState();
    }
    syncTargetSubSegsFromCurrentBounds();
    state.selectedTargetSubSegIndex = -1;
    state.subSegSignature = "";
    state.markerSignature = "";
    state.targetMarkerSignature = "";
    clearDeleteTarget({ silent: true });
    updateUi();
    enqueueAutoSave();
    setSaveStatus("Deleted " + target.summary);
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

  function hideSubSegTimeline() {
    state.subSegTimelineVisible = false;
    state.subSegTimelineTraversal = false;
    state.subSegTimelineNodeIndex = -1;
    state.subSegTimelineKey = "";
    renderSubSegValuePanel();
  }

  function resetSubSegTimelineUiState() {
    state.subSegTimelineVisible = false;
    state.subSegTimelineTraversal = false;
    state.subSegTimelineKey = "";
    state.subSegTimelineNodeIndex = -1;
  }

  function isSubSegTimelineTraversalActiveForKey(key) {
    return Boolean(
      state.subSegTimelineVisible &&
      state.subSegTimelineTraversal &&
      key &&
      state.subSegTimelineKey === key
    );
  }

  function cloneSubSegValueEntryList(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return JSON.parse(JSON.stringify(list));
  }

  function parseSubSegValueKey(key) {
    const raw = String(key || "");
    const parts = raw.split("|");
    if (parts.length !== 2) {
      return null;
    }
    const start = Number(parts[0]);
    const end = Number(parts[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }
    return { start, end };
  }

  function getSubSegCreatedAtByKey(key) {
    const parsed = parseSubSegValueKey(key);
    if (!parsed) {
      return "";
    }
    const match = state.subSegs.find(function (seg) {
      return Math.abs(seg.start - parsed.start) <= 0.01 && Math.abs(seg.end - parsed.end) <= 0.01;
    });
    if (!match) {
      return "";
    }
    const createdAt = String(match.createdAt || "");
    const stamp = new Date(createdAt);
    if (Number.isNaN(stamp.getTime())) {
      return "";
    }
    return createdAt;
  }

  function createTimelineEventId() {
    state.subSegTimelineEventIdCounter += 1;
    return "timeline-" + Date.now().toString(36) + "-" + state.subSegTimelineEventIdCounter.toString(36);
  }

  function ensureSubSegTimeline(key) {
    if (!key) {
      return null;
    }
    const timeline = state.subSegTimelines[key];
    if (timeline && typeof timeline === "object" && Array.isArray(timeline.events)) {
      if (timeline.events.length <= 0 && Array.isArray(state.subSegValueEntries[key]) && state.subSegValueEntries[key].length > 0) {
        const seededAt = getEarliestEntryCreatedAt(state.subSegValueEntries[key]) || new Date().toISOString();
        timeline.events.push({
          id: createTimelineEventId(),
          label: "timeline-seed",
          createdAt: seededAt,
          snapshot: cloneSubSegValueEntryList(state.subSegValueEntries[key])
        });
      }
      return timeline;
    }
    const createdAt = getSubSegCreatedAtByKey(key) || new Date().toISOString();
    const seeded = {
      createdAt,
      events: []
    };
    state.subSegTimelines[key] = seeded;
    if (Array.isArray(state.subSegValueEntries[key]) && state.subSegValueEntries[key].length > 0) {
      const seededAt = getEarliestEntryCreatedAt(state.subSegValueEntries[key]) || new Date().toISOString();
      seeded.events.push({
        id: createTimelineEventId(),
        label: "timeline-seed",
        createdAt: seededAt,
        snapshot: cloneSubSegValueEntryList(state.subSegValueEntries[key])
      });
    }
    return seeded;
  }

  function recordSubSegTimelineEvent(key, label, createdAt) {
    if (!key) {
      return;
    }
    const timeline = ensureSubSegTimeline(key);
    if (!timeline) {
      return;
    }
    if (!Array.isArray(timeline.events)) {
      timeline.events = [];
    }
    const when = String(createdAt || new Date().toISOString());
    timeline.events.push({
      id: createTimelineEventId(),
      label: String(label || "version"),
      createdAt: when,
      snapshot: cloneSubSegValueEntryList(state.subSegValueEntries[key])
    });
    if (timeline.events.length > 400) {
      timeline.events = timeline.events.slice(timeline.events.length - 400);
    }
  }

  function getSelectedSubSegTimeline() {
    const key = state.activeSubSegValueKey || getSelectedTargetSubSegValueKey();
    if (!key) {
      return null;
    }
    return ensureSubSegTimeline(key);
  }

  function getTimelineNodeSnapshot(key) {
    if (!isSubSegTimelineTraversalActiveForKey(key)) {
      return null;
    }
    const timeline = ensureSubSegTimeline(key);
    if (!timeline || !Array.isArray(timeline.events) || timeline.events.length <= 0) {
      return null;
    }
    const idx = Math.max(0, Math.min(timeline.events.length - 1, Number(state.subSegTimelineNodeIndex)));
    const event = timeline.events[idx];
    return Array.isArray(event && event.snapshot) ? event.snapshot : null;
  }

  function traverseSubSegTimeline(step) {
    const key = state.activeSubSegValueKey;
    if (!key) {
      return;
    }
    const timeline = ensureSubSegTimeline(key);
    const events = Array.isArray(timeline && timeline.events) ? timeline.events : [];
    if (events.length <= 0) {
      setSaveStatus("No timeline checkpoints yet");
      return;
    }
    const delta = step > 0 ? 1 : -1;
    if (!state.subSegTimelineVisible || state.subSegTimelineKey !== key) {
      state.subSegTimelineVisible = true;
      state.subSegTimelineTraversal = true;
      state.subSegTimelineKey = key;
      state.subSegTimelineNodeIndex = events.length - 1;
    }
    const nextIndex = Math.max(0, Math.min(events.length - 1, state.subSegTimelineNodeIndex + delta));
    state.subSegTimelineNodeIndex = nextIndex;
    const targetEvent = events[nextIndex];
    renderSubSegValuePanel();
    focusTopSubSegInput();
    setSaveStatus(
      "Timeline " + String(nextIndex + 1) + "/" + String(events.length) +
      " | " + formatSavedAt(targetEvent && targetEvent.createdAt ? targetEvent.createdAt : "")
    );
  }

  function renderSubSegTimeline(key) {
    if (!subSegTimeline || !subSegTimelineTrack || !subSegTimelineStart || !subSegTimelineEnd) {
      return;
    }
    const canShow = Boolean(state.subSegTimelineVisible && key);
    subSegTimeline.classList.toggle("hidden", !canShow);
    subSegTimelineTrack.innerHTML = "";
    if (!canShow) {
      return;
    }
    const timeline = ensureSubSegTimeline(key);
    const events = Array.isArray(timeline && timeline.events) ? timeline.events : [];
    if (events.length <= 0) {
      subSegTimeline.classList.add("hidden");
      return;
    }
    const fallbackIso = String((timeline && timeline.createdAt) || events[0].createdAt || new Date().toISOString());
    const fallbackStamp = getTimestampOrFallback(fallbackIso, Date.now());
    const stamps = events
      .map(function (eventItem) {
        return getTimestampOrFallback(eventItem && eventItem.createdAt ? eventItem.createdAt : fallbackIso, fallbackStamp);
      })
      .filter(function (stamp) { return Number.isFinite(stamp); });
    const startStamp = stamps.length > 0 ? Math.min.apply(null, stamps) : fallbackStamp;
    const endStamp = stamps.length > 0 ? Math.max.apply(null, stamps) : fallbackStamp;
    const span = Math.max(1, endStamp - startStamp);
    subSegTimelineStart.textContent = "start " + formatSavedAt(new Date(startStamp).toISOString());
    subSegTimelineEnd.textContent = "end " + formatSavedAt(new Date(endStamp).toISOString());
    const tickCount = 5;
    for (let idx = 0; idx < tickCount; idx += 1) {
      const ratio = tickCount <= 1 ? 0 : idx / (tickCount - 1);
      const tickLeftPct = ratio * 100;
      const tickStamp = startStamp + (span * ratio);
      const tick = document.createElement("span");
      tick.className = "subseg-timeline-tick";
      tick.style.left = String(tickLeftPct) + "%";
      const tickLabel = document.createElement("span");
      tickLabel.className = "subseg-timeline-tick-label";
      tickLabel.style.left = String(tickLeftPct) + "%";
      tickLabel.textContent = formatTimelineElapsed(tickStamp - startStamp);
      subSegTimelineTrack.appendChild(tick);
      subSegTimelineTrack.appendChild(tickLabel);
    }
    const selectedIdx = Math.max(0, Math.min(events.length - 1, Number(state.subSegTimelineNodeIndex)));
    events.forEach(function (eventItem, idx) {
      const eventStamp = new Date(eventItem && eventItem.createdAt ? eventItem.createdAt : fallbackIso).getTime();
      const safeStamp = Number.isFinite(eventStamp) ? eventStamp : startStamp;
      const leftPct = Math.max(0, Math.min(100, ((safeStamp - startStamp) / span) * 100));
      const node = document.createElement("button");
      node.type = "button";
      node.className = "subseg-timeline-node" + (idx === selectedIdx ? " is-selected" : "");
      node.style.left = String(leftPct) + "%";
      node.title = String(eventItem && eventItem.label ? eventItem.label : "version") + " | " + formatSavedAt(eventItem && eventItem.createdAt ? eventItem.createdAt : "");
      node.addEventListener("click", function () {
        state.subSegTimelineVisible = true;
        state.subSegTimelineTraversal = true;
        state.subSegTimelineKey = key;
        state.subSegTimelineNodeIndex = idx;
        renderSubSegValuePanel();
        focusTopSubSegInput();
      });
      subSegTimelineTrack.appendChild(node);
    });
  }

  function activateSubSegValueSelection() {
    const key = getSelectedTargetSubSegValueKey();
    if (!key) {
      setSaveStatus("Select a subSeg first (Ctrl+Left/Right)");
      return;
    }
    state.activeSubSegValueKey = key;
    ensureSubSegTimeline(key);
    resetSubSegTimelineUiState();
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
      resetSubSegTimelineUiState();
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
    if (isSubSegTimelineTraversalActiveForKey(key)) {
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
      nodeId: createSubSegValueNodeId(),
      value: text,
      createdAt,
      history: [],
      children: [],
      anchorStart: null,
      anchorEnd: null
    });
    recordSubSegTimelineEvent(key, "card-created", createdAt);
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
      if (subSegTimelineTrack) {
        subSegTimelineTrack.innerHTML = "";
      }
      if (subSegTimeline) {
        subSegTimeline.classList.add("hidden");
      }
      subSegValueList.innerHTML = "";
      state.subSegCardLiveValueOverrides = {};
      state.subSegCardInternalChangeGuards = {};
      clearAllSubSegCardCommitTimers();
      scheduleGuideStepRender({ deps: {} });
      return;
    }

    const timelineSnapshot = getTimelineNodeSnapshot(selectedKey);
    const values = Array.isArray(timelineSnapshot)
      ? timelineSnapshot
      : (Array.isArray(state.subSegValueEntries[selectedKey]) ? state.subSegValueEntries[selectedKey] : []);
    renderSubSegTimeline(selectedKey);
    if (subSegValueInput) {
      subSegValueInput.readOnly = isSubSegTimelineTraversalActiveForKey(selectedKey);
    }
    subSegValueList.innerHTML = "";
    values.forEach(function (entry, entryIndex) {
      renderSubSegValueCardNode(
        selectedKey,
        entry,
        [entryIndex],
        0,
        entryIndex === (values.length - 1),
        [],
        entryIndex + 1
      );
    });
    scheduleGuideStepRender({ deps: {} });
  }

  function renderSubSegValueCardNode(key, entry, path, depth, isLastSibling, ancestorGuideDepths, siblingOrder) {
    if (!subSegValueList || !entry || typeof entry !== "object") {
      return;
    }
    const pathKey = getSubSegValuePathKey(path);
    const card = document.createElement("div");
    card.className = "subseg-value-card";
    card.style.setProperty("--subseg-card-depth", String(Math.max(0, depth)));
    card.classList.toggle("is-nested", depth > 0);
    card.classList.toggle("is-last-sibling", Boolean(isLastSibling) && depth > 0);
    const bridgeLeft = depth > 0 ? -9 : 0;
    const bridgeWidth = depth > 0 ? 4 : 0;
    card.style.setProperty("--subseg-card-line-left", String(bridgeLeft) + "px");
    card.style.setProperty("--subseg-card-bridge-left", String(bridgeLeft) + "px");
    card.style.setProperty("--subseg-card-bridge-width", String(bridgeWidth) + "px");
    card.style.setProperty("--subseg-card-indent-step", "10px");
    card.classList.toggle("has-following-content", false);
    if (depth > 0 && Array.isArray(ancestorGuideDepths) && ancestorGuideDepths.length > 0) {
      const uniqueGuideDepths = ancestorGuideDepths.filter(function (guideDepth, idx, arr) {
        return Number.isFinite(guideDepth) && guideDepth > 0 && arr.indexOf(guideDepth) === idx;
      });
      if (uniqueGuideDepths.length > 0) {
        const guides = document.createElement("div");
        guides.className = "subseg-value-ancestor-guides";
        uniqueGuideDepths.forEach(function (guideDepth) {
          const depthDelta = depth - guideDepth;
          if (depthDelta <= 0) {
            return;
          }
          const guide = document.createElement("span");
          guide.className = "subseg-value-ancestor-guide";
          const guideLeft = -9 - (10 * depthDelta);
          guide.style.left = String(guideLeft) + "px";
          guides.appendChild(guide);
        });
        if (guides.childNodes.length > 0) {
          card.appendChild(guides);
        }
      }
    }
    if (depth > 0 && Number.isFinite(siblingOrder) && siblingOrder > 0) {
      const connectorBadge = document.createElement("span");
      connectorBadge.className = "subseg-value-connector-badge";
      connectorBadge.textContent = String(Math.floor(siblingOrder));
      connectorBadge.style.left = "calc(var(--subseg-card-line-left, -9px) + (var(--subseg-card-bridge-width, 4px) / 2) + 1px)";
      card.appendChild(connectorBadge);
    }
    const inputShell = document.createElement("div");
    inputShell.className = "subseg-value-card-input-shell";
    const selectionLayer = document.createElement("div");
    selectionLayer.className = "subseg-value-selection-layer";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "subseg-value-card-input";
    input.dataset.subSegValueKey = key;
    input.dataset.subSegValuePath = pathKey;
    const isTimelineTraversal = isSubSegTimelineTraversalActiveForKey(key);
    const recallPosition = getCardRecallPosition(key, pathKey, entry);
    const isRecalling = recallPosition < getCardCurrentPosition(entry);
    const liveOverrideKey = getSubSegCardRecallStateKey(key, pathKey);
    const displayedValue = isTimelineTraversal
      ? String(entry.value || "")
      : isRecalling
      ? getCardValueAtPosition(entry, recallPosition)
      : Object.prototype.hasOwnProperty.call(state.subSegCardLiveValueOverrides, liveOverrideKey)
        ? String(state.subSegCardLiveValueOverrides[liveOverrideKey] || "")
        : String(entry.value || "");
    const recallMeta = getCardRecallMeta(entry, recallPosition);
    const version = document.createElement("div");
    version.className = "subseg-value-version";
    const totalVersions = getCardTotalVersions(entry);
    if (isTimelineTraversal) {
      version.textContent = "timeline | " + formatSavedAt(entry && entry.createdAt ? entry.createdAt : "");
    } else if (isRecalling && recallMeta) {
      version.textContent = "current -" + String(recallMeta.offset) + " (" + String(totalVersions) + " total) | " + formatSavedAt(recallMeta.createdAt);
    } else {
      version.textContent = "current -0 (" + String(totalVersions) + " total) | " + formatSavedAt(entry && entry.createdAt ? entry.createdAt : "");
    }
    input.value = displayedValue;
    input.readOnly = Boolean(isRecalling || isTimelineTraversal);
    if (isRecalling) {
      input.classList.add("is-recalling");
    }
    if (!isTimelineTraversal) {
      input.addEventListener("input", handleSubSegCardInputLive);
      input.addEventListener("change", handleSubSegCardInputChange);
    }
    inputShell.appendChild(selectionLayer);
    inputShell.appendChild(input);
    card.appendChild(version);
    card.appendChild(inputShell);

    const cardBubble = document.createElement("span");
    cardBubble.className = "subseg-value-card-bubble";
    const cardBubbleStateKey = getSubSegCardRecallStateKey(key, pathKey);
    const cardBubbleInput = document.createElement("textarea");
    cardBubbleInput.className = "subseg-value-card-bubble-input";
    cardBubbleInput.autocomplete = "off";
    cardBubbleInput.spellcheck = false;
    cardBubbleInput.rows = 1;
    cardBubbleInput.wrap = "soft";
    cardBubbleInput.dataset.subSegValueKey = key;
    cardBubbleInput.dataset.subSegValuePath = pathKey;
    cardBubbleInput.setAttribute("aria-label", "Card comment");
    cardBubbleInput.value = Object.prototype.hasOwnProperty.call(state.subSegCardBubbleValues, cardBubbleStateKey)
      ? String(state.subSegCardBubbleValues[cardBubbleStateKey] || "")
      : "";
    cardBubbleInput.addEventListener("input", handleSubSegCardBubbleInputLive);
    cardBubbleInput.addEventListener("change", handleSubSegCardBubbleInputChange);
    cardBubble.appendChild(cardBubbleInput);
    card.appendChild(cardBubble);

    const deleteDialogKey = getSubSegCardRecallStateKey(key, pathKey);
    if (state.subSegCardDeleteDialogKey === deleteDialogKey) {
      const actions = document.createElement("div");
      actions.className = "subseg-value-delete-row";

      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "subseg-value-delete-cancel";
      cancelButton.dataset.subSegValueDeleteCancel = "1";
      cancelButton.dataset.subSegValueKey = key;
      cancelButton.dataset.subSegValuePath = pathKey;
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", function () {
        state.subSegCardDeleteDialogKey = null;
        renderSubSegValuePanel();
        focusSubSegCardInput(key, pathKey, isRecalling);
      });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "subseg-value-delete-confirm";
      deleteButton.dataset.subSegValueDeleteConfirm = "1";
      deleteButton.dataset.subSegValueKey = key;
      deleteButton.dataset.subSegValuePath = pathKey;
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", function () {
        deleteSubSegValueCard(key, pathKey);
      });

      actions.appendChild(cancelButton);
      actions.appendChild(deleteButton);
      card.appendChild(actions);
    }

    entry.children = getSortedChildEntries(entry.children);
    const sortedChildren = entry.children;
    const nextAncestorGuideDepths = Array.isArray(ancestorGuideDepths)
      ? ancestorGuideDepths.slice()
      : [];
    if (depth > 0 && !isLastSibling) {
      nextAncestorGuideDepths.push(depth);
    }
    const visibleChildren = [];
    sortedChildren.forEach(function (childEntry, childIndex) {
      const childPath = path.concat(childIndex);
      const childPathKey = getSubSegValuePathKey(childPath);
      const childRecallPosition = getCardRecallPosition(key, childPathKey, childEntry);
      const childDisplayedValue = String(getCardValueAtPosition(childEntry, childRecallPosition) || "").trim();
      if (!childDisplayedValue) {
        return;
      }
      const resolvedSelection = resolveSubSegCardSelectionRange(displayedValue, childEntry);
      if (!resolvedSelection) {
        return;
      }
      if (String(displayedValue || "").indexOf(childDisplayedValue) < 0) {
        return;
      }
      visibleChildren.push({
        childEntry,
        childPath,
        childPathKey,
        childDisplayedValue,
        childRecallPosition,
        resolvedSelection,
        order: visibleChildren.length + 1
      });
    });
    const hasFollowingContent = Boolean(!isLastSibling || visibleChildren.length > 0);
    card.dataset.subsegHasFollowingContent = hasFollowingContent ? "1" : "0";
    card.classList.toggle("has-following-content", hasFollowingContent);
    if (hasFollowingContent) {
      const followingSpine = document.createElement("span");
      followingSpine.className = "subseg-value-following-spine";
      card.appendChild(followingSpine);
    }
    subSegValueList.appendChild(card);
    syncSubSegCardBubbleWidth(cardBubbleInput);
    requestAnimationFrame(function () {
      syncSubSegCardBubbleWidth(cardBubbleInput);
    });
    if (visibleChildren.length > 0) {
      renderSubSegCardSelectionBubbles({
        ui: {
          selectionLayer,
          input,
          inputShell
        },
        data: {
          displayedValue,
          visibleChildren
        },
        deps: {}
      });
    }
    visibleChildren.forEach(function (item, visibleIndex) {
      renderSubSegValueCardNode(
        key,
        item.childEntry,
        item.childPath,
        depth + 1,
        visibleIndex === (visibleChildren.length - 1),
        nextAncestorGuideDepths,
        visibleIndex + 1
      );
    });
  }

  function resolveSubSegCardSelectionRange(displayedValue, childEntry) {
    const text = String(displayedValue || "");
    const entryValue = String(childEntry && childEntry.value != null ? childEntry.value : "").trim();
    const anchorStart = Number(childEntry && childEntry.anchorStart);
    const anchorEnd = Number(childEntry && childEntry.anchorEnd);
    if (Number.isFinite(anchorStart) && Number.isFinite(anchorEnd) && anchorEnd > anchorStart && anchorStart >= 0 && anchorEnd <= text.length) {
      return trimSubSegSelectionRange(text, { start: Math.floor(anchorStart), end: Math.floor(anchorEnd) });
    }
    if (!entryValue) {
      return null;
    }
    const directIndex = text.indexOf(entryValue);
    if (directIndex >= 0) {
      return trimSubSegSelectionRange(text, { start: directIndex, end: directIndex + entryValue.length });
    }
    return null;
  }

  function trimSubSegSelectionRange(text, range) {
    const source = String(text || "");
    const resolved = range && Number.isFinite(range.start) && Number.isFinite(range.end)
      ? { start: Math.max(0, Math.floor(range.start)), end: Math.max(0, Math.floor(range.end)) }
      : null;
    if (!resolved || resolved.end <= resolved.start) {
      return null;
    }
    let start = resolved.start;
    let end = Math.min(source.length, resolved.end);
    while (start < end && /\s/.test(source.charAt(start))) {
      start += 1;
    }
    while (end > start && /\s/.test(source.charAt(end - 1))) {
      end -= 1;
    }
    if (end <= start) {
      return null;
    }
    return { start, end };
  }

  function renderSubSegCardSelectionBubbles(ctx) {
    const { ui, data } = ctx;
    const selectionLayer = ui && ui.selectionLayer ? ui.selectionLayer : null;
    const input = ui && ui.input ? ui.input : null;
    const inputShell = ui && ui.inputShell ? ui.inputShell : null;
    const displayedValue = String(data && data.displayedValue ? data.displayedValue : "");
    const visibleChildren = Array.isArray(data && data.visibleChildren) ? data.visibleChildren : [];
    if (!selectionLayer || !input || !inputShell) {
      return;
    }
    selectionLayer.innerHTML = "";
    if (!displayedValue || visibleChildren.length <= 0) {
      return;
    }

    const style = window.getComputedStyle(input);

    visibleChildren.forEach(function (item) {
      const range = item && item.resolvedSelection ? item.resolvedSelection : null;
      if (!range) {
        return;
      }
      const rawSelectedText = displayedValue.slice(range.start, range.end);
      const leadingTrim = rawSelectedText.match(/^\s*/);
      const trailingTrim = rawSelectedText.match(/\s*$/);
      const startOffset = leadingTrim ? leadingTrim[0].length : 0;
      const endOffset = trailingTrim ? trailingTrim[0].length : 0;
      const trimmedStart = range.start + startOffset;
      const trimmedEnd = range.end - endOffset;
      if (trimmedEnd <= trimmedStart) {
        return;
      }
      const mirror = document.createElement("div");
      mirror.className = "subseg-value-selection-mirror";
      mirror.style.font = [
        style ? style.fontStyle : "",
        style ? style.fontVariant : "",
        style ? style.fontWeight : "",
        style ? style.fontStretch : "",
        style ? style.fontSize : "",
        style ? style.fontFamily : ""
      ].filter(function (value) { return Boolean(String(value || "").trim()); }).join(" ") || "normal 0.78rem Segoe UI, Tahoma, sans-serif";
      mirror.style.paddingLeft = String(Number.parseFloat(style.paddingLeft) || 0) + "px";
      mirror.style.paddingTop = String(Number.parseFloat(style.paddingTop) || 0) + "px";
      mirror.style.paddingRight = String(Number.parseFloat(style.paddingRight) || 0) + "px";
      mirror.style.paddingBottom = String(Number.parseFloat(style.paddingBottom) || 0) + "px";

      const before = document.createElement("span");
      before.className = "subseg-value-selection-mirror-text";
      before.textContent = displayedValue.slice(0, trimmedStart);

      const selected = document.createElement("span");
      selected.className = "subseg-value-selection-mirror-selected";
      selected.textContent = displayedValue.slice(trimmedStart, trimmedEnd);

      const after = document.createElement("span");
      after.className = "subseg-value-selection-mirror-text";
      after.textContent = displayedValue.slice(trimmedEnd);

      mirror.appendChild(before);
      mirror.appendChild(selected);
      mirror.appendChild(after);
      selectionLayer.appendChild(mirror);

      const mirrorRect = mirror.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      const left = Math.max(0, selectedRect.left - mirrorRect.left);
      const top = Math.max(0, selectedRect.top - mirrorRect.top);
      const width = Math.max(12, selectedRect.width);
      const height = Math.max(16, selectedRect.height);

      const bubble = document.createElement("span");
      bubble.className = "subseg-value-selection-bubble";
      bubble.style.left = String(left - 1) + "px";
      bubble.style.top = String(top - 1) + "px";
      bubble.style.width = String(width + 2) + "px";
      bubble.style.height = String(height + 2) + "px";
      bubble.style.setProperty("--subseg-bubble-order", String(item.order || 1));
      bubble.setAttribute("aria-hidden", "true");
      const badge = document.createElement("span");
      badge.className = "subseg-value-selection-badge";
      badge.textContent = String(item.order || 1);
      bubble.appendChild(badge);
      selectionLayer.appendChild(bubble);
      selectionLayer.removeChild(mirror);
    });
  }

  function renderDeleteConfirmDialog() {
    if (!deleteConfirmDialog || !deleteConfirmText) {
      return;
    }
    const target = getActiveDeleteTarget();
    const isVisible = Boolean(state.deleteConfirmOpen && target);
    deleteConfirmDialog.classList.toggle("hidden", !isVisible);
    if (!isVisible) {
      return;
    }
    deleteConfirmText.textContent = "Delete " + target.summary + "? This cannot be undone.";
  }

  function handleSubSegCardInputChange(event) {
    const inputEl = event ? event.target : null;
    const key = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValueKey || "" : "");
    const pathKey = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValuePath || "" : "");
    if (key && pathKey && consumeSubSegCardInternalChangeGuard(key, pathKey)) {
      return;
    }
    commitSubSegCardInputValue(inputEl, { rerender: false });
  }

  function handleSubSegCardBubbleInputLive(event) {
    const inputEl = event ? event.target : null;
    const key = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValueKey || "" : "");
    const pathKey = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValuePath || "" : "");
    if (!key || !pathKey || !inputEl) {
      return;
    }
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    const nextValue = String(inputEl.value || "");
    if (nextValue) {
      state.subSegCardBubbleValues[stateKey] = nextValue;
    } else if (Object.prototype.hasOwnProperty.call(state.subSegCardBubbleValues, stateKey)) {
      delete state.subSegCardBubbleValues[stateKey];
    }
    syncSubSegCardBubbleWidth(inputEl);
    scheduleSubSegCardBubbleCommitDebounced(key, pathKey);
  }

  function handleSubSegCardBubbleInputChange(event) {
    const inputEl = event ? event.target : null;
    const key = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValueKey || "" : "");
    const pathKey = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValuePath || "" : "");
    if (!key || !pathKey || !inputEl) {
      return;
    }
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    clearSubSegCardBubbleCommitTimerByStateKey(stateKey);
    const nextValue = String(inputEl.value || "");
    if (nextValue) {
      state.subSegCardBubbleValues[stateKey] = nextValue;
    } else if (Object.prototype.hasOwnProperty.call(state.subSegCardBubbleValues, stateKey)) {
      delete state.subSegCardBubbleValues[stateKey];
    }
    syncSubSegCardBubbleWidth(inputEl);
    enqueueAutoSave();
  }

  function handleSubSegCardInputLive(event) {
    const inputEl = event ? event.target : null;
    const key = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValueKey || "" : "");
    const pathKey = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValuePath || "" : "");
    if (!key || !pathKey) {
      return;
    }
    if (isSubSegTimelineTraversalActiveForKey(key)) {
      return;
    }
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    const value = String(inputEl && inputEl.value ? inputEl.value : "");
    state.subSegCardLiveValueOverrides[stateKey] = value;
    setSubSegCardInternalChangeGuard(key, pathKey);
    scheduleSubSegCardCommitDebounced(key, pathKey);
    const selectionStart = Number(inputEl && inputEl.selectionStart);
    const selectionEnd = Number(inputEl && inputEl.selectionEnd);
    renderSubSegValuePanel();
    focusSubSegCardInput(key, pathKey, false, {
      selectionStart: Number.isFinite(selectionStart) ? selectionStart : value.length,
      selectionEnd: Number.isFinite(selectionEnd) ? selectionEnd : value.length
    });
    requestAnimationFrame(function () {
      clearSubSegCardInternalChangeGuard(key, pathKey);
    });
  }

  function clearSubSegCardBubbleCommitTimerByStateKey(stateKey) {
    const timerId = Number(state.subSegCardBubbleCommitTimerIds[stateKey]);
    if (Number.isFinite(timerId) && timerId > 0) {
      window.clearTimeout(timerId);
    }
    delete state.subSegCardBubbleCommitTimerIds[stateKey];
  }

  function clearAllSubSegCardBubbleCommitTimers() {
    const keys = Object.keys(state.subSegCardBubbleCommitTimerIds || {});
    keys.forEach(function (stateKey) {
      clearSubSegCardBubbleCommitTimerByStateKey(stateKey);
    });
  }

  function scheduleSubSegCardBubbleCommitDebounced(key, pathKey) {
    if (!key || !pathKey) {
      return;
    }
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    clearSubSegCardBubbleCommitTimerByStateKey(stateKey);
    state.subSegCardBubbleCommitTimerIds[stateKey] = window.setTimeout(function () {
      clearSubSegCardBubbleCommitTimerByStateKey(stateKey);
      enqueueAutoSave();
    }, 900);
  }

  function ensureSubSegTextMeasureContext() {
    if (!state.subSegTextMeasureCanvas) {
      state.subSegTextMeasureCanvas = document.createElement("canvas");
    }
    if (!state.subSegTextMeasureCanvasContext && state.subSegTextMeasureCanvas) {
      state.subSegTextMeasureCanvasContext = state.subSegTextMeasureCanvas.getContext("2d");
    }
    return state.subSegTextMeasureCanvasContext;
  }

  function syncSubSegCardBubbleWidth(inputEl) {
    if (!inputEl) {
      return;
    }
    const bubble = inputEl.closest(".subseg-value-card-bubble");
    const card = inputEl.closest(".subseg-value-card");
    if (!bubble || !card) {
      return;
    }
    const value = String(inputEl.value || "");
    const hasContent = Boolean(value.trim());
    const minWidth = 32;
    const minHeight = 12;
    const cardWidth = card.getBoundingClientRect ? card.getBoundingClientRect().width : 0;
    const maxWidth = cardWidth > 0 ? Math.max(minWidth, Math.floor(cardWidth * 0.6)) : 240;
    let nextWidth = minWidth;
    let nextHeight = minHeight;
    if (hasContent) {
      const ctx = ensureSubSegTextMeasureContext();
      const computed = window.getComputedStyle(inputEl);
      if (ctx && computed) {
        const font = computed.font || [
          computed.fontStyle,
          computed.fontVariant,
          computed.fontWeight,
          computed.fontSize,
          computed.fontFamily
        ].filter(Boolean).join(" ");
        ctx.font = font;
        const lines = String(value).split(/\r?\n/);
        const widestLine = lines.reduce(function (maxLineWidth, line) {
          const lineWidth = ctx.measureText(line).width;
          return Math.max(maxLineWidth, lineWidth);
        }, 0);
        nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.ceil(widestLine + 18)));
        inputEl.style.height = "0px";
        nextHeight = Math.max(minHeight, Math.ceil(inputEl.scrollHeight + 4));
        nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.ceil(widestLine + 18)));
      } else {
        inputEl.style.height = String(minHeight) + "px";
      }
    }
    bubble.style.height = String(nextHeight) + "px";
    inputEl.style.height = String(nextHeight) + "px";
    bubble.style.width = String(nextWidth) + "px";
    const reserveBelow = card.dataset.subsegHasFollowingContent === "1";
    const marginBottom = reserveBelow ? Math.max(0, nextHeight - 2) : 0;
    const spineExtension = reserveBelow ? Math.max(0, marginBottom - 7) : 0;
    card.style.marginBottom = String(marginBottom) + "px";
    card.style.setProperty("--subseg-card-spine-extension", String(spineExtension) + "px");
    bubble.classList.toggle("has-content", hasContent);
  }

  function commitSubSegCardInputValue(inputEl, options) {
    const key = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValueKey || "" : "");
    const pathKey = String(inputEl && inputEl.dataset ? inputEl.dataset.subSegValuePath || "" : "");
    if (isSubSegTimelineTraversalActiveForKey(key)) {
      return { changed: false, key, pathKey };
    }
    const entry = getSubSegValueEntry(key, pathKey);
    if (!entry) {
      return { changed: false, key, pathKey };
    }
    clearSubSegCardCommitTimerByStateKey(getSubSegCardRecallStateKey(key, pathKey));
    const currentPos = getCardCurrentPosition(entry);
    const recallPos = getCardRecallPosition(key, pathKey, entry);
    if (recallPos < currentPos) {
      if (inputEl) {
        inputEl.value = getCardValueAtPosition(entry, recallPos);
      }
      return { changed: false, key, pathKey };
    }
    const nextValue = String(inputEl && inputEl.value ? inputEl.value : "").trim();
    const result = applySubSegCardValueCommit(key, pathKey, nextValue, {
      rerender: Boolean(options && options.rerender),
      restoreFocus: Boolean(options && options.rerender)
    });
    if (inputEl && !result.changed) {
      inputEl.value = String(entry.value || "");
    }
    return result;
  }

  function applySubSegCardValueCommit(key, pathKey, nextValueRaw, options) {
    const entry = getSubSegValueEntry(key, pathKey);
    if (!entry) {
      return { changed: false, key, pathKey };
    }
    const currentPos = getCardCurrentPosition(entry);
    const recallPos = getCardRecallPosition(key, pathKey, entry);
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    if (recallPos < currentPos) {
      return { changed: false, key, pathKey };
    }
    const nextValue = String(nextValueRaw || "").trim();
    const prevValue = String(entry.value || "");
    if (!nextValue || nextValue === prevValue) {
      if (Object.prototype.hasOwnProperty.call(state.subSegCardLiveValueOverrides, stateKey)) {
        delete state.subSegCardLiveValueOverrides[stateKey];
      }
      return { changed: false, key, pathKey };
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
    setCardRecallPosition(key, pathKey, getCardCurrentPosition(entry));
    recordSubSegTimelineEvent(key, "card-version", entry.createdAt);
    if (Object.prototype.hasOwnProperty.call(state.subSegCardLiveValueOverrides, stateKey)) {
      delete state.subSegCardLiveValueOverrides[stateKey];
    }
    if (options && options.rerender) {
      renderSubSegValuePanel();
      if (options.restoreFocus) {
        focusSubSegCardInput(key, pathKey, false);
      }
    }
    enqueueAutoSave();
    return { changed: true, key, pathKey };
  }

  function clearSubSegCardCommitTimerByStateKey(stateKey) {
    const timerId = Number(state.subSegCardCommitTimerIds[stateKey]);
    if (Number.isFinite(timerId) && timerId > 0) {
      window.clearTimeout(timerId);
    }
    delete state.subSegCardCommitTimerIds[stateKey];
  }

  function setSubSegCardInternalChangeGuard(key, pathKey) {
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    state.subSegCardInternalChangeGuards[stateKey] = true;
  }

  function clearSubSegCardInternalChangeGuard(key, pathKey) {
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    delete state.subSegCardInternalChangeGuards[stateKey];
  }

  function consumeSubSegCardInternalChangeGuard(key, pathKey) {
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    if (!state.subSegCardInternalChangeGuards[stateKey]) {
      return false;
    }
    delete state.subSegCardInternalChangeGuards[stateKey];
    return true;
  }

  function clearAllSubSegCardCommitTimers() {
    const keys = Object.keys(state.subSegCardCommitTimerIds || {});
    keys.forEach(function (stateKey) {
      clearSubSegCardCommitTimerByStateKey(stateKey);
    });
  }

  function scheduleSubSegCardCommitDebounced(key, pathKey) {
    if (!key || !pathKey) {
      return;
    }
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    clearSubSegCardCommitTimerByStateKey(stateKey);
    state.subSegCardCommitTimerIds[stateKey] = window.setTimeout(function () {
      clearSubSegCardCommitTimerByStateKey(stateKey);
      const nextValue = Object.prototype.hasOwnProperty.call(state.subSegCardLiveValueOverrides, stateKey)
        ? String(state.subSegCardLiveValueOverrides[stateKey] || "")
        : "";
      if (!nextValue) {
        return;
      }
      applySubSegCardValueCommit(key, pathKey, nextValue, { rerender: false, restoreFocus: false });
    }, 2500);
  }

  function getSubSegValueEntry(key, index) {
    const path = getSubSegValuePathArray(index);
    if (!key || path.length <= 0) {
      return null;
    }
    const list = Array.isArray(state.subSegValueEntries[key]) ? state.subSegValueEntries[key] : null;
    if (!list) {
      return null;
    }
    let node = null;
    for (let i = 0; i < path.length; i += 1) {
      const idx = path[i];
      const source = i === 0
        ? list
        : (node && Array.isArray(node.children) ? node.children : null);
      if (!source || idx < 0 || idx >= source.length) {
        return null;
      }
      node = source[idx];
    }
    return node;
  }

  function getSubSegValuePathArray(pathLike) {
    if (Array.isArray(pathLike)) {
      return pathLike.filter(function (v) { return Number.isFinite(v) && v >= 0; }).map(function (v) { return Math.floor(v); });
    }
    if (typeof pathLike === "number" && Number.isFinite(pathLike)) {
      return [Math.floor(pathLike)];
    }
    const raw = String(pathLike || "").trim();
    if (!raw) {
      return [];
    }
    const mapped = raw.split(".")
      .map(function (part) {
        const idx = Number(part);
        return Number.isFinite(idx) && idx >= 0 ? Math.floor(idx) : NaN;
      });
    if (mapped.some(function (v) { return !Number.isFinite(v); })) {
      return [];
    }
    return mapped;
  }

  function getSubSegValuePathKey(pathLike) {
    return getSubSegValuePathArray(pathLike).join(".");
  }

  function getSubSegCardRecallStateKey(key, pathKey) {
    return key + "#" + String(pathKey || "");
  }

  function getCardCurrentPosition(entry) {
    const historyLen = Array.isArray(entry && entry.history) ? entry.history.length : 0;
    return historyLen;
  }

  function getCardTotalVersions(entry) {
    return getCardCurrentPosition(entry) + 1;
  }

  function getCardRecallPosition(key, pathKey, entry) {
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
    const currentPos = getCardCurrentPosition(entry);
    const stored = Number(state.subSegCardRecallPositions[stateKey]);
    if (!Number.isFinite(stored) || stored < 0 || stored > currentPos) {
      return currentPos;
    }
    return stored;
  }

  function setCardRecallPosition(key, pathKey, position) {
    const stateKey = getSubSegCardRecallStateKey(key, pathKey);
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
    const isEnter = keyCode === "Enter" || keyValue === "Enter";
    const isBackspace = keyCode === "Backspace" || keyValue === "Backspace";
    const isCtrl = Boolean(event.ctrlKey || event.metaKey);
    const isShift = Boolean(event.shiftKey);
    const key = String(active.dataset.subSegValueKey || "");
    const pathKey = String(active.dataset.subSegValuePath || "");
    if (isSubSegTimelineTraversalActiveForKey(key)) {
      event.preventDefault();
      event.stopPropagation();
      focusTopSubSegInput();
      return true;
    }
    const entry = getSubSegValueEntry(key, pathKey);
    if (!entry) {
      return false;
    }
    if (isEnter) {
      const childPathKey = createChildCardFromSelection(key, pathKey, active, entry);
      if (childPathKey) {
        event.preventDefault();
        event.stopPropagation();
        renderSubSegValuePanel();
        focusSubSegCardInput(key, childPathKey, false, { selectAll: true });
        enqueueAutoSave();
        return true;
      }
      return false;
    }
    if (!isCtrl) {
      return false;
    }

    const currentPos = getCardCurrentPosition(entry);
    let recallPos = getCardRecallPosition(key, pathKey, entry);

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
      toggleSubSegCardDeleteDialog(key, pathKey);
      return true;
    }

    if ((isArrowUp || isArrowDown) && !isShift) {
      event.preventDefault();
      event.stopPropagation();
      moveFocusFromSubSegCardInput(key, pathKey, isArrowDown ? 1 : -1);
      return true;
    }

    if ((isArrowLeft || isArrowRight) && !isShift) {
      event.preventDefault();
      event.stopPropagation();
      if (isArrowLeft) {
        recallPos = Math.max(0, recallPos - 1);
      } else {
        recallPos = Math.min(currentPos, recallPos + 1);
      }
      setCardRecallPosition(key, pathKey, recallPos);
      const isRecalling = recallPos < currentPos;
      renderSubSegValuePanel();
      focusSubSegCardInput(key, pathKey, isRecalling);
      return true;
    }

    return false;
  }

  function focusSubSegCardInput(key, pathKey, isRecalling, options) {
    requestAnimationFrame(function () {
      const selector = ".subseg-value-card-input[data-sub-seg-value-key=\"" + cssEscapeAttr(key) + "\"][data-sub-seg-value-path=\"" + cssEscapeAttr(pathKey) + "\"]";
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
      if (options && options.selectAll) {
        input.select();
      } else if (options && Number.isFinite(options.selectionStart) && Number.isFinite(options.selectionEnd)) {
        try {
          input.setSelectionRange(options.selectionStart, options.selectionEnd);
        } catch {
          // Ignore selection failures.
        }
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
    const visiblePaths = getVisibleSubSegCardPathList(key);
    const totalCards = visiblePaths.length;
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
    const nextPathKey = visiblePaths[nextSlot - 1];
    if (!nextPathKey) {
      return;
    }
    const nextEntry = getSubSegValueEntry(key, nextPathKey);
    if (!nextEntry) {
      return;
    }
    const nextCurrentPos = getCardCurrentPosition(nextEntry);
    const nextRecallPos = getCardRecallPosition(key, nextPathKey, nextEntry);
    focusSubSegCardInput(key, nextPathKey, nextRecallPos < nextCurrentPos);
  }

  function moveFocusFromSubSegCardInput(key, pathKey, delta) {
    const visiblePaths = getVisibleSubSegCardPathList(key);
    const totalCards = visiblePaths.length;
    if (totalCards <= 0) {
      return;
    }
    const currentIndex = visiblePaths.indexOf(pathKey);
    if (currentIndex < 0) {
      return;
    }
    const totalSlots = totalCards + 1;
    const currentSlot = currentIndex + 1;
    const nextSlot = (currentSlot + delta + totalSlots) % totalSlots;
    if (nextSlot === 0) {
      focusTopSubSegInput();
      return;
    }
    const nextPathKey = visiblePaths[nextSlot - 1];
    if (!nextPathKey) {
      return;
    }
    const nextEntry = getSubSegValueEntry(key, nextPathKey);
    if (!nextEntry) {
      return;
    }
    const nextCurrentPos = getCardCurrentPosition(nextEntry);
    const nextRecallPos = getCardRecallPosition(key, nextPathKey, nextEntry);
    focusSubSegCardInput(key, nextPathKey, nextRecallPos < nextCurrentPos);
  }

  function getVisibleSubSegCardPathList(key) {
    if (!key || !subSegValueList) {
      return [];
    }
    const selector = ".subseg-value-card-input[data-sub-seg-value-key=\"" + cssEscapeAttr(key) + "\"][data-sub-seg-value-path]";
    const nodes = Array.from(subSegValueList.querySelectorAll(selector));
    return nodes
      .map(function (node) {
        return String(node.dataset && node.dataset.subSegValuePath ? node.dataset.subSegValuePath : "").trim();
      })
      .filter(function (path) { return Boolean(path); });
  }

  function cssEscapeAttr(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  function toggleSubSegCardDeleteDialog(key, pathKey) {
    const dialogKey = getSubSegCardRecallStateKey(key, pathKey);
    if (state.subSegCardDeleteDialogKey === dialogKey) {
      state.subSegCardDeleteDialogKey = null;
      renderSubSegValuePanel();
      focusSubSegCardInput(key, pathKey, false);
      return;
    }
    state.subSegCardDeleteDialogKey = dialogKey;
    renderSubSegValuePanel();
    focusSubSegDeleteCancel(key, pathKey);
  }

  function focusSubSegDeleteCancel(key, pathKey) {
    requestAnimationFrame(function () {
      const selector = "button[data-sub-seg-value-delete-cancel=\"1\"][data-sub-seg-value-key=\"" + cssEscapeAttr(key) + "\"][data-sub-seg-value-path=\"" + cssEscapeAttr(pathKey) + "\"]";
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

  function deleteSubSegValueCard(key, pathKey) {
    const path = getSubSegValuePathArray(pathKey);
    const list = Array.isArray(state.subSegValueEntries[key]) ? state.subSegValueEntries[key] : null;
    if (!list || path.length <= 0) {
      return;
    }
    const lastIndex = path[path.length - 1];
    const parentPath = path.slice(0, -1);
    const parentNode = parentPath.length > 0 ? getSubSegValueEntry(key, parentPath) : null;
    const sourceList = parentNode
      ? (Array.isArray(parentNode.children) ? parentNode.children : null)
      : list;
    if (!sourceList || lastIndex < 0 || lastIndex >= sourceList.length) {
      return;
    }
    sourceList.splice(lastIndex, 1);
    const deletedAt = new Date().toISOString();
    if (!list.length) {
      delete state.subSegValueEntries[key];
      delete state.subSegTimelines[key];
      if (state.subSegTimelineKey === key) {
        resetSubSegTimelineUiState();
      }
    } else {
      recordSubSegTimelineEvent(key, "card-delete", deletedAt);
    }
    state.subSegCardDeleteDialogKey = null;
    const recallKeys = Object.keys(state.subSegCardRecallPositions);
    const targetPrefix = key + "#" + getSubSegValuePathKey(path);
    recallKeys.forEach(function (k) {
      if (k === targetPrefix || k.startsWith(targetPrefix + ".")) {
        delete state.subSegCardRecallPositions[k];
      }
    });
    const liveKeys = Object.keys(state.subSegCardLiveValueOverrides);
    liveKeys.forEach(function (k) {
      if (k === targetPrefix || k.startsWith(targetPrefix + ".")) {
        delete state.subSegCardLiveValueOverrides[k];
      }
    });
    const guardKeys = Object.keys(state.subSegCardInternalChangeGuards);
    guardKeys.forEach(function (k) {
      if (k === targetPrefix || k.startsWith(targetPrefix + ".")) {
        delete state.subSegCardInternalChangeGuards[k];
      }
    });
    const bubbleKeys = Object.keys(state.subSegCardBubbleValues);
    bubbleKeys.forEach(function (k) {
      if (k === targetPrefix || k.startsWith(targetPrefix + ".")) {
        delete state.subSegCardBubbleValues[k];
      }
    });
    const bubbleTimerKeys = Object.keys(state.subSegCardBubbleCommitTimerIds);
    bubbleTimerKeys.forEach(function (k) {
      if (k === targetPrefix || k.startsWith(targetPrefix + ".")) {
        clearSubSegCardBubbleCommitTimerByStateKey(k);
      }
    });
    const timerKeys = Object.keys(state.subSegCardCommitTimerIds);
    timerKeys.forEach(function (k) {
      if (k === targetPrefix || k.startsWith(targetPrefix + ".")) {
        clearSubSegCardCommitTimerByStateKey(k);
      }
    });
    renderSubSegValuePanel();
    focusTopSubSegInput();
    enqueueAutoSave();
  }

  function createSubSegValueNodeId() {
    state.subSegValueNodeIdCounter += 1;
    return "card-" + Date.now().toString(36) + "-" + state.subSegValueNodeIdCounter.toString(36);
  }

  function createChildCardFromSelection(key, parentPathKey, inputEl, parentEntry) {
    if (!key || !parentEntry || !inputEl) {
      return "";
    }
    const selectionStart = Number(inputEl.selectionStart);
    const selectionEnd = Number(inputEl.selectionEnd);
    if (!Number.isFinite(selectionStart) || !Number.isFinite(selectionEnd) || selectionEnd <= selectionStart) {
      return "";
    }
    const sourceValue = String(inputEl.value || "");
    const selectedValue = sourceValue.slice(selectionStart, selectionEnd).trim();
    if (!selectedValue) {
      return "";
    }
    if (!Array.isArray(parentEntry.children)) {
      parentEntry.children = [];
    }
    const createdAt = new Date().toISOString();
    const childNode = {
      nodeId: createSubSegValueNodeId(),
      value: selectedValue,
      createdAt,
      history: [],
      children: [],
      anchorStart: selectionStart,
      anchorEnd: selectionEnd
    };
    parentEntry.children.push(childNode);
    parentEntry.children = getSortedChildEntries(parentEntry.children);
    const childIndex = parentEntry.children.findIndex(function (child) {
      return child && child.nodeId === childNode.nodeId;
    });
    if (childIndex < 0) {
      return "";
    }
    recordSubSegTimelineEvent(key, "card-child-created", createdAt);
    const childPathKey = getSubSegValuePathKey(parentPathKey + "." + String(childIndex));
    setCardRecallPosition(key, childPathKey, 0);
    return childPathKey;
  }

  function getSortedChildEntries(children) {
    const list = Array.isArray(children) ? children.slice() : [];
    list.sort(function (a, b) {
      const aStart = Number.isFinite(Number(a && a.anchorStart)) ? Number(a.anchorStart) : Number.MAX_SAFE_INTEGER;
      const bStart = Number.isFinite(Number(b && b.anchorStart)) ? Number(b.anchorStart) : Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) {
        return aStart - bStart;
      }
      const aEnd = Number.isFinite(Number(a && a.anchorEnd)) ? Number(a.anchorEnd) : Number.MAX_SAFE_INTEGER;
      const bEnd = Number.isFinite(Number(b && b.anchorEnd)) ? Number(b.anchorEnd) : Number.MAX_SAFE_INTEGER;
      if (aEnd !== bEnd) {
        return aEnd - bEnd;
      }
      const aCreated = String(a && a.createdAt ? a.createdAt : "");
      const bCreated = String(b && b.createdAt ? b.createdAt : "");
      if (aCreated !== bCreated) {
        return aCreated < bCreated ? -1 : 1;
      }
      const aId = String(a && a.nodeId ? a.nodeId : "");
      const bId = String(b && b.nodeId ? b.nodeId : "");
      if (aId === bId) {
        return 0;
      }
      return aId < bId ? -1 : 1;
    });
    return list;
  }

  function getFlattenedSubSegCardList(key) {
    const roots = key && Array.isArray(state.subSegValueEntries[key]) ? state.subSegValueEntries[key] : [];
    const flattened = [];
    function visit(nodes, pathPrefix) {
      const list = Array.isArray(nodes) ? nodes : [];
      list.forEach(function (entry, index) {
        const path = pathPrefix.concat(index);
        flattened.push({
          pathKey: getSubSegValuePathKey(path),
          entry
        });
        if (entry && Array.isArray(entry.children) && entry.children.length > 0) {
          visit(entry.children, path);
        }
      });
    }
    visit(roots, []);
    return flattened;
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
    renderDeleteConfirmDialog();

    if (isPlayerActive() && duration > 0 && !state.hasAutoFocusedProgress) {
      state.hasAutoFocusedProgress = true;
      focusProgressControl();
    }
    scheduleGuideStepRender({ deps: {} });
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
        marker.classList.add("is-tag-target");
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
        marker.classList.add("is-tag-target");
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
      const isDeleteTarget = !hasTargetSpan() &&
        state.deleteTargetType === "checkpoint" &&
        state.deleteTargetIndex === checkpointIndex;
      if (isDeleteTarget) {
        tag.classList.add("is-delete-target");
        marker.classList.add("is-tag-target");
      }
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
      if (idx === state.selectedTargetSubSegIndex || (state.deleteTargetType === "subseg" && state.deleteTargetIndex === idx)) {
        span.classList.add("is-tag-target");
      }
      span.style.left = String(startPct) + "%";
      span.style.width = String(widthPct) + "%";

      const tag = document.createElement("span");
      tag.className = "checkpoint-tag target-subseg-tag";
      if (state.deleteTargetType === "subseg" && state.deleteTargetIndex === idx) {
        tag.classList.add("is-delete-target");
      }
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
      const rawCreatedAt = String(seg && seg.createdAt ? seg.createdAt : "");
      const createdStamp = new Date(rawCreatedAt);
      normalized.push({
        start: clampedStart,
        end: clampedEnd,
        createdAt: Number.isNaN(createdStamp.getTime()) ? new Date().toISOString() : rawCreatedAt
      });
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
          return normalizeSubSegValueEntryNode(entry, nowIso);
        })
        .filter(function (v) { return Boolean(v); })
        .slice(0, 200);
      if (cleaned.length > 0) {
        normalized[key] = cleaned;
      }
    });
    return normalized;
  }

  function normalizeSubSegTimelines(rawTimelines, subSegValueEntries) {
    const source = rawTimelines && typeof rawTimelines === "object" ? rawTimelines : {};
    const normalized = {};
    const nowIso = new Date().toISOString();
    Object.keys(source).forEach(function (key) {
      const timeline = source[key];
      if (!timeline || typeof timeline !== "object") {
        return;
      }
      const rawCreatedAt = String(timeline.createdAt || getSubSegCreatedAtByKey(key) || nowIso);
      const createdAtStamp = new Date(rawCreatedAt);
      const createdAt = Number.isNaN(createdAtStamp.getTime()) ? nowIso : rawCreatedAt;
      const eventsRaw = Array.isArray(timeline.events) ? timeline.events : [];
      const events = eventsRaw
        .map(function (eventItem) {
          if (!eventItem || typeof eventItem !== "object") {
            return null;
          }
          const rawEventCreatedAt = String(eventItem.createdAt || nowIso);
          const eventStamp = new Date(rawEventCreatedAt);
          return {
            id: String(eventItem.id || createTimelineEventId()),
            label: String(eventItem.label || "version"),
            createdAt: Number.isNaN(eventStamp.getTime()) ? nowIso : rawEventCreatedAt,
            snapshot: normalizeSubSegValueEntries({ tmp: eventItem.snapshot }).tmp || []
          };
        })
        .filter(function (item) { return Boolean(item); })
        .slice(-400);
      normalized[key] = {
        createdAt,
        events
      };
    });

    Object.keys(subSegValueEntries || {}).forEach(function (key) {
      if (!normalized[key]) {
        normalized[key] = {
          createdAt: getSubSegCreatedAtByKey(key) || nowIso,
          events: []
        };
      }
    });
    return normalized;
  }

  function normalizeSubSegCardBubbleValues(rawValues) {
    const source = rawValues && typeof rawValues === "object" ? rawValues : {};
    const normalized = {};
    Object.keys(source).forEach(function (key) {
      const value = String(source[key] || "").trim();
      if (value) {
        normalized[key] = value;
      }
    });
    return normalized;
  }

  function normalizeSubSegValueEntryNode(entry, nowIso) {
    if (entry && typeof entry === "object") {
      const value = String(entry.value || "").trim();
      if (!value) {
        return null;
      }
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
      const childrenRaw = Array.isArray(entry.children) ? entry.children : [];
      const children = getSortedChildEntries(
        childrenRaw
          .map(function (child) { return normalizeSubSegValueEntryNode(child, nowIso); })
          .filter(function (child) { return Boolean(child); })
      );
      const anchorStartRaw = Number(entry.anchorStart);
      const anchorEndRaw = Number(entry.anchorEnd);
      const anchorStart = Number.isFinite(anchorStartRaw) && anchorStartRaw >= 0 ? Math.floor(anchorStartRaw) : null;
      const anchorEnd = Number.isFinite(anchorEndRaw) && anchorEndRaw >= 0 ? Math.floor(anchorEndRaw) : null;
      return {
        nodeId: typeof entry.nodeId === "string" && entry.nodeId ? entry.nodeId : createSubSegValueNodeId(),
        value,
        createdAt,
        history,
        children,
        anchorStart,
        anchorEnd
      };
    }
    const value = String(entry || "").trim();
    if (!value) {
      return null;
    }
    return {
      nodeId: createSubSegValueNodeId(),
      value,
      createdAt: nowIso,
      history: [],
      children: [],
      anchorStart: null,
      anchorEnd: null
    };
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
    state.subSegCardInternalChangeGuards = {};
    state.subSegCardDeleteDialogKey = null;
    state.activeSubSegValueKey = null;
    resetSubSegTimelineUiState();
    state.shiftHoldTss = null;
    state.targetMarkerSignature = "";
    if (state.deleteTargetType === "subseg" || state.deleteConfirmOpen) {
      clearDeleteTarget({ silent: true });
    }
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
        state.activeRevision = 0;
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
        ttlMs: Number(record.ttlMs || LOGIN_TTL_MS),
        lastActivityAt: Number(record.lastActivityAt || Date.now())
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
      const lastActivityAt = Number(parsed && parsed.lastActivityAt ? parsed.lastActivityAt : loggedInAt);
      if (
        ALLOWED_USERS.indexOf(username) < 0 ||
        !token ||
        !Number.isFinite(loggedInAt) ||
        !Number.isFinite(ttlMs) ||
        ttlMs <= 0 ||
        !Number.isFinite(lastActivityAt)
      ) {
        return null;
      }
      if ((Date.now() - lastActivityAt) > ttlMs) {
        window.localStorage.removeItem(LOGIN_STORAGE_KEY);
        return null;
      }
      return { username, token, loggedInAt, ttlMs, lastActivityAt };
    } catch {
      return null;
    }
  }

  function readGuideSeenVersionMap() {
    try {
      const raw = window.localStorage.getItem(GUIDE_SEEN_STORAGE_KEY);
      if (!raw) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return parsed;
    } catch {
      return {};
    }
  }

  function writeGuideSeenVersionMap(map) {
    try {
      window.localStorage.setItem(GUIDE_SEEN_STORAGE_KEY, JSON.stringify(map || {}));
    } catch {
      // Ignore storage failures.
    }
  }

  function hasUnseenGuideFeatureForUser(username) {
    const user = String(username || "").trim().toLowerCase();
    if (!user) {
      return false;
    }
    const map = readGuideSeenVersionMap();
    return String(map[user] || "") !== GUIDE_FEATURE_VERSION;
  }

  function markGuideFeatureSeenForCurrentUser() {
    const user = String(state.authUser || "").trim().toLowerCase();
    if (!user) {
      return;
    }
    const map = readGuideSeenVersionMap();
    map[user] = GUIDE_FEATURE_VERSION;
    writeGuideSeenVersionMap(map);
  }

  function renderGuideFeatureBadge() {
    const showBadge = hasUnseenGuideFeatureForUser(state.authUser);
    const wasVisible = Boolean(state.guideFeatureBadgeVisible);
    state.guideFeatureBadgeVisible = showBadge;
    [guideButtonList, guideButtonPlayer].forEach(function (btn) {
      if (!btn) {
        return;
      }
      btn.classList.toggle("has-new-guide-feature", showBadge);
      btn.setAttribute("aria-label", showBadge ? "Start guide mode (new feature added)" : "Start guide mode");
    });
    if (!showBadge) {
      hideGuideFeatureSpotlightNudge();
      return;
    }
    if (!wasVisible) {
      showGuideFeatureSpotlightNudge();
    }
  }

  function getGuideFeatureSpotlightTargetButton() {
    if (state.isPlayerVisible && guideButtonPlayer && !playerView.classList.contains("hidden")) {
      return guideButtonPlayer;
    }
    if (guideButtonList && !libraryView.classList.contains("hidden")) {
      return guideButtonList;
    }
    return guideButtonList || guideButtonPlayer || null;
  }

  function ensureGuideFeatureNudgeElement() {
    let el = document.getElementById("guide-feature-nudge");
    if (el) {
      return el;
    }
    el = document.createElement("div");
    el.id = "guide-feature-nudge";
    el.className = "guide-feature-nudge";
    el.textContent = "New guide features added";
    document.body.appendChild(el);
    return el;
  }

  function positionGuideFeatureNudge(targetButton, nudgeEl) {
    if (!targetButton || !nudgeEl) {
      return;
    }
    const rect = targetButton.getBoundingClientRect();
    const top = Math.max(8, rect.top - 2);
    const preferredLeft = rect.right + 10;
    nudgeEl.style.top = String(Math.round(top)) + "px";
    nudgeEl.style.left = String(Math.round(preferredLeft)) + "px";
    const nudgeRect = nudgeEl.getBoundingClientRect();
    if ((nudgeRect.right + 8) > window.innerWidth) {
      const fallbackLeft = Math.max(8, rect.left - nudgeRect.width - 10);
      nudgeEl.style.left = String(Math.round(fallbackLeft)) + "px";
    }
  }

  function showGuideFeatureSpotlightNudge() {
    if (!state.guideFeatureBadgeVisible) {
      return;
    }
    const targetButton = getGuideFeatureSpotlightTargetButton();
    if (!targetButton) {
      return;
    }
    [guideButtonList, guideButtonPlayer].forEach(function (btn) {
      if (btn) {
        btn.classList.remove("new-feature-spotlight");
      }
    });
    targetButton.classList.add("new-feature-spotlight");
    const nudgeEl = ensureGuideFeatureNudgeElement();
    nudgeEl.classList.add("is-visible");
    positionGuideFeatureNudge(targetButton, nudgeEl);
    if (state.guideFeatureSpotlightTimerId) {
      window.clearTimeout(state.guideFeatureSpotlightTimerId);
      state.guideFeatureSpotlightTimerId = null;
    }
    state.guideFeatureSpotlightTimerId = window.setTimeout(function () {
      hideGuideFeatureSpotlightNudge();
    }, 4500);
  }

  function hideGuideFeatureSpotlightNudge() {
    [guideButtonList, guideButtonPlayer].forEach(function (btn) {
      if (btn) {
        btn.classList.remove("new-feature-spotlight");
      }
    });
    const nudgeEl = document.getElementById("guide-feature-nudge");
    if (nudgeEl) {
      nudgeEl.classList.remove("is-visible");
    }
    if (state.guideFeatureSpotlightTimerId) {
      window.clearTimeout(state.guideFeatureSpotlightTimerId);
      state.guideFeatureSpotlightTimerId = null;
    }
  }

  function persistCurrentLoginActivity() {
    if (!state.authUser || !state.authToken) {
      return;
    }
    persistLogin({
      username: state.authUser,
      token: state.authToken,
      loggedInAt: Date.now(),
      ttlMs: LOGIN_TTL_MS,
      lastActivityAt: state.lastActivityAt || Date.now()
    });
  }

  function scheduleInactivityLogout() {
    if (state.authInactivityTimerId) {
      window.clearTimeout(state.authInactivityTimerId);
      state.authInactivityTimerId = null;
    }
    if (!state.authUser || !state.authToken) {
      return;
    }
    const last = Number.isFinite(state.lastActivityAt) && state.lastActivityAt > 0 ? state.lastActivityAt : Date.now();
    const remaining = Math.max(0, LOGIN_TTL_MS - (Date.now() - last));
    state.authInactivityTimerId = window.setTimeout(function () {
      clearLoginState("Logged out due to inactivity.");
    }, remaining);
  }

  function maybePingAuthActivity() {
    if (!state.authUser || !state.authToken) {
      return;
    }
    const now = Date.now();
    if ((now - state.lastAuthPingAt) < AUTH_PING_MIN_INTERVAL_MS) {
      return;
    }
    state.lastAuthPingAt = now;
    fetch("/api/auth/ping", {
      method: "POST",
      cache: "no-store",
      headers: buildAuthHeaders()
    }).catch(function () {
      // Ignore ping failure; normal auth checks still apply on real requests.
    });
  }

  function handleAuthActivity() {
    if (!state.authUser || !state.authToken) {
      return;
    }
    state.lastActivityAt = Date.now();
    persistCurrentLoginActivity();
    scheduleInactivityLogout();
    maybePingAuthActivity();
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

  function normalizeRevision(value) {
    const numeric = Number(value);
    if (!Number.isInteger(numeric) || numeric < 0) {
      return 0;
    }
    return numeric;
  }

  async function reloadActiveSessionFromServer(ctx) {
    const data = ctx || {};
    const sessionId = String(data.sessionId || state.activeSessionId || "").trim();
    if (!sessionId) {
      return false;
    }
    const response = await fetch("/api/session?id=" + encodeURIComponent(sessionId), {
      method: "GET",
      cache: "no-store",
      headers: buildAuthHeaders()
    });
    if (response.status === 401) {
      clearLoginState("Login expired. Please sign in again.");
      return false;
    }
    if (response.status === 404) {
      if (state.activeSessionId === sessionId) {
        state.activeSessionId = null;
        state.activeRevision = 0;
        state.activeAudioId = null;
        state.activeAudioUrl = null;
        showLibraryView();
        await loadPersistedAudioCards();
        setSaveStatus("Session removed", true);
      }
      return;
    }
    if (!response.ok) {
      return false;
    }
    const saved = await response.json();
    if (!saved || typeof saved !== "object") {
      return;
    }
    state.activeSessionId = saved.id || sessionId;
    state.activeRevision = normalizeRevision(saved.revision);
    state.activeAudioId = typeof saved.audioId === "string" ? saved.audioId : null;
    state.activeAudioUrl = typeof saved.audioUrl === "string" ? saved.audioUrl : null;
    await applySavedSession(saved);
    if (data.statusText) {
      setSaveStatus(String(data.statusText));
    }
    return true;
  }

  function clearLoginState(message) {
    state.authUser = null;
    state.authToken = null;
    state.activeSessionId = null;
    state.activeRevision = 0;
    state.activeAudioId = null;
    state.activeAudioUrl = null;
    state.sessionsCache = [];
    state.openMenuSessionId = null;
    state.lastActivityAt = 0;
    state.lastAuthPingAt = 0;
    if (state.authInactivityTimerId) {
      window.clearTimeout(state.authInactivityTimerId);
      state.authInactivityTimerId = null;
    }
    try {
      window.localStorage.removeItem(LOGIN_STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    showLoginView();
    renderAudioCards([]);
    renderGuideFeatureBadge();
    setLoginStatus(message || "Log in to continue.", true);
  }

  async function saveSessionState() {
    if (!audio.src || !state.currentFile) {
      return;
    }

    const uploadedAudio = await ensureAudioUploaded();

    const payload = {
      sessionId: state.activeSessionId,
      baseRevision: normalizeRevision(state.activeRevision),
      file: {
        name: state.currentFile.name,
        type: state.currentFile.type,
        size: state.currentFile.size,
        lastModified: state.currentFile.lastModified
      },
      playback: {
        checkpoints: state.checkpoints.slice(),
        subSegs: state.subSegs.map(function (seg) {
          return { start: seg.start, end: seg.end, createdAt: seg.createdAt || new Date().toISOString() };
        }),
        subSegValueEntries: state.subSegValueEntries,
        subSegTimelines: state.subSegTimelines,
        subSegCardBubbleValues: state.subSegCardBubbleValues,
        selectedSpanIndex: -1,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        wasPlaying: !audio.paused
      },
      audioId: uploadedAudio.id || "",
      audioUrl: uploadedAudio.url || ""
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
    if (response.status === 409) {
      const conflict = await response.json().catch(function () { return {}; });
      const conflictSessionId = String(
        (conflict && conflict.sessionId) ||
        state.activeSessionId ||
        ""
      ).trim();
      if (conflictSessionId) {
        await reloadActiveSessionFromServer({
          sessionId: conflictSessionId,
          statusText: "Remote changes loaded (conflict)"
        });
      }
      await loadPersistedAudioCards();
      return;
    }

    if (!response.ok) {
      const detail = await response.text().catch(function () { return ""; });
      throw new Error("session_save_failed status=" + String(response.status) + " detail=" + detail);
    }

    const saved = await response.json();
    if (saved && saved.id) {
      state.activeSessionId = saved.id;
    }
    if (saved && saved.revision != null) {
      state.activeRevision = normalizeRevision(saved.revision);
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
    state.activeRevision = normalizeRevision(saved && saved.revision);
    debugLog("applySavedSession:start", {
      id: saved && saved.id,
      revision: state.activeRevision,
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
    state.subSegTimelines = normalizeSubSegTimelines(savedPlayback.subSegTimelines, state.subSegValueEntries);
    state.subSegCardBubbleValues = normalizeSubSegCardBubbleValues(savedPlayback.subSegCardBubbleValues);
    state.activeSubSegValueKey = null;
    resetSubSegTimelineUiState();

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
    if (state.activeAudioUrl) {
      return { id: "", url: state.activeAudioUrl };
    }
    if (!state.currentFile) {
      throw new Error("missing_current_file");
    }
    if (!(state.currentFile instanceof Blob)) {
      throw new Error("missing_uploadable_audio_blob");
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


