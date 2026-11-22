const { rmSync } = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
for (const relativePath of ["dist", path.join("ui", "dist"), "release"]) {
  rmSync(path.join(root, relativePath), { recursive: true, force: true });
}
