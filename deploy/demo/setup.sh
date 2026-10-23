#!/bin/bash
# Idempotent demo preview install. Run on the server as root after Dakota approves.
# This script does not edit production nginx and does not restart bjj-planner.
# It does not read or write /var/lib/bjj-planner/data.db.
#
# Optional:
#   DEMO_BRANCH           default cursor/adult-home-c3e3 (PR #27).
#                         That branch cannot serve /demo/ until it contains this
#                         prefix work. Until then set DEMO_BRANCH=cursor/demo-preview-c3e3.
#   DEMO_REPO             default: origin URL of /srv/bjj-planner
#   DEMO_PASSWORD_DAKOTA  admin login dakota. If unset, a random value is generated.
#   DEMO_PASSWORD_PIERRE  admin login pierre. If unset, a random value is generated.
# Passwords are written only to /root/bjj-demo-credentials (mode 600). They are
# not printed, not logged, and not stored in the systemd unit or demo.env.
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
CREDENTIALS="/root/bjj-demo-credentials"

read_saved_password() {
  local user="$1"
  [[ -f "$CREDENTIALS" ]] || return 0
  python3 - "$CREDENTIALS" "$user" << 'PY'
import sys
path, user = sys.argv[1], sys.argv[2]
try:
    lines = open(path, encoding="utf-8").read().splitlines()
except OSError:
    raise SystemExit(0)
for line in lines:
    if line.startswith(user + "="):
        sys.stdout.write(line.split("=", 1)[1])
        break
PY
}

resolve_password() {
  local var_name="$1"
  local user="$2"
  local value="${!var_name-}"
  if [[ -n "$value" ]]; then
    if [[ "${#value}" -lt 10 || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
      echo "A demo password must be at least 10 characters on one line." >&2
      exit 1
    fi
    return 0
  fi
  local saved
  saved="$(read_saved_password "$user")"
  if [[ -n "$saved" && "${#saved}" -ge 10 ]]; then
    printf -v "$var_name" '%s' "$saved"
    return 0
  fi
  local generated
  generated="$(python3 -c 'import secrets; print(secrets.token_urlsafe(24), end="")')"
  printf -v "$var_name" '%s' "$generated"
}

resolve_password DEMO_PASSWORD_DAKOTA dakota
resolve_password DEMO_PASSWORD_PIERRE pierre
export DEMO_PASSWORD_DAKOTA DEMO_PASSWORD_PIERRE
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

umask 077
python3 - "$CREDENTIALS" << 'PY'
import os, sys, tempfile
path = sys.argv[1]
dakota = os.environ["DEMO_PASSWORD_DAKOTA"]
pierre = os.environ["DEMO_PASSWORD_PIERRE"]
directory = os.path.dirname(path) or "/root"
fd, tmp = tempfile.mkstemp(prefix=".bjj-demo-credentials.", dir=directory)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("# Demo logins for demo.db only. Not the production database.\n")
        handle.write("dakota=" + dakota + "\n")
        handle.write("pierre=" + pierre + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)
    os.chmod(path, 0o600)
except Exception:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
PY
runuser -u bjj-demo -- env \
  DEMO_PASSWORD_DAKOTA="$DEMO_PASSWORD_DAKOTA" \
  DEMO_PASSWORD_PIERRE="$DEMO_PASSWORD_PIERRE" \
  BJJ_SQLITE_JOURNAL=MEMORY \
  PYTHONPATH="$DEMO_GIT" \
  python3 -m server seed-demo --db "$DEMO_DB"

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
echo "Demo admin logins are dakota and pierre, only in demo.db."
echo "Passwords are in /root/bjj-demo-credentials (mode 600). They were not printed."
echo "Open https://bjj.bettrbook.com/demo/"
