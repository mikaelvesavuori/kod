#!/bin/bash
set -euo pipefail

# Clean up
rm -rf dist .build-temp
mkdir -p dist

# Step 1: Run SSG to process components and templates
echo "Running SSG..."
node build-ssg.js

# Step 2: Copy all subdirectories from src to dist (except components)
find src -mindepth 1 -maxdepth 1 -type d | while read -r dir; do
  # Skip the components directory
  if [[ "$(basename "$dir")" != "components" ]]; then
    cp -r "$dir" dist/
  fi
done

# Step 3: Copy all various loose files
[ -f manifest.json ] && cp manifest.json dist
[ -f src/ai.txt ] && cp src/ai.txt dist
[ -f src/llms.txt ] && cp src/llms.txt dist
[ -f src/robots.txt ] && cp src/robots.txt dist
[ -f src/sitemap.xml ] && cp src/sitemap.xml dist

# Step 4: Minify the SSG-processed HTML files
echo "Minifying HTML..."
npm run minify:html -- --input-dir=.build-temp

# Step 5: Optimize CSS and JS
npm run minify:css
npm run minify:js

if [[ "${KOD_SKIP_DOCS:-0}" != "1" ]]; then
  echo "Building docs..."
  (cd .. && npm run docs:build)
  rm -rf dist/docs
  mkdir -p dist/docs
  cp -R ../docs/dist/. dist/docs/
fi

# Clean up temporary build directory
rm -rf .build-temp

echo "Build complete!"
