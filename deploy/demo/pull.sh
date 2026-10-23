#!/bin/bash
# Refresh the demo checkout and the published /demo/ tree.
# Does not pull production, restart bjj-planner, or open data.db.
set -euo pipefail

ENV_FILE="${BJJ_DEMO_ENV:-/usr/local/lib/bjj-demo/demo.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Run deploy/demo/setup.sh first." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${DEMO_BRANCH:?}"
: "${DEMO_GIT:?}"
: "${DEMO_WWW:?}"
: "${DEMO_BASE:?}"

if [[ "$DEMO_GIT" == "/srv/bjj-planner" || "$DEMO_WWW" == "/srv/bjj-planner" ]]; then
  echo "Refusing to update the production checkout." >&2
  exit 1
fi
if [[ "$(basename "${DEMO_DB:-demo.db}")" == "data.db" ]]; then
  echo "Refusing to use data.db." >&2
  exit 1
fi

old="$(git -C "$DEMO_GIT" rev-parse HEAD)"
git -C "$DEMO_GIT" fetch origin "$DEMO_BRANCH"
git -C "$DEMO_GIT" checkout "$DEMO_BRANCH"
git -C "$DEMO_GIT" pull --ff-only origin "$DEMO_BRANCH"
new="$(git -C "$DEMO_GIT" rev-parse HEAD)"

if ! grep -q "BJJ_BASE_AWARE" "$DEMO_GIT/bjj-base.js"; then
  echo "Branch $DEMO_BRANCH has no /demo/ prefix support. Published files were left unchanged." >&2
  echo "Set DEMO_BRANCH=cursor/demo-preview-c3e3 until cursor/adult-home-c3e3 contains that work." >&2
  exit 1
fi
if ! grep -q "BJJ_COOKIE_NAME" "$DEMO_GIT/server/httpapp.py"; then
  echo "Branch $DEMO_BRANCH still uses the production session cookie. Published files were left unchanged." >&2
  exit 1
fi

python3 "$DEMO_GIT/deploy/demo/prefix_tree.py" "$DEMO_GIT" "$DEMO_WWW" --base "$DEMO_BASE"
chmod -R a+rX "$DEMO_WWW"

if [[ "$old" != "$new" ]] && git -C "$DEMO_GIT" diff --name-only "$old" "$new" | grep -q '^server/'; then
  systemctl restart bjj-planner-demo.service
fi
