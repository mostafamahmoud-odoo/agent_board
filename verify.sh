#!/usr/bin/env bash
# Everything, with real exit codes.
#
# This exists because a previous check piped vitest into grep and reported
# PASS while 7 tests were failing. Never infer a result from output text.
set -u
cd "$(dirname "$0")"
FAILED=0
run() {
  local label="$1"; shift
  if "$@" >/tmp/cnp-verify.log 2>&1; then
    echo "  PASS  $label"
  else
    echo "  FAIL  $label"; tail -12 /tmp/cnp-verify.log; FAILED=1
  fi
}
run "check-types" npm run check-types
run "lint"        npm run lint
run "unit"        npx vitest run
run "compile"     npm run compile-tests
run "integration" timeout 900 npx vscode-test
run "real mouse"  timeout 400 node tools/browser/real-mouse.mjs
run "mermaid"     timeout 400 node tools/browser/probe.mjs
run "package"     npx --yes @vscode/vsce@4 package --no-dependencies -o /tmp/claude-notes-panel.vsix
echo "----"
if [ "$FAILED" = 1 ]; then echo "VERIFICATION FAILED"; exit 1; fi
echo "all green"
