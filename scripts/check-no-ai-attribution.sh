#!/usr/bin/env bash
#
# Rejects AI attribution in commit messages.
#
# Every commit in this repository must read as the owner's own work. The rule is enforced
# in two places that share this script:
#   1. .githooks/commit-msg   blocks the commit before it exists (needs core.hooksPath).
#   2. CI job "guards"        blocks the push, and cannot be skipped on a fresh clone.
#
# Usage:
#   check-no-ai-attribution.sh --file <commit-msg-file>   hook mode
#   check-no-ai-attribution.sh --range <base> <head>      CI mode
#   check-no-ai-attribution.sh                            checks HEAD

set -uo pipefail

# Patterns are specific on purpose. A message that discusses a Claude API integration, or
# a plain word that happens to contain "ai", must still pass.
TOOLS='claude|anthropic|copilot|chatgpt|openai|gemini|cursor|codeium|aider|windsurf'
PATTERNS=(
  "co-?authored-?by[[:space:]]*:.*(${TOOLS})"
  "assisted-?by[[:space:]]*:.*(${TOOLS})"
  "generated[[:space:]]+(with|by)[[:space:]].{0,40}(${TOOLS})"
  'noreply@anthropic\.com'
  'claude\.ai/code'
  'claude\.com/claude-code'
)

# Built from bytes so this file never contains the emoji it hunts for.
ROBOT_EMOJI=$(printf '\xf0\x9f\xa4\x96')

fail() {
  echo ""
  echo "  REJECTED: commit message carries AI attribution."
  echo ""
  echo "  Source : $1"
  echo "  Match  : $2"
  echo ""
  echo "  Remove the line and commit again. In CI the history must be rewritten"
  echo "  (git commit --amend or git rebase) because a commit message is immutable."
  echo ""
  exit 1
}

check_text() {
  local text="$1" source="$2" pattern hit
  # Git drops comment lines and the verbose diff from the final message.
  text=$(printf '%s\n' "$text" | sed -e '/^#/d' -e '/^diff --git /,$d')
  for pattern in "${PATTERNS[@]}"; do
    hit=$(printf '%s\n' "$text" | grep -inE "$pattern" | head -3)
    [ -n "$hit" ] && fail "$source" "$hit"
  done
  hit=$(printf '%s\n' "$text" | grep -nF "$ROBOT_EMOJI" | head -3)
  [ -n "$hit" ] && fail "$source" "robot emoji: $hit"
  return 0
}

mode="${1:---head}"
case "$mode" in
  --file)
    check_text "$(cat "${2:?--file needs a path}")" "commit message file"
    ;;
  --range)
    base="${2:?--range needs a base sha}"
    head="${3:?--range needs a head sha}"
    # First push of a branch sends an all-zero base, and a force push can drop the base.
    # Fall back to every commit reachable from head that is not on the default branch,
    # or to head alone when nothing else is known.
    if [ "$base" = "0000000000000000000000000000000000000000" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
      if git rev-parse --verify -q origin/main >/dev/null && [ "$(git rev-parse origin/main)" != "$(git rev-parse "$head")" ]; then
        range="origin/main..$head"
      else
        range="$head"
        [ "$(git rev-list --count "$head")" -le 50 ] || range="$head~1..$head"
      fi
    else
      range="$base..$head"
    fi
    count=0
    while read -r sha; do
      [ -z "$sha" ] && continue
      check_text "$(git log -1 --format=%B "$sha")" "commit $sha ($(git log -1 --format=%s "$sha"))"
      count=$((count + 1))
    done < <(git rev-list "$range")
    echo "OK: $count commit(s) free of AI attribution ($range)."
    ;;
  --head | *)
    check_text "$(git log -1 --format=%B)" "commit HEAD"
    echo "OK: HEAD is free of AI attribution."
    ;;
esac
