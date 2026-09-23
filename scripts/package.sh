#!/usr/bin/env bash
# Build the Chrome Web Store upload zip from an explicit allowlist, so dev
# files (tests, docs, .env.json with a real API key) can never ship.
set -euo pipefail
cd "$(dirname "$0")/.."

FILES=(
  manifest.json LICENSE
  background.js content.js utils.js
  sidebar.html sidebar.js styles.css theme.css theme.js mode.js transcript.js markdown.js
  js-genai.js
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png
)

# js-genai.js is gitignored; postinstall bundles it from @google/genai.
[ -f js-genai.js ] || npm install

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "missing: $f" >&2; exit 1; }
done

version=$(node -p "require('./manifest.json').version")
out="dist/ai-agent-in-browser-$version.zip"
mkdir -p dist
rm -f "$out"
zip -q -X "$out" "${FILES[@]}"
echo "$out ($(du -h "$out" | cut -f1))"
