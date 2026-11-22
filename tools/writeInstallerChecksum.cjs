const { createHash } = require("node:crypto");
const { readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const installerName = `Job-Nearby-Setup-${version}.exe`;
const installerPath = path.join(root, "release", installerName);
const digest = createHash("sha256").update(readFileSync(installerPath)).digest("hex");
const checksumPath = `${installerPath}.sha256`;

writeFileSync(checksumPath, `${digest}  ${installerName}\n`);
process.stdout.write(`SHA-256 ${installerName}: ${digest}\n`);
