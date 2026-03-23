function createContactResolver(ctx) {
  const { data = {}, deps } = ctx || {};
  const { client, fs, path } = deps;

  const cachePath = data.cachePath || "";
  let cache = { recipients: {} };

  function loadCache() {
    try {
      if (!cachePath || !fs.existsSync(cachePath)) {
        cache = { recipients: {} };
        return;
      }

      const raw = fs.readFileSync(cachePath, "utf8");
      const parsed = JSON.parse(raw);
      cache = parsed && typeof parsed === "object" ? parsed : { recipients: {} };
      if (!cache.recipients || typeof cache.recipients !== "object") {
        cache.recipients = {};
      }
    } catch (err) {
      console.error("Failed to load contact resolver cache:", err.message);
      cache = { recipients: {} };
    }
  }

  function saveCache() {
    try {
      if (!cachePath) {
        return;
      }

      fs.mkdirSync(path.dirname(cachePath), { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf8");
    } catch (err) {
      console.error("Failed to save contact resolver cache:", err.message);
    }
  }

  function normalizeToken(token) {
    return (token || "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^@+/, "");
  }

  function isOpenId(token) {
    return /^ou_[a-z0-9]+$/i.test((token || "").trim());
  }

  function isEmail(token) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((token || "").trim());
  }

  function isMobile(token) {
    return /^\+?[0-9][0-9\s()-]{5,}[0-9]$/.test((token || "").trim());
  }

  function rememberRecipient(key, openId, meta = {}) {
    const cleanedKey = normalizeToken(key);
    const cleanedOpenId = normalizeToken(openId);
    if (!cleanedKey || !cleanedOpenId) {
      return;
    }

    cache.recipients[cleanedKey.toLowerCase()] = {
      openId: cleanedOpenId,
      updatedAt: new Date().toISOString(),
      ...meta,
    };
    saveCache();
  }

  async function resolveFromContactDirectory(token) {
    const cleanedToken = normalizeToken(token);
    if (!cleanedToken) {
      return null;
    }

    const cached = cache.recipients[cleanedToken.toLowerCase()];
    if (cached && typeof cached.openId === "string" && isOpenId(cached.openId)) {
      return {
        openId: cached.openId,
        source: "cache",
        token: cleanedToken,
      };
    }

    if (isOpenId(cleanedToken)) {
      rememberRecipient(cleanedToken, cleanedToken, { source: "open_id" });
      return {
        openId: cleanedToken,
        source: "open_id",
        token: cleanedToken,
      };
    }

    let userId = "";
    if (isEmail(cleanedToken)) {
      const result = await client.contact.v3.user.batchGetId({
        data: { emails: [cleanedToken], include_resigned: false },
        params: { user_id_type: "user_id" },
      });
      userId = result?.data?.user_list?.[0]?.user_id?.trim() || "";
      if (userId) {
        rememberRecipient(cleanedToken, userId, { source: "email", userId });
      }
    } else if (isMobile(cleanedToken)) {
      const result = await client.contact.v3.user.batchGetId({
        data: { mobiles: [cleanedToken], include_resigned: false },
        params: { user_id_type: "user_id" },
      });
      userId = result?.data?.user_list?.[0]?.user_id?.trim() || "";
      if (userId) {
        rememberRecipient(cleanedToken, userId, { source: "mobile", userId });
      }
    }

    if (!userId) {
      return null;
    }

    const profile = await client.contact.v3.user.get({
      params: { user_id_type: "user_id" },
      path: { user_id: userId },
    });
    const openId = profile?.data?.user?.open_id?.trim() || "";
    if (!openId) {
      return null;
    }

    rememberRecipient(cleanedToken, openId, { source: "contact", userId });
    rememberRecipient(userId, openId, { source: "contact", userId });

    return {
      openId,
      source: "contact",
      token: cleanedToken,
      userId,
      profile: profile?.data?.user || null,
    };
  }

  async function resolveRecipientOpenId(token) {
    return resolveFromContactDirectory(token);
  }

  return {
    loadCache,
    saveCache,
    normalizeToken,
    isOpenId,
    isEmail,
    isMobile,
    rememberRecipient,
    resolveRecipientOpenId,
  };
}

module.exports = { createContactResolver };
