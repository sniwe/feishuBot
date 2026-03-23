(function () {
  if (window.audioTestFormatUtilsLoaded) {
    return;
  }

  window.audioTestFormatUtilsLoaded = true;

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

  window.getTimestampOrFallback = getTimestampOrFallback;
  window.getEarliestEntryCreatedAt = getEarliestEntryCreatedAt;
  window.formatTimelineElapsed = formatTimelineElapsed;
  window.formatTime = formatTime;
  window.formatCompactedRange = formatCompactedRange;
  window.normalizeSubSegs = normalizeSubSegs;
  window.normalizeSubSegCardBubbleValues = normalizeSubSegCardBubbleValues;
})();
