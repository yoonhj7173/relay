#!/bin/bash
# Generates SHA256 checksums for all .dmg files in dist/
set -e

if [ ! -d "dist" ]; then
  echo "No dist/ folder found. Run a build first."
  exit 1
fi

for f in dist/*.dmg; do
  [ -f "$f" ] || continue
  shasum -a 256 "$f"
done
