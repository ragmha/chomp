#!/usr/bin/env bash
#
# Reset the repo to a known state between demo runs, or pre-flight check it.
#
#   ./demo/reset.sh --check    verify everything the runbook depends on
#   ./demo/reset.sh            restore main, clear demo branches, re-arm gates
#
# Safe to run repeatedly. Never touches anything outside this repo.

set -euo pipefail

REPO="ragmha/chomp"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

green() { printf '\033[32m✓\033[0m %s\n' "$1"; }
red()   { printf '\033[31m✗\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m!\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

FAILURES=0
check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then green "$label"; else red "$label"; FAILURES=$((FAILURES + 1)); fi
}

# --- pre-flight -------------------------------------------------------------

if [[ "${1:-}" == "--check" ]]; then
  head_ "Tooling"
  check "gh installed"            command -v gh
  check "gh authenticated"        gh auth status
  check "node >= 22"              bash -c '[ "$(node -p "process.versions.node.split(\".\")[0]")" -ge 22 ]'
  check "dependencies installed"  test -d node_modules
  check "watchtower installed"    test -d tools/watchtower/node_modules

  head_ "Repo state"
  check "on main"                 bash -c '[ "$(git rev-parse --abbrev-ref HEAD)" = main ]'
  check "working tree clean"      bash -c '[ -z "$(git status --porcelain)" ]'
  check "up to date with origin"  bash -c 'git fetch -q origin main && [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]'

  head_ "The artifact chain"
  for f in intent/0001-chomp.md spec/0001-chomp.md plan/0001-chomp.md; do
    check "$f present" test -f "$f"
  done
  check "chain is in order" bash -c '
    i=$(git log --diff-filter=A --format=%ct -1 -- intent/0001-chomp.md)
    s=$(git log --diff-filter=A --format=%ct -1 -- spec/0001-chomp.md)
    p=$(git log --diff-filter=A --format=%ct -1 -- plan/0001-chomp.md)
    c=$(git log --diff-filter=A --format=%ct -1 -- src/engine/state.ts)
    [ "$i" -le "$s" ] && [ "$s" -le "$p" ] && [ "$p" -le "$c" ]'

  head_ "The build"
  check "typecheck"  npm run typecheck
  check "lint"       npm run lint
  check "unit tests" npm run test:unit

  head_ "Platform features (beats 5 and 6)"
  check "push protection on" bash -c "
    gh api repos/$REPO --jq '.security_and_analysis.secret_scanning_push_protection.status' \
    | grep -q enabled"
  check "production gate armed" bash -c "
    gh api repos/$REPO/environments/production --jq '[.protection_rules[].type]' \
    | grep -q required_reviewers"
  check "Pages live" bash -c "curl -sfI https://ragmha.github.io/chomp/ | head -1 | grep -qE '200|30[12]'"
  check "CodeQL workflow present" test -f .github/workflows/codeql.yml

  head_ "Demo material"
  check "runbook present"       test -f demo/RUNBOOK.md
  check "vuln branch on origin" bash -c "git ls-remote --exit-code --heads origin demo/vuln-xss"

  echo
  if [ "$FAILURES" -eq 0 ]; then
    green "Ready to present."
  else
    red "$FAILURES check(s) failed — fix before presenting."
    exit 1
  fi
  exit 0
fi

# --- reset ------------------------------------------------------------------

head_ "Resetting"

if [ -n "$(git status --porcelain)" ]; then
  warn "Working tree is dirty. Stashing."
  git stash push -u -m "demo-reset-$(date +%s)" >/dev/null
fi

git checkout -q main
git fetch -q origin main
git reset -q --hard origin/main
green "main restored to origin"

# Local demo branches only. Never delete anything on the remote — the
# pre-baked demo/vuln-xss branch and its PR have to survive.
for branch in $(git branch --format='%(refname:short)' | grep -E '^demo/(secret|scratch)' || true); do
  git branch -D "$branch" >/dev/null 2>&1 && green "deleted local $branch"
done

rm -rf .watchtower playwright-report test-results
green "cleared run artefacts"

if gh pr view demo/vuln-xss --repo "$REPO" --json state --jq .state 2>/dev/null | grep -q CLOSED; then
  gh pr reopen demo/vuln-xss --repo "$REPO" >/dev/null && green "reopened the XSS demo PR"
fi

echo
green "Reset complete. Run './demo/reset.sh --check' before presenting."
