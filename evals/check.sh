#!/usr/bin/env bash
# evals/check.sh — evaluate a single eval case's checks against a working directory.
# Usage: ./evals/check.sh <case-file.json> <working-dir>
# Exit 0: all checks passed. Exit 1: one or more checks failed.
#
# Keep check logic here so run.sh stays orchestration only.

set -euo pipefail

CASE_FILE="${1:-}"
WORK_DIR="${2:-}"

if [ -z "$CASE_FILE" ] || [ -z "$WORK_DIR" ]; then
  echo "Usage: $0 <case-file.json> <working-dir>" >&2
  exit 1
fi

if [ ! -f "$CASE_FILE" ]; then
  echo "Error: case file not found: $CASE_FILE" >&2
  exit 1
fi

if [ ! -d "$WORK_DIR" ]; then
  echo "Error: working directory not found: $WORK_DIR" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Parse the case
# ---------------------------------------------------------------------------
CASE_ID=$(jq -r '.id' "$CASE_FILE")
NUM_CHECKS=$(jq '.checks | length' "$CASE_FILE")

echo "  Case: $CASE_ID"
echo "  Checks: $NUM_CHECKS"
echo ""

FAILED=0
PASSED=0

# ---------------------------------------------------------------------------
# Evaluate each check
# ---------------------------------------------------------------------------
for i in $(seq 0 $((NUM_CHECKS - 1))); do
  CHECK_TYPE=$(jq -r ".checks[$i].type" "$CASE_FILE")
  CHECK_DESC=$(jq -r ".checks[$i].description" "$CASE_FILE")

  case "$CHECK_TYPE" in

    command)
      CMD=$(jq -r ".checks[$i].run" "$CASE_FILE")
      printf "    [command] %s\n" "$CHECK_DESC"
      printf "              run: %s\n" "$CMD"
      if (cd "$WORK_DIR" && eval "$CMD" > /dev/null 2>&1); then
        echo "              ✓ PASS"
        PASSED=$((PASSED + 1))
      else
        echo "              ✗ FAIL"
        # Re-run to capture output for the summary
        (cd "$WORK_DIR" && eval "$CMD" 2>&1 | sed 's/^/              | /') || true
        FAILED=$((FAILED + 1))
      fi
      ;;

    file_absent_pattern)
      GLOB=$(jq -r ".checks[$i].glob" "$CASE_FILE")
      PATTERN=$(jq -r ".checks[$i].pattern" "$CASE_FILE")
      printf "    [file_absent_pattern] %s\n" "$CHECK_DESC"
      printf "              glob: %s  pattern: %s\n" "$GLOB" "$PATTERN"
      # Use find + grep; exit 1 from grep means no match (good here)
      MATCHES=$(cd "$WORK_DIR" && find . -path "./$GLOB" -type f 2>/dev/null | \
        xargs grep -PlE "$PATTERN" 2>/dev/null || true)
      if [ -z "$MATCHES" ]; then
        echo "              ✓ PASS (pattern absent)"
        PASSED=$((PASSED + 1))
      else
        echo "              ✗ FAIL (pattern found in):"
        echo "$MATCHES" | sed "s|^\./||" | sed 's/^/              | /'
        FAILED=$((FAILED + 1))
      fi
      ;;

    file_present_pattern)
      GLOB=$(jq -r ".checks[$i].glob" "$CASE_FILE")
      PATTERN=$(jq -r ".checks[$i].pattern" "$CASE_FILE")
      printf "    [file_present_pattern] %s\n" "$CHECK_DESC"
      printf "              glob: %s  pattern: %s\n" "$GLOB" "$PATTERN"
      MATCHES=$(cd "$WORK_DIR" && find . -path "./$GLOB" -type f 2>/dev/null | \
        xargs grep -PlE "$PATTERN" 2>/dev/null || true)
      if [ -n "$MATCHES" ]; then
        echo "              ✓ PASS (pattern found in):"
        echo "$MATCHES" | sed "s|^\./||" | sed 's/^/              | /'
        PASSED=$((PASSED + 1))
      else
        echo "              ✗ FAIL (pattern not found in any file matching $GLOB)"
        FAILED=$((FAILED + 1))
      fi
      ;;

    file_exists)
      PATH_VAL=$(jq -r ".checks[$i].path" "$CASE_FILE")
      printf "    [file_exists] %s\n" "$CHECK_DESC"
      printf "              path: %s\n" "$PATH_VAL"
      if [ -e "$WORK_DIR/$PATH_VAL" ]; then
        echo "              ✓ PASS"
        PASSED=$((PASSED + 1))
      else
        echo "              ✗ FAIL (not found: $WORK_DIR/$PATH_VAL)"
        FAILED=$((FAILED + 1))
      fi
      ;;

    *)
      echo "    [unknown] type '$CHECK_TYPE' — skipping (not a failure)" >&2
      ;;
  esac
  echo ""
done

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
TOTAL=$((PASSED + FAILED))
echo "  ─────────────────────────────────────────"
echo "  $PASSED/$TOTAL checks passed for $CASE_ID"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0
