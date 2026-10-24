# Deploy Grace BJJ Kids

The public site is static files. Attendance, the roster, and progress live in SQLite behind a small Python service. The lesson planner itself stays in each teacher's browser (`localStorage`) after they log in.

Production host: Debian 12 LXC, nginx 1.22, Cloudflare tunnel at `https://bjj.bettrbook.com`. The repo is cloned to `/srv/bjj-planner` and that checkout stays owned by root. A root cron runs `git pull --ff-only` there every 15 minutes and leaves the API process running. See [Updates](#updates).

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

cd /srv/bjj-planner
sudo -u bjj python3 -m server create-admin --username dakota
```

Leave `/srv/bjj-planner` owned by root. Root is the user that cloned it and the user that pulls it. The `bjj` service account reads the tree and writes only under `/var/lib/bjj-planner`, which stays owned by `bjj`. If an older install already ran `chown` of the checkout to `bjj`, return it with `sudo chown -R root:root /srv/bjj-planner` and leave the database directory owned by `bjj`. A checkout owned by `bjj` makes the root pull fail Git's ownership check.

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

Pull the production checkout as root. That is the user that owns `/srv/bjj-planner`, the user earlier deploys used, and the user on the only cron this repo installs (`root` in `deploy/demo/setup.sh`). `sudo -u bjj git pull --ff-only` stops with `detected dubious ownership in repository at /srv/bjj-planner` when the checkout belongs to root.

```bash
cd /srv/bjj-planner && sudo git pull --ff-only
sudo systemctl restart bjj-planner
```

Restart when the pull changes anything under `server/`, and whenever the release needs a database migration. The API calls `migrate()` only when the `bjj-planner` process starts.

nginx reads the splash, coloring page, and staff JavaScript from `/srv/bjj-planner` as soon as the files are on disk. The production cron runs `git pull --ff-only` in that directory every 15 minutes and does not restart `bjj-planner`. A merge can therefore put new static pages on disk, and nginx can serve them, while the previous API process is still running. A release that only changes those static files is live at that point. A release that needs a migration (new columns, new endpoints, or rewritten rows) is not finished until the restart: the new pages can call an API that still has the old schema. Pull by hand and restart in the same step. If the cron already fast-forwarded, the pull reports already up to date and the restart is still what runs the migration.

The cron file in this repo is the demo job. `deploy/demo/setup.sh` writes `/etc/cron.d/bjj-planner-demo` as `*/15 * * * * root /usr/local/lib/bjj-demo/pull.sh`. That script fast-forwards the demo checkout, republishes `/demo/`, and restarts `bjj-planner-demo` when `server/` changed. It refuses `/srv/bjj-planner` and leaves the production API running. Production's 15-minute `git pull --ff-only` is a separate root pull of `/srv/bjj-planner`. Its crontab lives on the host and is not a file in this repo. It does not restart `bjj-planner`.

An operator who wants a different Unix user to run git in the production checkout can mark the directory safe once:

```bash
sudo git config --system --add safe.directory /srv/bjj-planner
```

The root pull above works without that setting.

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
