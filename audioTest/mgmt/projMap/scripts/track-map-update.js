const fs = require("fs");

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] || null;
}

function main() {
  const mapPath = readArg("--map");
  const statePath = readArg("--state");

  if (!mapPath || !statePath) {
    throw new Error("Usage: node track-map-update.js --map <path> --state <path>");
  }

  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const previous = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : [];

  previous.push({
    mapId: map.id || "unknown",
    updated: map.updated || null,
    trackedAt: new Date().toISOString(),
  });

  fs.writeFileSync(statePath, JSON.stringify(previous, null, 2));
}

main();
