(function (global) {
  function getFetch(deps) {
    if (deps && typeof deps.fetch === "function") {
      return deps.fetch.bind(global);
    }
    return global.fetch.bind(global);
  }

  function normalizeErrorMessage(ctx) {
    const { data = {} } = ctx || {};
    const error = data.error;
    const raw = String(error && error.message ? error.message : error || "unknown_error");
    return raw.length > 180 ? raw.slice(0, 180) + "..." : raw;
  }

  function normalizeRevision(ctx) {
    const { data = {} } = ctx || {};
    const numeric = Number(data.value);
    if (!Number.isInteger(numeric) || numeric < 0) {
      return Number.isInteger(data.fallback) && data.fallback >= 0 ? data.fallback : 0;
    }
    return numeric;
  }

  function buildAuthenticatedAudioUrl(ctx) {
    const { data = {} } = ctx || {};
    const state = data.state || {};
    const query = new URLSearchParams();
    query.set("id", String(data.audioId || ""));
    if (state.authUser) {
      query.set("username", state.authUser);
    }
    if (state.authToken) {
      query.set("authToken", state.authToken);
    }
    return "/api/audio?" + query.toString();
  }

  async function loadPersistedAudioCards(ctx) {
    const { data = {}, deps } = ctx || {};
    const state = data.state || {};
    if (!state.authUser || !state.authToken) {
      return;
    }
    try {
      const response = await getFetch(deps)("/api/sessions", {
        method: "GET",
        cache: "no-store",
        headers: deps.buildAuthHeaders({ data: { state }, deps: {} })
      });
      if (response.status === 401) {
        deps.clearLoginState("Login expired. Please sign in again.");
        return;
      }
      if (response.status === 404) {
        deps.renderAudioCards([]);
        return;
      }
      if (!response.ok) {
        throw new Error("session_list_failed");
      }
      const payload = await response.json();
      const sessions = payload && Array.isArray(payload.sessions) ? payload.sessions : [];
      state.sessionsCache = sessions;
      deps.renderAudioCards(sessions);
    } catch {
      state.sessionsCache = [];
      deps.renderAudioCards([]);
    }
  }

  async function deleteSession(ctx) {
    const { data = {}, deps } = ctx || {};
    const state = data.state || {};
    const sessionId = String(data.sessionId || "");
    if (!sessionId || state.isPersisting || state.loadingSessionId) {
      return;
    }

    state.loadingSessionId = sessionId;
    state.openMenuSessionId = null;
    deps.renderAudioCards(state.sessionsCache);

    try {
      const response = await getFetch(deps)("/api/session?id=" + encodeURIComponent(sessionId), {
        method: "DELETE",
        headers: deps.buildAuthHeaders({ data: { state }, deps: {} })
      });
      if (response.status === 401) {
        deps.clearLoginState("Login expired. Please sign in again.");
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

      deps.setSaveStatus("Deleted");
      await deps.loadPersistedAudioCards({ data: { state }, deps });
    } catch (error) {
      deps.setSaveStatus("Delete failed: " + deps.normalizeErrorMessage({ data: { error }, deps: {} }), true);
    } finally {
      state.loadingSessionId = null;
      deps.renderAudioCards(state.sessionsCache);
    }
  }

  async function reloadActiveSessionFromServer(ctx) {
    const { data = {}, deps } = ctx || {};
    const state = data.state || {};
    const sessionId = String(data.sessionId || state.activeSessionId || "").trim();
    if (!sessionId) {
      return false;
    }
    const response = await getFetch(deps)("/api/session?id=" + encodeURIComponent(sessionId), {
      method: "GET",
      cache: "no-store",
      headers: deps.buildAuthHeaders({ data: { state }, deps: {} })
    });
    if (response.status === 401) {
      deps.clearLoginState("Login expired. Please sign in again.");
      return false;
    }
    if (response.status === 404) {
      if (state.activeSessionId === sessionId) {
        state.activeSessionId = null;
        state.activeRevision = 0;
        state.activeAudioId = null;
        state.activeAudioUrl = null;
        deps.showLibraryView();
        await deps.loadPersistedAudioCards({ data: { state }, deps });
        deps.setSaveStatus("Session removed", true);
      }
      return false;
    }
    if (!response.ok) {
      return false;
    }
    const saved = await response.json();
    if (!saved || typeof saved !== "object") {
      return false;
    }
    state.activeSessionId = saved.id || sessionId;
    state.activeRevision = deps.normalizeRevision({ data: { value: saved.revision, fallback: 0 }, deps: {} });
    state.activeAudioId = typeof saved.audioId === "string" ? saved.audioId : null;
    state.activeAudioUrl = typeof saved.audioUrl === "string" ? saved.audioUrl : null;
    await deps.applySavedSession(saved);
    if (data.statusText) {
      deps.setSaveStatus(String(data.statusText));
    }
    return true;
  }

  async function saveSessionState(ctx) {
    const { data = {}, deps } = ctx || {};
    const state = data.state || {};
    const audio = data.audio;
    if (!audio || !audio.src || !state.currentFile) {
      return;
    }

    const uploadedAudio = await deps.ensureAudioUploaded({ data: { state, audio }, deps });

    const payload = {
      sessionId: state.activeSessionId,
      baseRevision: deps.normalizeRevision({ data: { value: state.activeRevision, fallback: 0 }, deps: {} }),
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
        audSegNoteEntries: state.audSegNoteEntries,
        selectedSpanIndex: Number.isInteger(state.selectedSpanIndex) ? state.selectedSpanIndex : -1,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        wasPlaying: !audio.paused
      },
      audioId: uploadedAudio.id || "",
      audioUrl: uploadedAudio.url || ""
    };

    const response = await getFetch(deps)("/api/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...deps.buildAuthHeaders({ data: { state }, deps: {} })
      },
      body: JSON.stringify(payload)
    });
    if (response.status === 401) {
      deps.clearLoginState("Login expired. Please sign in again.");
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
        await deps.reloadActiveSessionFromServer({
          data: { state, sessionId: conflictSessionId, statusText: "Remote changes loaded (conflict)" },
          deps
        });
      }
      await deps.loadPersistedAudioCards({ data: { state }, deps });
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
      state.activeRevision = deps.normalizeRevision({ data: { value: saved.revision, fallback: 0 }, deps: {} });
    }
    if (uploadedAudio && uploadedAudio.id) {
      state.activeAudioId = uploadedAudio.id;
      state.activeAudioUrl = uploadedAudio.url || null;
    }
    state.pendingUpload = null;

    await deps.loadPersistedAudioCards({ data: { state }, deps });
  }

  async function ensureAudioUploaded(ctx) {
    const { data = {}, deps } = ctx || {};
    const state = data.state || {};
    const audio = data.audio;
    if (state.activeAudioId) {
      return { id: state.activeAudioId, url: state.activeAudioUrl || deps.buildAuthenticatedAudioUrl({ data: { state, audioId: state.activeAudioId }, deps: {} }) };
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

    deps.setSaveStatus("Uploading audio...");

    const query = new URLSearchParams();
    query.set("name", state.currentFile.name || "audio.bin");
    query.set("type", state.currentFile.type || "application/octet-stream");
    query.set("lastModified", String(state.currentFile.lastModified || Date.now()));

    const payload = await deps.uploadAudioWithProgress({
      data: {
        state,
        file: state.currentFile,
        queryString: query.toString()
      },
      deps
    });

    if (!payload || !payload.ok || !payload.audio || !payload.audio.id) {
      throw new Error("audio_upload_invalid_response");
    }

    if (state.pendingUpload) {
      state.pendingUpload.progress = 1;
      state.pendingUpload.phase = "saving";
      deps.renderAudioCards(state.sessionsCache);
    }

    state.activeAudioId = payload.audio.id;
    state.activeAudioUrl = payload.audio.url || null;
    return { id: state.activeAudioId, url: state.activeAudioUrl };
  }

  function uploadAudioWithProgress(ctx) {
    const { data = {}, deps } = ctx || {};
    const state = data.state || {};
    const file = data.file;
    const queryString = data.queryString;

    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/audio?" + queryString);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      const authHeaders = deps.buildAuthHeaders({ data: { state }, deps: {} });
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
        deps.renderAudioCards(state.sessionsCache);
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

  async function fetchSavedAudioBlob(ctx) {
    const { data = {}, deps } = ctx || {};
    const saved = data.saved || {};
    const blobType = saved && saved.file && saved.file.type ? saved.file.type : "application/octet-stream";
    if (saved && typeof saved.audioId === "string" && saved.audioId) {
      const response = await getFetch(deps)("/api/audio?id=" + encodeURIComponent(saved.audioId), {
        method: "GET",
        cache: "no-store",
        headers: deps.buildAuthHeaders({ data: { state: data.state || {} }, deps: {} })
      });
      if (!response.ok) {
        throw new Error("audio_fetch_failed");
      }
      return response.blob();
    }
    if (saved && typeof saved.audioUrl === "string" && saved.audioUrl) {
      const response = await getFetch(deps)(saved.audioUrl, {
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
    const { data = {} } = ctx || {};
    const binary = atob(String(data.base64 || ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob([bytes], { type: data.mimeType || "application/octet-stream" });
  }

  global.audioTestSessionRuntime = {
    normalizeErrorMessage,
    normalizeRevision,
    buildAuthenticatedAudioUrl,
    loadPersistedAudioCards,
    deleteSession,
    reloadActiveSessionFromServer,
    saveSessionState,
    ensureAudioUploaded,
    uploadAudioWithProgress,
    fetchSavedAudioBlob,
    base64ToBlob
  };
})(window);
