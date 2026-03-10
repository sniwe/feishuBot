const fs = require("fs");

function readJson(ctx) {
  const { data = {}, deps } = ctx;
  const filePath = data.path;
  const readFileSync = deps.readFileSync || fs.readFileSync;
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function writeJson(ctx) {
  const { data = {}, deps } = ctx;
  const filePath = data.path;
  const value = data.value || {};
  const writeFileSync = deps.writeFileSync || fs.writeFileSync;
  writeFileSync(filePath, JSON.stringify(value, null, 2));
  return filePath;
}

module.exports = {
  readJson,
  writeJson,
};
