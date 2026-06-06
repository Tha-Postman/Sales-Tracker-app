const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "www");

const files = [
  "admin.css",
  "admin.html",
  "dashboard.css",
  "dashboard.html",
  "demo.html",
  "developer.css",
  "developer.html",
  "index.html",
  "manifest.webmanifest",
  "payment-recovery.html",
  "pricing.css",
  "pricing.html",
  "privacy.html",
  "public.css",
  "pwa.js",
  "receipt.html",
  "refund.html",
  "signin.css",
  "signin.html",
  "support-widget.css",
  "support-widget.js",
  "sw.js",
  "terms.html"
];

function copyFile(relativePath) {
  const from = path.join(root, relativePath);
  const to = path.join(outDir, relativePath);

  if (!fs.existsSync(from)) return;

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDirectory(relativePath) {
  const from = path.join(root, relativePath);
  const to = path.join(outDir, relativePath);

  if (!fs.existsSync(from)) return;

  fs.cpSync(from, to, { recursive: true });
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

files.forEach(copyFile);
copyDirectory("img");

console.log("Prepared mobile app shell in www/");
