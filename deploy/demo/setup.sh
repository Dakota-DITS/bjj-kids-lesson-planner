#!/bin/bash
# Idempotent demo preview install. Run on the server as root after Dakota approves.
# This script does not edit production nginx and does not restart bjj-planner.
# It does not read or write /var/lib/bjj-planner/data.db.
#
# Required:
#   DEMO_STAFF_PASSWORD   10 or more characters. Never commit this.
# Optional:
#   DEMO_BRANCH           default cursor/adult-home-c3e3 (PR #27).
#                         That branch cannot serve /demo/ until it contains this
#                         prefix work. Until then set DEMO_BRANCH=cursor/demo-preview-c3e3.
#   DEMO_REPO             default: origin URL of /srv/bjj-planner
#   DEMO_STAFF_RESET_PASSWORD=1   update the demo and preview logins
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this as root." >&2
  exit 1
fi

DEMO_BRANCH="${DEMO_BRANCH:-cursor/adult-home-c3e3}"
DEMO_GIT="${DEMO_GIT:-/srv/bjj-planner-demo}"
DEMO_WWW="${DEMO_WWW:-/srv/bjj-planner-demo-www}"
DEMO_DB="${DEMO_DB:-/var/lib/bjj-planner/demo.db}"
DEMO_DATA="${DEMO_DATA:-/var/lib/bjj-planner/demo-data}"
DEMO_BASE="${DEMO_BASE:-/demo}"
TOOLS="/usr/local/lib/bjj-demo"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ "$(basename "$DEMO_DB")" == "data.db" || "$DEMO_DB" == "/var/lib/bjj-planner/data.db" ]]; then
  echo "Refusing to use the production database." >&2
  exit 1
fi
if [[ "$DEMO_GIT" == "/srv/bjj-planner" || "$DEMO_WWW" == "/srv/bjj-planner" ]]; then
  echo "Refusing to use the production checkout." >&2
  exit 1
fi
if [[ -z "${DEMO_STAFF_PASSWORD:-}" || "${#DEMO_STAFF_PASSWORD}" -lt 10 ]]; then
  echo "Set DEMO_STAFF_PASSWORD to 10 or more characters. Do not commit it." >&2
  exit 1
fi
if [[ -z "${DEMO_REPO:-}" ]]; then
  if [[ -d /srv/bjj-planner/.git ]]; then
    DEMO_REPO="$(git -C /srv/bjj-planner remote get-url origin)"
  else
    echo "Set DEMO_REPO to the git URL." >&2
    exit 1
  fi
fi

if ! id bjj-demo >/dev/null 2>&1; then
  useradd --system --home "$DEMO_DATA" --shell /usr/sbin/nologin bjj-demo
fi
if ! command -v setfacl >/dev/null 2>&1; then
  echo "Install the acl package so bjj-demo can reach demo.db without joining the bjj group." >&2
  exit 1
fi

mkdir -p "$DEMO_DATA/sheets" "$DEMO_WWW" "$TOOLS"
chown -R bjj-demo:bjj-demo "$DEMO_DATA"
chmod 750 "$DEMO_DATA"
setfacl -m u:bjj-demo:x /var/lib/bjj-planner
if [[ ! -e "$DEMO_DB" ]]; then
  install -o bjj-demo -g bjj-demo -m 600 /dev/null "$DEMO_DB"
fi
chown bjj-demo:bjj-demo "$DEMO_DB"
chmod 600 "$DEMO_DB"

if [[ ! -d "$DEMO_GIT/.git" ]]; then
  git clone --branch "$DEMO_BRANCH" "$DEMO_REPO" "$DEMO_GIT"
fi
chown -R root:root "$DEMO_GIT"
chmod -R a+rX "$DEMO_GIT"
chmod -R o-rwx "$DEMO_GIT/.git"

umask 077
cat > "$TOOLS/demo.env" << EOF
DEMO_BRANCH='$DEMO_BRANCH'
DEMO_GIT='$DEMO_GIT'
DEMO_WWW='$DEMO_WWW'
DEMO_DB='$DEMO_DB'
DEMO_BASE='$DEMO_BASE'
EOF
chmod 600 "$TOOLS/demo.env"

install -m 755 "$SCRIPT_DIR/pull.sh" "$TOOLS/pull.sh"
install -m 644 "$SCRIPT_DIR/prefix_tree.py" "$TOOLS/prefix_tree.py"

"$TOOLS/pull.sh"

reset_args=()
if [[ "${DEMO_STAFF_RESET_PASSWORD:-}" == "1" ]]; then
  reset_args+=(--reset-password)
fi
runuser -u bjj-demo -- env \
  DEMO_STAFF_PASSWORD="$DEMO_STAFF_PASSWORD" \
  BJJ_SQLITE_JOURNAL=MEMORY \
  PYTHONPATH="$DEMO_GIT" \
  python3 -m server seed-demo --db "$DEMO_DB" "${reset_args[@]}"

install -m 644 "$SOURCE_ROOT/deploy/bjj-planner-demo.service" /etc/systemd/system/bjj-planner-demo.service
systemctl daemon-reload
systemctl enable --now bjj-planner-demo.service

install -d -m 755 /etc/nginx/snippets
install -m 644 "$SOURCE_ROOT/deploy/nginx-demo.conf" /etc/nginx/snippets/bjj-demo.conf
cat > /etc/cron.d/bjj-planner-demo << 'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/15 * * * * root /usr/local/lib/bjj-demo/pull.sh
EOF
chmod 644 /etc/cron.d/bjj-planner-demo

echo
echo "Demo service is enabled. Production bjj-planner was not restarted."
echo "Nginx was not reloaded. Add this line inside the bjj server block, above location / :"
echo "    include /etc/nginx/snippets/bjj-demo.conf;"
echo "Then: nginx -t && systemctl reload nginx"
echo "Demo login user: demo (admin) and preview (teacher). Password is DEMO_STAFF_PASSWORD."
echo "Open https://bjj.bettrbook.com/demo/"
