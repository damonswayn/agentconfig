"use strict";

const fs = require("fs");
const path = require("path");

const target = path.join(__dirname, "..", "dist", "cli.js");
const shebang = "#!/usr/bin/env node\n";

if (!fs.existsSync(target)) {
  console.error("Missing dist/cli.js; run build first.");
  process.exit(1);
}

const contents = fs.readFileSync(target, "utf8");
if (!contents.startsWith(shebang)) {
  fs.writeFileSync(target, shebang + contents, "utf8");
}
