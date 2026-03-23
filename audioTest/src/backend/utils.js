const path = require("node:path");
const { MAX_BODY_SIZE } = require("./config");

function parseRequestUrl(ctx) {
  const { data } = ctx;
  const { rawUrl } = data;
  return new URL(String(rawUrl || "/"), "http://localhost");
}

function sendJson(ctx) {
  const { data } = ctx;
  const { res, status, payload } = data;

  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBodyText(ctx) {
  const { data } = ctx;
  const { req } = data;

  return new Promise(function (resolve, reject) {
    let body = "";
    req.on("data", function (chunk) {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("payload_too_large"));
      }
    });
    req.on("end", function () {
      resolve(body);
    });
    req.on("error", reject);
  });
}

function readJsonBody(ctx) {
  const { data } = ctx;
  const { req } = data;

  return readBodyText({ data: { req }, deps: {} }).then(function (bodyText) {
    return JSON.parse(bodyText || "{}");
  });
}

function readBodyBuffer(ctx) {
  const { data } = ctx;
  const { req } = data;

  return new Promise(function (resolve, reject) {
    const chunks = [];
    let total = 0;
    req.on("data", function (chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_BODY_SIZE) {
        reject(new Error("payload_too_large"));
        return;
      }
      chunks.push(buf);
    });
    req.on("end", function () {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", reject);
  });
}

function resolveContentType(filePath, overrideContentType) {
  if (overrideContentType) {
    return overrideContentType;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") {
    return "text/html; charset=utf-8";
  }
  if (ext === ".css") {
    return "text/css; charset=utf-8";
  }
  if (ext === ".js") {
    return "application/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

function streamFile(ctx) {
  const { data, deps } = ctx;
  const { res, filePath } = data;

  return new Promise(function (resolve) {
    const stream = deps.fs.createReadStream(filePath);
    stream.on("error", function () {
      sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
      resolve();
    });

    res.writeHead(200, {
      "Content-Type": resolveContentType(filePath, data.overrideContentType),
      "Cache-Control": "no-store"
    });

    stream.on("end", resolve);
    stream.pipe(res);
  });
}

function parseBytesRange(ctx) {
  const { data } = ctx;
  const { range, fileSize } = data;
  const raw = String(range || "").trim();
  const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
  if (!match) {
    return null;
  }

  const startRaw = match[1];
  const endRaw = match[2];

  if (!startRaw && !endRaw) {
    return null;
  }

  let start = startRaw ? Number(startRaw) : NaN;
  let end = endRaw ? Number(endRaw) : NaN;

  if (!Number.isFinite(start) && Number.isFinite(end)) {
    const suffix = end;
    if (suffix <= 0) {
      return null;
    }
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else {
    if (!Number.isFinite(start) || start < 0) {
      return null;
    }
    if (!Number.isFinite(end) || end >= fileSize) {
      end = fileSize - 1;
    }
  }

  if (start > end || start >= fileSize) {
    return null;
  }

  return { start, end };
}

function pipeStream(ctx) {
  const { data } = ctx;
  const { res, stream, status, headers } = data;
  return new Promise(function (resolve) {
    stream.on("error", function () {
      if (!res.headersSent) {
        sendJson({ data: { res, status: 404, payload: { error: "not_found" } }, deps: {} });
      } else {
        res.end();
      }
      resolve();
    });
    res.writeHead(status, headers);
    stream.on("end", resolve);
    stream.pipe(res);
  });
}

async function streamAudioBinary(ctx) {
  const { data, deps } = ctx;
  const { req, res, filePath, contentType } = data;
  let stat;
  try {
    stat = await deps.fsp.stat(filePath);
  } catch {
    sendJson({ data: { res, status: 404, payload: { error: "audio_not_found" } }, deps: {} });
    return;
  }

  const fileSize = Number(stat.size || 0);
  const range = req && req.headers && req.headers.range ? String(req.headers.range) : "";

  if (!range || !/^bytes=/.test(range)) {
    await pipeStream({
      data: {
        res,
        stream: deps.fs.createReadStream(filePath),
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store"
        }
      },
      deps: {}
    });
    return;
  }

  const parsed = parseBytesRange({ data: { range, fileSize }, deps: {} });
  if (!parsed) {
    res.writeHead(416, {
      "Content-Range": "bytes */" + String(fileSize),
      "Cache-Control": "no-store"
    });
    res.end();
    return;
  }

  await pipeStream({
    data: {
      res,
      stream: deps.fs.createReadStream(filePath, { start: parsed.start, end: parsed.end }),
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(parsed.end - parsed.start + 1),
        "Content-Range": "bytes " + String(parsed.start) + "-" + String(parsed.end) + "/" + String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store"
      }
    },
    deps: {}
  });
}

module.exports = {
  parseRequestUrl,
  sendJson,
  readBodyText,
  readJsonBody,
  readBodyBuffer,
  streamFile,
  parseBytesRange,
  pipeStream,
  streamAudioBinary
};
