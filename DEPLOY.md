# Deploy Grace BJJ Kids

The public site is static files. Attendance, the roster, and progress live in SQLite behind a small Python service. The lesson planner itself stays in each teacher's browser (`localStorage`) after they log in.

Production host: Debian 12 LXC, nginx 1.22, Cloudflare tunnel at `https://bjj.bettrbook.com`. The repo is cloned to `/srv/bjj-planner`. A cron job runs `git pull --ff-only` every 15 minutes.

## Routes

| Path | Who | What |
| --- | --- | --- |
| `/` | Public | Welcome splash |
| `/coloring/` | Public | Parent coloring sheets |
| `/login/` | Public | Teacher login form |
| `/app/` | Teacher or admin | Planner, roster, attendance, QR cards |
| `/api/public/featured` | Public | `{ "sheetId", "caption" }` only |
| `/api/public/sheets` | Public | Published sheet title, caption, and theme |
| `/api/` | Teacher or admin | Roster, attendance, progress |

nginx `auth_request` protects `/app/`, `/js/`, `/css/styles.css`, and `/vendor/`. A missing session is redirected to `/login/`. The login page stays public so that redirect cannot loop.

## What is stored where

- **This browser, after login:** library edits, pinned drills, rep counts, timeline settings, and the current plan. Export library downloads that. It does not include the roster.
- **Server, shared:** students, belts and stripes, class attendance, technique levels, notes, stripe-hint thresholds, the featured parent sheet, and coloring sheets an admin publishes. The database is `/var/lib/bjj-planner/data.db`. Published images are files in `/var/lib/bjj-planner/sheets/`. Neither path is inside the nginx root.

There is no public sign-up. An admin creates teacher logins.

## Install

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-bcrypt nginx git sqlite3

sudo useradd --system --home /var/lib/bjj-planner --shell /usr/sbin/nologin bjj || true
sudo mkdir -p /var/lib/bjj-planner/sheets /srv
sudo chown -R bjj:bjj /var/lib/bjj-planner
sudo chmod 750 /var/lib/bjj-planner

sudo git clone <this-repo> /srv/bjj-planner
sudo chown -R bjj:bjj /srv/bjj-planner

cd /srv/bjj-planner
sudo -u bjj python3 -m server create-admin --username dakota
```

The password prompt asks twice. Use at least 10 characters. Add another login later with:

```bash
sudo -u bjj python3 -m server create-user --username alex --role teacher
```

`--role` is `admin` or `teacher`.

## Service

```bash
sudo cp /srv/bjj-planner/deploy/bjj-planner.service /etc/systemd/system/bjj-planner.service
sudo systemctl daemon-reload
sudo systemctl enable --now bjj-planner
```

The unit listens on `127.0.0.1:8766` only. Cookies are `Secure` because Cloudflare terminates HTTPS. Do not point a browser at port 8766 directly.

```bash
sudo cp /srv/bjj-planner/deploy/nginx-bjj.conf /etc/nginx/sites-available/bjj
sudo ln -sf /etc/nginx/sites-available/bjj /etc/nginx/sites-enabled/bjj
sudo nginx -t && sudo systemctl reload nginx
```

Keep the existing Cloudflare tunnel pointed at this nginx.

## Updates

`git pull --ff-only` refreshes the splash, coloring page, and staff JavaScript immediately, because nginx reads those files from `/srv/bjj-planner`.

If the pull changes anything under `server/`, restart the API:

```bash
cd /srv/bjj-planner && sudo -u bjj git pull --ff-only
sudo systemctl restart bjj-planner
```

A cron pull does not restart the service. After a server change, restart it once by hand.

## Backup

```bash
sudo -u bjj sqlite3 /var/lib/bjj-planner/data.db ".backup '/var/lib/bjj-planner/data-backup.db'"
sudo cp -a /var/lib/bjj-planner/sheets /var/lib/bjj-planner/sheets-backup
```

Copy those two artifacts off the box. Do not commit them. nginx denies `*.db` even if one is copied into the web root.

## Demo preview

A separate draft serves `https://bjj.bettrbook.com/demo/` from its own checkout, database, and API. Production stays on `/srv/bjj-planner` and `/var/lib/bjj-planner/data.db`. The install, nginx include, and rollback notes are in `deploy/demo/setup.sh`, `deploy/nginx-demo.conf`, and `deploy/demo/ROLLBACK.md`. Do not point the demo service at `data.db`. Demo logins are `dakota` and `pierre`, both admins in `demo.db` only. Passwords come from `DEMO_PASSWORD_DAKOTA` and `DEMO_PASSWORD_PIERRE`, or are generated into `/root/bjj-demo-credentials`. They are not committed.

## Local check

```bash
python3 -m server create-admin --username dakota --password 'test-password' --db /tmp/bjj-dev.db
python3 -m server serve --static . --db /tmp/bjj-dev.db --insecure-cookie --port 8765
```

`--insecure-cookie` is only for `http://127.0.0.1`. Production leaves `BJJ_COOKIE_SECURE=1`.

The combined process does not hide `/js/` the way nginx does. The page still refuses to draw the planner until `/api/bootstrap` succeeds, and the API refuses student data without a session.
