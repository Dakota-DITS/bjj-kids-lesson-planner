# Demo preview rollback

The demo is a path on the existing host. Removing it does not change DNS and does not restore or edit the production database.

Run as root:

```bash
systemctl disable --now bjj-planner-demo.service
rm -f /etc/systemd/system/bjj-planner-demo.service /etc/cron.d/bjj-planner-demo
systemctl daemon-reload
rm -f /etc/nginx/snippets/bjj-demo.conf
```

Delete the include line `include /etc/nginx/snippets/bjj-demo.conf;` from the bjj nginx site, then:

```bash
nginx -t && systemctl reload nginx
```

Remove only the demo files:

```bash
rm -rf /srv/bjj-planner-demo /srv/bjj-planner-demo-www /usr/local/lib/bjj-demo
rm -rf /var/lib/bjj-planner/demo-data
rm -f /var/lib/bjj-planner/demo.db /var/lib/bjj-planner/demo.db-wal /var/lib/bjj-planner/demo.db-shm
rm -f /root/bjj-demo-credentials
userdel bjj-demo || true
setfacl -x u:bjj-demo /var/lib/bjj-planner || true
```

Leave these alone:

- `/srv/bjj-planner`
- `/var/lib/bjj-planner/data.db` and `/var/lib/bjj-planner/sheets`
- `bjj-planner.service` (do not restart it for this rollback)
- the production nginx `server` block, aside from deleting the one include line

The demo cookie is `bjj_demo_session` with `Path=/demo`. It is not the production `bjj_session` cookie. A demo service worker registered at `/demo/sw.js` can only control `/demo/`. After nginx stops serving `/demo/`, that worker no longer has pages to control.
