"""CLI for the Grace BJJ Kids attendance service.

Examples:
  python -m server create-admin --username dakota
  python -m server serve
"""

import argparse
import getpass
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from server.db import connect, iso, migrate, new_id, utcnow
from server.httpapp import USER_RE, Api, config_from_env, hash_password


def cmd_create_user(args):
    username = args.username.strip()
    if not USER_RE.match(username):
        print("Usernames are 3–32 letters, numbers, dots, or dashes.", file=sys.stderr)
        return 1
    password = args.password or os.environ.get("BJJ_PASSWORD") or ""
    if not password:
        password = getpass.getpass("Password (10 or more characters): ")
        again = getpass.getpass("Repeat password: ")
        if password != again:
            print("The passwords did not match.", file=sys.stderr)
            return 1
    if len(password) < 10:
        print("Use at least 10 characters.", file=sys.stderr)
        return 1
    cfg = config_from_env()
    if args.db:
        cfg["db_path"] = args.db
        cfg["data_dir"] = os.path.dirname(args.db) or "."
        cfg["sheets_dir"] = os.path.join(cfg["data_dir"], "sheets")
    os.makedirs(cfg["sheets_dir"], exist_ok=True)
    conn = connect(cfg["db_path"])
    migrate(conn)
    if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
        print("That username is already in use.", file=sys.stderr)
        conn.close()
        return 1
    if args.role == "admin" and args.first:
        pass
    conn.execute(
        "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
        (new_id("u-"), username, hash_password(password), args.role, iso(utcnow())),
    )
    conn.commit()
    conn.close()
    print(f"Created {args.role} login {username}.")
    return 0


def cmd_seed_demo(args):
    from server.demoseed import DemoSeedError, seed_demo

    password = os.environ.get("DEMO_STAFF_PASSWORD", "")
    db_path = args.db or os.environ.get("BJJ_DB") or ""
    try:
        real = seed_demo(db_path, password, reset_password=args.reset_password)
    except DemoSeedError as err:
        print(str(err), file=sys.stderr)
        return 1
    print(f"Demo data is in {real}. Production data.db was not opened.")
    return 0


def cmd_serve(args):
    cfg = config_from_env()
    if args.db:
        cfg["db_path"] = args.db
        cfg["data_dir"] = os.path.dirname(os.path.abspath(args.db)) or "."
        cfg["sheets_dir"] = os.path.join(cfg["data_dir"], "sheets")
    if args.static:
        cfg["static_root"] = os.path.abspath(args.static)
    if args.insecure_cookie:
        cfg["secure"] = False
    api = Api(cfg)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_GET(self):
            api.handle(self)

        def do_HEAD(self):
            api.handle(self)

        def do_POST(self):
            api.handle(self)

        def do_PUT(self):
            api.handle(self)

        def do_PATCH(self):
            api.handle(self)

        def do_DELETE(self):
            api.handle(self)

        def log_message(self, fmt, *log_args):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % log_args))

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Attendance API on http://{args.host}:{args.port}  db={cfg['db_path']}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m server")
    sub = parser.add_subparsers(dest="cmd", required=True)

    admin = sub.add_parser("create-admin", help="Create the first admin login. There is no public sign-up.")
    admin.add_argument("--username", required=True)
    admin.add_argument("--password", help="Prefer a prompt or the BJJ_PASSWORD environment variable.")
    admin.add_argument("--db", help="SQLite file. Defaults to $BJJ_DB or $BJJ_DATA_DIR/data.db.")
    admin.set_defaults(role="admin", first=True, func=cmd_create_user)

    teacher = sub.add_parser("create-user", help="Create another admin or teacher login.")
    teacher.add_argument("--username", required=True)
    teacher.add_argument("--role", choices=("admin", "teacher"), default="teacher")
    teacher.add_argument("--password")
    teacher.add_argument("--db")
    teacher.set_defaults(first=False, func=cmd_create_user)

    demo = sub.add_parser("seed-demo", help="Fill a separate demo.db with fake example rows. Refuses data.db.")
    demo.add_argument("--db", help="Demo SQLite file. Must be named demo.db. Defaults to $BJJ_DB.")
    demo.add_argument(
        "--reset-password",
        action="store_true",
        help="Update the demo and preview logins from DEMO_STAFF_PASSWORD.",
    )
    demo.set_defaults(func=cmd_seed_demo)

    serve = sub.add_parser("serve", help="Run the API.")
    serve.add_argument("--host", default=os.environ.get("BJJ_HOST", "127.0.0.1"))
    serve.add_argument("--port", type=int, default=int(os.environ.get("BJJ_PORT", "8766")))
    serve.add_argument("--db")
    serve.add_argument("--static", help="Also serve this directory. Use for local testing. Leave unset behind nginx.")
    serve.add_argument("--insecure-cookie", action="store_true", help="Allow the session cookie on http://localhost.")
    serve.set_defaults(func=cmd_serve)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
