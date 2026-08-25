#!/usr/bin/env bash
# evals/run.sh — run the full eval suite.
#
# Each case is run against a disposable git worktree so eval runs never dirty
# the working tree. The copilot CLI is invoked with the case prompt, then
# check.sh evaluates the deterministic checks.
#
# Exit codes:
#   0  — pass rate meets threshold
#   1  — pass rate below threshold
#   2  — copilot CLI unavailable or unauthenticated (skip, not a failure)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EVALS_DIR="$REPO_ROOT/evals"
CASES_DIR="$EVALS_DIR/cases"
THRESHOLD_FILE="$EVALS_DIR/threshold.json"
CHECK_SH="$EVALS_DIR/check.sh"
LOG_ROOT="${EVAL_LOG_DIR:-$REPO_ROOT/.eval-logs}"

# ---------------------------------------------------------------------------
# Detect copilot CLI
# ---------------------------------------------------------------------------
if ! command -v copilot &> /dev/null; then
  echo ""
  echo "⚠️  copilot CLI not found in PATH."
  echo "   Install with: npm install -g @github/copilot"
  echo "   Eval suite skipped — exit code 2."
  echo ""
  exit 2
fi

# Quick auth check — copilot exits non-zero when unauthenticated
if ! copilot auth status &>/dev/null 2>&1; then
  echo ""
  echo "⚠️  copilot CLI is not authenticated."
  echo "   Run: copilot auth login"
  echo "   Eval suite skipped — exit code 2."
  echo ""
  exit 2
fi

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
MIN_PASS_RATE=$(jq -r '.minPassRate' "$THRESHOLD_FILE")
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
LOG_DIR="$LOG_ROOT/$TIMESTAMP"
mkdir -p "$LOG_DIR"

echo ""
echo "════════════════════════════════════════════════════"
echo " CHOMP Eval Suite"
echo " $(date)"
echo " Log dir: $LOG_DIR"
echo "════════════════════════════════════════════════════"
echo ""

CASE_FILES=("$CASES_DIR"/*.json)
TOTAL_CASES=${#CASE_FILES[@]}
PASSED_CASES=0
FAILED_CASES=0

declare -a RESULTS=()

# ---------------------------------------------------------------------------
# Run each case
# ---------------------------------------------------------------------------
for CASE_FILE in "${CASE_FILES[@]}"; do
  CASE_ID=$(jq -r '.id' "$CASE_FILE")
  PROMPT=$(jq -r '.prompt' "$CASE_FILE")
  RATIONALE=$(jq -r '.rationale' "$CASE_FILE")

  echo "────────────────────────────────────────────────────"
  echo "Case: $CASE_ID"
  echo "────────────────────────────────────────────────────"
  echo "Rationale: $RATIONALE"
  echo ""

  CASE_LOG_DIR="$LOG_DIR/$CASE_ID"
  mkdir -p "$CASE_LOG_DIR"

  # Create a disposable worktree for this eval run
  WORKTREE_DIR="$CASE_LOG_DIR/worktree"
  WORKTREE_BRANCH="eval/$CASE_ID-$TIMESTAMP"

  echo "  Creating worktree: $WORKTREE_DIR"
  git -C "$REPO_ROOT" worktree add --detach "$WORKTREE_DIR" HEAD \
    > "$CASE_LOG_DIR/worktree.log" 2>&1

  # Run the copilot agent with the case prompt in the worktree
  echo "  Running agent..."
  AGENT_LOG="$CASE_LOG_DIR/agent.log"
  if copilot -p "$PROMPT" \
       --allow-all-tools \
       --log-dir "$CASE_LOG_DIR" \
       --cwd "$WORKTREE_DIR" \
       > "$AGENT_LOG" 2>&1; then
    echo "  Agent completed."
  else
    echo "  Agent exited non-zero — proceeding to checks anyway."
  fi

  # Run deterministic checks
  echo "  Running checks..."
  CHECK_LOG="$CASE_LOG_DIR/checks.log"
  if "$CHECK_SH" "$CASE_FILE" "$WORKTREE_DIR" 2>&1 | tee "$CHECK_LOG"; then
    echo "  ✓ PASS: $CASE_ID"
    PASSED_CASES=$((PASSED_CASES + 1))
    RESULTS+=("PASS  $CASE_ID")
  else
    echo "  ✗ FAIL: $CASE_ID (see $CHECK_LOG)"
    FAILED_CASES=$((FAILED_CASES + 1))
    RESULTS+=("FAIL  $CASE_ID")
  fi

  # Remove the worktree
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" \
    > /dev/null 2>&1 || true

  echo ""
done

# ---------------------------------------------------------------------------
# Pass-rate gate
# ---------------------------------------------------------------------------
echo "════════════════════════════════════════════════════"
echo " Results"
echo "════════════════════════════════════════════════════"
echo ""
for R in "${RESULTS[@]}"; do
  echo "  $R"
done
echo ""

PASS_RATE=$(echo "scale=4; $PASSED_CASES / $TOTAL_CASES" | bc)
PASS_RATE_PCT=$(echo "scale=1; $PASSED_CASES * 100 / $TOTAL_CASES" | bc)

echo "  Passed: $PASSED_CASES / $TOTAL_CASES  (${PASS_RATE_PCT}%)"
echo "  Threshold: $(echo "scale=0; $MIN_PASS_RATE * 100 / 1" | bc)%"
echo "  Logs: $LOG_DIR"
echo ""

# Write a machine-readable summary for $GITHUB_STEP_SUMMARY
SUMMARY_FILE="$LOG_DIR/summary.md"
{
  echo "## Eval Suite Results — $(date)"
  echo ""
  echo "| Result | Case |"
  echo "|--------|------|"
  for R in "${RESULTS[@]}"; do
    STATUS="${R%% *}"
    ID="${R#* }"
    ICON="✅"
    [ "$STATUS" = "FAIL" ] && ICON="❌"
    echo "| $ICON $STATUS | $ID |"
  done
  echo ""
  echo "**Pass rate:** ${PASS_RATE_PCT}% ($PASSED_CASES / $TOTAL_CASES) — threshold $(echo "scale=0; $MIN_PASS_RATE * 100 / 1" | bc)%"
} > "$SUMMARY_FILE"

# Append to GitHub step summary if running in Actions
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  cat "$SUMMARY_FILE" >> "$GITHUB_STEP_SUMMARY"
fi

# Gate on threshold
MEETS_THRESHOLD=$(echo "$PASS_RATE >= $MIN_PASS_RATE" | bc)
if [ "$MEETS_THRESHOLD" -eq 1 ]; then
  echo "  ✓ Pass rate meets threshold. Eval suite PASSED."
  exit 0
else
  echo "  ✗ Pass rate below threshold. Eval suite FAILED."
  exit 1
fi
