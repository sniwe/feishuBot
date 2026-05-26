function createFileTransferService(ctx) {
  const { data = {}, deps } = ctx || {};
  const {
    client,
    fs,
    path,
    projectRoot,
    dataDirPath,
    toYYMMDD,
    appendMessageLog,
    getChatState,
    getPersistedChatEntry,
  } = deps;

  function resolveUploadPath(inputPath) {
    return path.isAbsolute(inputPath) ? inputPath : path.resolve(projectRoot, inputPath);
  }

  function sanitizeFileName(fileName, fallback = "downloaded_file") {
    const name = (fileName || "").trim();
    if (!name) {
      return fallback;
    }

    return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  }

  function inferImFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".mp4") {
      return "mp4";
    }
    if (ext === ".pdf") {
      return "pdf";
    }
    if (ext === ".doc" || ext === ".docx") {
      return "doc";
    }
    if (ext === ".xls" || ext === ".xlsx") {
      return "xls";
    }
    if (ext === ".ppt" || ext === ".pptx") {
      return "ppt";
    }
    if (ext === ".mp3" || ext === ".wav" || ext === ".m4a" || ext === ".aac" || ext === ".ogg" || ext === ".opus") {
      return "opus";
    }
    return "stream";
  }

  function parseMessageContent(content) {
    try {
      const parsed = JSON.parse(content || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function flattenPostContent(postContent) {
    if (!postContent || typeof postContent !== "object") {
      return "";
    }

    function renderPostNode(node) {
      if (!node || typeof node !== "object") {
        return "";
      }

      if (typeof node.text === "string") {
        return node.text;
      }

      const tag = typeof node.tag === "string" ? node.tag.trim().toLowerCase() : "";
      if (tag === "at") {
        const mentionName =
          (typeof node.user_name === "string" && node.user_name.trim()) ||
          (typeof node.user_id === "string" && node.user_id.trim()) ||
          (typeof node.open_id === "string" && node.open_id.trim()) ||
          "";
        return mentionName ? `@${mentionName}` : "@";
      }

      return "";
    }

    const zhCn = postContent.zh_cn;
    const firstLocale = Object.values(postContent).find((value) => value && typeof value === "object");
    const localeBlock = zhCn && typeof zhCn === "object" ? zhCn : firstLocale;
    const paragraphs = Array.isArray(localeBlock?.content) ? localeBlock.content : [];
    const lines = [];

    for (const paragraph of paragraphs) {
      if (!Array.isArray(paragraph)) {
        continue;
      }

      const line = paragraph
        .map((node) => renderPostNode(node))
        .join("")
        .trim();
      if (line) {
        lines.push(line);
      }
    }

    return lines.join("\n").trim();
  }

  function extractUserTextFromMessage(messageType, contentObj) {
    const type = (messageType || "").trim().toLowerCase();
    if (!contentObj || typeof contentObj !== "object") {
      return "";
    }

    if (type === "text") {
      return typeof contentObj.text === "string" ? contentObj.text.trim() : "";
    }

    if (type === "post") {
      return flattenPostContent(contentObj).trim();
    }

    return "";
  }

  async function downloadIncomingFileFromMessage(messageId, fileKey, fileName) {
    if (!messageId || !fileKey) {
      throw new Error("Missing message_id or file_key for file download.");
    }

    const saveDir = path.join(dataDirPath, toYYMMDD(new Date()), "incoming_files");
    fs.mkdirSync(saveDir, { recursive: true });
    const safeName = sanitizeFileName(fileName, `${fileKey}.bin`);
    const savePath = path.join(saveDir, safeName);

    const downloadResult = await client.im.v1.messageResource.get({
      params: { type: "file" },
      path: {
        message_id: messageId,
        file_key: fileKey,
      },
    });

    await downloadResult.writeFile(savePath);
    return savePath;
  }

  function makeUniqueFilePath(dirPath, fileName) {
    const parsed = path.parse(fileName);
    let candidate = path.join(dirPath, fileName);
    let counter = 1;

    while (fs.existsSync(candidate)) {
      const suffix = ` (${counter})`;
      candidate = path.join(dirPath, `${parsed.name}${suffix}${parsed.ext}`);
      counter += 1;
    }

    return candidate;
  }

  function saveOutgoingFileToDailyDataDir(sourcePath) {
    const saveDir = path.join(dataDirPath, toYYMMDD(new Date()), "outgoing_files");
    fs.mkdirSync(saveDir, { recursive: true });

    const safeName = sanitizeFileName(path.basename(sourcePath), `${Date.now()}.bin`);
    const savePath = makeUniqueFilePath(saveDir, safeName);
    fs.copyFileSync(sourcePath, savePath);
    return savePath;
  }

  function extractUploadDirective(text) {
    const lines = (text || "").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const directMatch = trimmed.match(/^!upload\s+(.+)$/i) || trimmed.match(/^UPLOAD_FILE:\s*(.+)$/i);
      if (directMatch && directMatch[1]) {
        return directMatch[1].trim().replace(/^["'`]+|["'`]+$/g, "");
      }
    }

    return "";
  }

  async function uploadFileToChat(chatId, inputPath) {
    const cleanedInputPath = (inputPath || "").trim().replace(/^["'`]+|["'`]+$/g, "");
    const resolvedPath = resolveUploadPath(cleanedInputPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`File not found: ${resolvedPath}`);
    }

    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${resolvedPath}`);
    }

    if (stats.size <= 0) {
      throw new Error(`File is empty: ${resolvedPath}`);
    }

    const savedOutgoingPath = saveOutgoingFileToDailyDataDir(resolvedPath);
    const maxUploadSize = 30 * 1024 * 1024;
    if (stats.size > maxUploadSize) {
      throw new Error(`File exceeds Feishu upload limit of 30MB: ${resolvedPath}`);
    }

    const uploadResult = await client.im.v1.file.create({
      data: {
        file_type: inferImFileType(resolvedPath),
        file_name: path.basename(resolvedPath),
        file: fs.createReadStream(resolvedPath),
      },
    });

    const fileKey = uploadResult && typeof uploadResult.file_key === "string" ? uploadResult.file_key : "";
    if (!fileKey) {
      throw new Error("Feishu did not return a file_key for the uploaded file.");
    }

    await client.im.v1.message.create({
      params: { receive_id_type: "chat_id" },
      data: {
        receive_id: chatId,
        msg_type: "file",
        content: JSON.stringify({ file_key: fileKey }),
      },
    });

    const state = getChatState(chatId);
    const persistedEntry = getPersistedChatEntry(chatId);
    appendMessageLog({
      direction: "outgoing",
      chat_id: chatId,
      message_type: "file",
      file_key: fileKey,
      file_path: resolvedPath,
      saved_outgoing_path: savedOutgoingPath,
      codex_session_id: state?.codexResponseId || persistedEntry.sessionId || "",
      chat_name: persistedEntry.chatName || "",
    });

    return { resolvedPath, fileKey, savedOutgoingPath };
  }

  return {
    resolveUploadPath,
    inferImFileType,
    parseMessageContent,
    extractUserTextFromMessage,
    downloadIncomingFileFromMessage,
    makeUniqueFilePath,
    saveOutgoingFileToDailyDataDir,
    extractUploadDirective,
    uploadFileToChat,
  };
}

module.exports = { createFileTransferService };
