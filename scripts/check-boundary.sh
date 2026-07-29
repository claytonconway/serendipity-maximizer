#!/usr/bin/env bash
#
# check-boundary.sh — open-core boundary guard
#
# Scans tracked files for terms that belong only in a private content pack,
# never in the public framework. Exits non-zero if any are found so it can
# block a commit (via the pre-commit hook) or fail CI.
#
# Configure the blocklist in .boundary-blocklist (one term per line, # for
# comments). Terms are matched case-insensitively as whole-ish words.
#
# Usage:
#   ./scripts/check-boundary.sh            # scan tracked + staged files
#   ./scripts/check-boundary.sh --all      # scan every file in the tree
#
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

BLOCKLIST_FILE=".boundary-blocklist"
SCAN_EXT=("*.md" "*.jsx" "*.js" "*.mjs" "*.cjs" "*.ts" "*.tsx" "*.html" "*.json" "*.txt")

# ── Colors (fall back to plain if not a TTY) ──
if [ -t 1 ]; then
  RED=$'\033[0;31m'; GRN=$'\033[0;32m'; YEL=$'\033[0;33m'; DIM=$'\033[2m'; NC=$'\033[0m'
else
  RED=""; GRN=""; YEL=""; DIM=""; NC=""
fi

if [ ! -f "$BLOCKLIST_FILE" ]; then
  echo "${YEL}No $BLOCKLIST_FILE found — nothing to check.${NC}"
  echo "Create one with private terms (one per line) to enable boundary enforcement."
  exit 0
fi

# Load non-empty, non-comment lines.
# Portable read loop instead of `mapfile`/`readarray` (bash 4+) so the guard
# runs on macOS's default bash 3.2 — no `--no-verify` needed at commit time.
TERMS=()
while IFS= read -r term; do
  TERMS+=("$term")
done < <(grep -v '^[[:space:]]*#' "$BLOCKLIST_FILE" | grep -v '^[[:space:]]*$' || true)

if [ "${#TERMS[@]}" -eq 0 ]; then
  echo "${YEL}Blocklist is empty — nothing to check.${NC}"
  exit 0
fi

# Decide file set
if [ "${1:-}" = "--all" ]; then
  FILE_SET="$(git ls-files)"
else
  # tracked + staged, deduped
  FILE_SET="$( { git ls-files; git diff --cached --name-only 2>/dev/null || true; } | sort -u )"
fi

# Filter to scannable extensions
FILES=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$f" ] || continue
  for ext in "${SCAN_EXT[@]}"; do
    # shellcheck disable=SC2053
    if [[ "$f" == $ext ]]; then FILES+=("$f"); break; fi
  done
done <<< "$FILE_SET"

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "${GRN}No scannable files.${NC}"
  exit 0
fi

# Build alternation pattern
PATTERN="$(printf '%s\n' "${TERMS[@]}" | paste -sd '|' -)"

echo "${DIM}Scanning ${#FILES[@]} files against ${#TERMS[@]} blocked terms...${NC}"

HITS="$(grep -rniE "$PATTERN" "${FILES[@]}" 2>/dev/null || true)"

if [ -n "$HITS" ]; then
  echo ""
  echo "${RED}✗ BOUNDARY VIOLATION — private content found in public framework:${NC}"
  echo ""
  echo "$HITS" | while IFS= read -r line; do echo "  ${RED}$line${NC}"; done
  echo ""
  echo "${YEL}These terms belong in a private content pack, not the public repo.${NC}"
  echo "${DIM}Move the content to your pack, or if this is a false positive,${NC}"
  echo "${DIM}refine the term in $BLOCKLIST_FILE.${NC}"
  exit 1
fi

echo "${GRN}✓ Boundary clean — no private content in public framework.${NC}"
exit 0
