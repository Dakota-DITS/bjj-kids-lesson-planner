"""JSON API for roster, attendance, and progress. No student data is written to the repo."""

import base64
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta
from urllib.parse import unquote, urlparse

import bcrypt

from server.db import (
    ADULT_BELTS,
    AGE_GROUP_AGES,
    BELTS,
    LEVELS,
    age_group_for_age,
    cleanup,
    connect,
    is_class_day,
    is_legacy_storage_key,
    iso,
    migrate,
    new_id,
    normalize_age_group,
    order_lesson_plans,
    parse_iso,
    today_pacific,
    token_hash,
    utcnow,
)

ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
USER_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
WAIVER_GOALS = (
    "Health",
    "Self-defense",
    "Bully-proofing",
    "Competition",
    "Meet new friends",
    "Fun",
)
MAX_BODY = 3_000_000
LOGIN_LIMIT = 8
LOGIN_WINDOW_MIN = 15
SESSION_DAYS = 14
DEFAULT_KIDS_CAP = 12
KIDS_FULL = (
    "Kids class is full right now. Email dits+bjj@mail.grokbot.com to ask about the next opening."
)


def config_from_env():
    data_dir = os.environ.get("BJJ_DATA_DIR", "/var/lib/bjj-planner")
    db_path = os.environ.get("BJJ_DB") or os.path.join(data_dir, "data.db")
    return {
        "data_dir": data_dir,
        "db_path": db_path,
        "sheets_dir": os.path.join(data_dir, "sheets"),
        "secure": os.environ.get("BJJ_COOKIE_SECURE", "1") != "0",
        "trust_proxy": os.environ.get("BJJ_TRUST_PROXY", "0") == "1",
        "static_root": os.environ.get("BJJ_STATIC", ""),
    }


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def check_password(password, hashed):
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def clip(value, limit):
    return str(value if value is not None else "").replace("\x00", "").strip()[:limit]


def clean_id(value):
    text = clip(value, 40)
    return text if ID_RE.match(text) else ""


class Api:
    def __init__(self, cfg):
        self.cfg = cfg
        os.makedirs(cfg["sheets_dir"], exist_ok=True)
        conn = connect(cfg["db_path"])
        migrate(conn)
        cleanup(conn)
        conn.close()
        self._waiver_posts = []

    def db(self):
        return connect(self.cfg["db_path"])

    def client_ip(self, handler):
        remote = handler.client_address[0]
        if not self.cfg["trust_proxy"]:
            return remote
        forwarded = handler.headers.get("X-Forwarded-For", "")
        first = forwarded.split(",")[0].strip()
        return first or remote

    def read_json(self, handler):
        length = int(handler.headers.get("Content-Length") or 0)
        if length < 0 or length > MAX_BODY:
            raise ValueError("That upload is too large.")
        raw = handler.rfile.read(length) if length else b""
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            raise ValueError("The request was not JSON.") from err
        if not isinstance(data, dict):
            raise ValueError("The request was not a JSON object.")
        return data

    def cookie_token(self, handler):
        header = handler.headers.get("Cookie", "")
        for part in header.split(";"):
            name, _, value = part.strip().partition("=")
            if name == "bjj_session" and value:
                return value
        return ""

    def session_user(self, conn, handler):
        token = self.cookie_token(handler)
        if not token:
            return None, None
        row = conn.execute(
            """
            SELECT sessions.csrf, sessions.expires_at, users.id, users.username, users.role,
                   users.must_change_password
            FROM sessions JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ?
            """,
            (token_hash(token),),
        ).fetchone()
        if not row:
            return None, None
        if parse_iso(row["expires_at"]) < utcnow():
            return None, None
        user = {
            "id": row["id"],
            "username": row["username"],
            "role": row["role"],
            "mustChangePassword": bool(row["must_change_password"]),
        }
        return user, row["csrf"]

    def require_csrf(self, handler, expected):
        sent = handler.headers.get("X-CSRF-Token", "")
        if not expected or not sent or not secrets.compare_digest(sent, expected):
            return False
        return True

    def too_many_logins(self, conn, ip):
        since = iso(utcnow() - timedelta(minutes=LOGIN_WINDOW_MIN))
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at >= ?",
            (ip, since),
        ).fetchone()["n"]
        return count >= LOGIN_LIMIT

    def issue_session(self, conn, user_id):
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        expires = iso(utcnow() + timedelta(days=SESSION_DAYS))
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, csrf, expires_at) VALUES (?, ?, ?, ?)",
            (token_hash(token), user_id, csrf, expires),
        )
        return token, csrf, expires

    def display_staff_name(self, name, username=""):
        stored = "" if name is None else str(name).strip()
        login = "" if username is None else str(username).strip()
        source = stored or login
        if not source:
            return ""
        if stored and (not login or stored.lower() != login.lower()):
            return stored
        return source[:1].upper() + source[1:]

    def display_name_for_user(self, conn, user):
        row = conn.execute(
            """
            SELECT staff.name AS name
            FROM users
            LEFT JOIN staff ON staff.user_id = users.id
            WHERE users.id = ?
            """,
            (user["id"],),
        ).fetchone()
        if not row:
            return self.display_staff_name("", user.get("username"))
        return self.display_staff_name(row["name"], user.get("username"))

    def public_user(self, user, csrf, conn=None):
        shown = (
            self.display_name_for_user(conn, user)
            if conn is not None
            else self.display_staff_name("", user.get("username"))
        )
        return {
            "user": {
                "id": user["id"],
                "username": user["username"],
                "role": user["role"],
                "mustChangePassword": bool(user.get("mustChangePassword")),
                "displayName": shown,
            },
            "csrf": csrf,
        }

    def student_json(self, row):
        return {
            "id": row["id"],
            "name": row["name"],
            "age": row["age"],
            "belt": row["belt"],
            "stripes": row["stripes"],
            "dob": self.cell(row, "dob", "") or "",
        }

    def cell(self, row, key, default=""):
        try:
            value = row[key]
        except (KeyError, IndexError):
            return default
        return default if value is None else value

    def json_list(self, value):
        if value is None or value == "":
            return []
        try:
            parsed = json.loads(value)
        except (TypeError, json.JSONDecodeError, ValueError):
            return []
        return parsed if isinstance(parsed, list) else []

    def class_json(self, row):
        return {
            "id": self.cell(row, "id"),
            "date": self.cell(row, "date"),
            "ageGroup": self.cell(row, "age_group") or "mite",
            "theme": self.cell(row, "theme"),
            "themeLabel": self.cell(row, "theme_label"),
            "techniques": self.json_list(self.cell(row, "techniques", None)),
            "game": self.cell(row, "game"),
            "attended": self.json_list(self.cell(row, "attended", None)),
            "taught": bool(self.cell(row, "taught", 0)),
        }

    def sanitize_student(self, raw, existing_id=None):
        name = clip(raw.get("name"), 40)
        if not name:
            raise ValueError("Add the student's name.")
        try:
            age = int(raw.get("age"))
        except (TypeError, ValueError):
            age = 8
        age = max(3, min(17, age))
        belt = raw.get("belt") if raw.get("belt") in BELTS else "white"
        try:
            stripes = int(raw.get("stripes"))
        except (TypeError, ValueError):
            stripes = 0
        stripes = max(0, min(4, stripes))
        sid = clean_id(existing_id or raw.get("id")) or new_id("s-")
        return {"id": sid, "name": name, "age": age, "belt": belt, "stripes": stripes}

    def sanitize_techniques(self, raw):
        out = []
        if not isinstance(raw, list):
            return out
        for item in raw[:12]:
            if not isinstance(item, dict):
                continue
            tid = clean_id(item.get("id"))
            name = clip(item.get("name"), 80)
            if tid and name:
                out.append(
                    {
                        "id": tid,
                        "name": name,
                        "position": clip(item.get("position"), 40),
                        "theme": clip(item.get("theme"), 32).lower(),
                    }
                )
        return out

    def sanitize_class(self, raw):
        date = clip(raw.get("date"), 10)
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
            raise ValueError("The class needs a date.")
        age = normalize_age_group(raw.get("ageGroup"))
        attended = []
        for sid in raw.get("attended") or []:
            clean = clean_id(sid)
            if clean and clean not in attended:
                attended.append(clean)
        return {
            "id": clean_id(raw.get("id")) or new_id("k-"),
            "date": date,
            "ageGroup": age,
            "theme": clip(raw.get("theme"), 32).lower(),
            "themeLabel": clip(raw.get("themeLabel"), 48),
            "techniques": self.sanitize_techniques(raw.get("techniques")),
            "game": clip(raw.get("game"), 80),
            "attended": attended[:80],
            "taught": bool(raw.get("taught")),
        }

    def setting(self, conn, key, default=""):
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def put_setting(self, conn, key, value):
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )

    def bootstrap(self, conn):
        staff = []
        try:
            if self.ensure_login_staff(conn):
                conn.commit()
            staff = [self.staff_json(row) for row in self.staff_rows(conn)]
        except sqlite3.Error:
            staff = []
        students = [self.student_json(row) for row in conn.execute("SELECT * FROM students ORDER BY name")]
        classes = [self.class_json(row) for row in conn.execute("SELECT * FROM classes ORDER BY date, age_group")]
        levels = {}
        for row in conn.execute("SELECT student_id, tech_id, level FROM levels"):
            levels.setdefault(row["student_id"], {})[row["tech_id"]] = row["level"]
        notes = {row["student_id"]: row["note"] for row in conn.execute("SELECT student_id, note FROM notes")}
        try:
            own = int(self.setting(conn, "stripe_own", "6"))
        except ValueError:
            own = 6
        try:
            attend = int(self.setting(conn, "stripe_attend", "8"))
        except ValueError:
            attend = 8
        sheets = [
            {
                "id": row["id"],
                "clientId": row["client_id"] or "",
                "title": row["title"],
                "caption": row["caption"],
                "theme": row["theme"],
                "published": bool(row["published"]),
            }
            for row in conn.execute("SELECT * FROM sheets ORDER BY created_at")
        ]
        return {
            "students": students,
            "classes": classes,
            "levels": levels,
            "notes": notes,
            "stripe": {"own": max(1, min(40, own)), "attend": max(1, min(40, attend))},
            "featured": {
                "sheetId": self.setting(conn, "featured_sheet", ""),
                "caption": self.setting(conn, "featured_caption", ""),
            },
            "sheets": sheets,
            "cards": [self.card_json(row) for row in conn.execute("SELECT * FROM cards ORDER BY created_at, code")],
            "staff": staff,
            "kidsEnrollment": self.enrollment_snapshot(conn),
        }

    def staff_json(self, row):
        user_id = self.cell(row, "user_id")
        stripes = self.cell(row, "stripes", 0)
        try:
            stripes = int(stripes)
        except (TypeError, ValueError):
            stripes = 0
        name = self.cell(row, "name")
        username = self.cell(row, "username", "")
        return {
            "id": self.cell(row, "id"),
            "name": name,
            "belt": self.cell(row, "belt") or "white",
            "stripes": max(0, min(4, stripes)),
            "userId": user_id,
            "username": username,
            "displayName": self.display_staff_name(name, username),
            "login": bool(user_id),
        }

    def staff_rows(self, conn, where="", params=()):
        sql = (
            "SELECT staff.id AS id, staff.name AS name, staff.belt AS belt, staff.stripes AS stripes, "
            "staff.user_id AS user_id, staff.created_at AS created_at, users.username AS username "
            "FROM staff LEFT JOIN users ON users.id = staff.user_id"
        )
        if where:
            sql += " WHERE " + where
        sql += " ORDER BY staff.name COLLATE NOCASE, staff.id"
        return conn.execute(sql, params).fetchall()

    def ensure_login_staff(self, conn):
        rows = conn.execute(
            """
            SELECT users.id AS id, users.username AS username
            FROM users
            LEFT JOIN staff ON staff.user_id = users.id
            WHERE staff.id IS NULL
            """
        ).fetchall()
        now = iso(utcnow())
        made = 0
        for row in rows:
            try:
                conn.execute(
                    "INSERT INTO staff (id, name, belt, stripes, user_id, created_at) VALUES (?, ?, 'white', 0, ?, ?)",
                    (new_id("st-"), row["username"], row["id"], now),
                )
                made += 1
            except sqlite3.Error:
                continue
        return made

    def sanitize_staff(self, raw, existing=None):
        name = clip(raw.get("name"), 40)
        if not name:
            raise ValueError("Add the person's name.")
        belt = raw.get("belt") if raw.get("belt") in ADULT_BELTS else (existing["belt"] if existing else "white")
        try:
            stripes = int(raw.get("stripes"))
        except (TypeError, ValueError):
            stripes = existing["stripes"] if existing else 0
        stripes = max(0, min(4, stripes))
        return {"name": name, "belt": belt, "stripes": stripes}

    def card_json(self, row):
        return {
            "code": row["code"],
            "status": row["status"],
            "studentId": row["student_id"] or "",
            "createdAt": row["created_at"],
        }

    def student_from_claim(self, raw):
        raw = raw or {}
        age_raw = raw.get("age")
        blank_age = age_raw is None or (isinstance(age_raw, str) and not str(age_raw).strip())
        group = raw.get("ageGroup") if raw.get("ageGroup") in AGE_GROUP_AGES else ""
        if blank_age:
            if not group:
                raise ValueError("Add an age or a class.")
            age = AGE_GROUP_AGES[group]
        else:
            try:
                age = int(age_raw)
            except (TypeError, ValueError):
                raise ValueError("Age needs to be a number.")
            if age < 3 or age > 17:
                raise ValueError("Age needs to be from 3 to 17.")
        payload = {
            "name": raw.get("name"),
            "age": age,
            "belt": raw.get("belt"),
            "stripes": raw.get("stripes"),
        }
        return self.sanitize_student(payload)

    def save_class(self, conn, entry, merge):
        current = conn.execute(
            "SELECT * FROM classes WHERE date = ? AND age_group = ?",
            (entry["date"], entry["ageGroup"]),
        ).fetchone()
        attended = entry["attended"]
        if current and merge:
            try:
                previous = json.loads(current["attended"])
            except json.JSONDecodeError:
                previous = []
            for sid in previous:
                if sid not in attended:
                    attended.append(sid)
            entry["id"] = current["id"]
            if current["taught"] and not entry["taught"]:
                entry["taught"] = True
        elif current:
            entry["id"] = current["id"]
        attended = self.keep_class_attendance(conn, entry["ageGroup"], attended)
        entry["attended"] = attended
        payload = (
            entry["id"],
            entry["date"],
            entry["ageGroup"],
            entry["theme"],
            entry["themeLabel"],
            json.dumps(entry["techniques"]),
            entry["game"],
            json.dumps(attended),
            1 if entry["taught"] else 0,
        )
        conn.execute(
            """
            INSERT INTO classes (id, date, age_group, theme, theme_label, techniques, game, attended, taught)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date, age_group) DO UPDATE SET
              theme = excluded.theme,
              theme_label = excluded.theme_label,
              techniques = excluded.techniques,
              game = excluded.game,
              attended = excluded.attended,
              taught = excluded.taught
            """,
            payload,
        )
        row = conn.execute(
            "SELECT * FROM classes WHERE date = ? AND age_group = ?",
            (entry["date"], entry["ageGroup"]),
        ).fetchone()
        return self.class_json(row)

    def keep_class_attendance(self, conn, age_group, attended):
        parts = [part for part in str(age_group or "").split("+") if part]
        if len(parts) < 2:
            return attended
        allowed = set(parts)
        kept = []
        for sid in attended:
            row = conn.execute("SELECT age FROM students WHERE id = ?", (sid,)).fetchone()
            if row is not None and age_group_for_age(row["age"]) not in allowed:
                continue
            if sid not in kept:
                kept.append(sid)
        return kept

    def decode_image(self, data_url):
        text = str(data_url or "")
        match = re.match(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=\s]+)$", text)
        if not match:
            raise ValueError("Upload a PNG, JPEG, or WebP image.")
        import base64

        try:
            blob = base64.b64decode(match.group(2), validate=False)
        except ValueError as err:
            raise ValueError("That image could not be read.") from err
        if len(blob) < 32 or len(blob) > 2_500_000:
            raise ValueError("That image is empty or too large.")
        kind = match.group(1)
        ext = {"png": ".png", "jpeg": ".jpg", "webp": ".webp"}[kind]
        return blob, ext

    def handle(self, handler):
        if handler.command == "HEAD":
            handler._bjj_head = True
            handler.command = "GET"
        parsed = urlparse(handler.path)
        path = unquote(parsed.path)
        method = handler.command
        if self.cfg["static_root"] and not path.startswith("/api/"):
            return self.serve_static(handler, path)
        try:
            if method == "GET" and path == "/api/auth/csrf":
                return self.get_csrf(handler)
            if method == "POST" and path == "/api/login":
                return self.login(handler)
            if method == "GET" and path == "/api/auth/nginx":
                return self.nginx_auth(handler)
            if method == "GET" and path == "/api/public/featured":
                return self.public_featured(handler)
            if method == "GET" and path == "/api/public/class-exceptions":
                return self.public_class_exceptions(handler)
            if method == "GET" and path == "/api/public/sheets":
                return self.public_sheets(handler)
            if method == "GET" and path == "/api/public/kids-enrollment":
                return self.public_kids_enrollment(handler)
            if method == "POST" and path == "/api/public/waivers":
                return self.submit_waiver(handler)
            image = re.match(r"^/api/public/sheets/([A-Za-z0-9_-]{1,40})/image$", path)
            if method == "GET" and image:
                return self.public_image(handler, image.group(1))
            conn = self.db()
            try:
                user, csrf = self.session_user(conn, handler)
                if path == "/api/me" and method == "GET":
                    if not user:
                        return self.send(handler, 401, {"error": "Log in first."})
                    return self.send(handler, 200, self.public_user(user, csrf, conn))
                if (
                    user
                    and user.get("mustChangePassword")
                    and not (path == "/api/password" and method == "POST")
                    and not (path == "/api/logout" and method == "POST")
                ):
                    return self.send(
                        handler,
                        403,
                        {
                            "error": "Choose a new password before continuing.",
                            "mustChangePassword": True,
                            "csrf": csrf,
                            "username": user["username"],
                        },
                    )
                if path == "/api/bootstrap" and method == "GET":
                    if not user:
                        return self.send(handler, 401, {"error": "Log in first."})
                    body = self.bootstrap(conn)
                    body.update(self.public_user(user, csrf, conn))
                    return self.send(handler, 200, body)
                if method in ("POST", "PUT", "PATCH", "DELETE") and not self.require_csrf(handler, csrf if user else ""):
                    if path != "/api/logout":
                        return self.send(handler, 403, {"error": "The page needs to be reloaded before saving."})
                if path == "/api/logout" and method == "POST":
                    return self.logout(handler, conn)
                if not user:
                    return self.send(handler, 401, {"error": "Log in first."})
                return self.authed(handler, conn, user, path, method)
            finally:
                conn.close()
        except ValueError as err:
            return self.send(handler, 400, {"error": str(err)})
        except Exception:
            return self.send(handler, 500, {"error": "Something went wrong on the server."})

    def authed(self, handler, conn, user, path, method):
        admin = user["role"] == "admin"
        if path == "/api/password" and method == "POST":
            return self.change_password(handler, conn, user)
        if path == "/api/users" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages logins."})
            rows = conn.execute(
                """
                SELECT users.id AS id, users.username AS username, users.role AS role,
                       users.must_change_password AS must_change_password, staff.name AS staff_name
                FROM users
                LEFT JOIN staff ON staff.user_id = users.id
                ORDER BY users.username
                """
            ).fetchall()
            return self.send(
                handler,
                200,
                {
                    "users": [
                        {
                            "id": row["id"],
                            "username": row["username"],
                            "role": row["role"],
                            "mustChangePassword": bool(row["must_change_password"]),
                            "displayName": self.display_staff_name(row["staff_name"], row["username"]),
                        }
                        for row in rows
                    ]
                },
            )
        if path == "/api/users" and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages logins."})
            return self.create_user(handler, conn)
        if path == "/api/staff" and method == "GET":
            if self.ensure_login_staff(conn):
                conn.commit()
            rows = self.staff_rows(conn)
            return self.send(handler, 200, {"staff": [self.staff_json(row) for row in rows]})
        if path == "/api/staff" and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages the staff roster."})
            return self.create_staff(handler, conn)
        staff_match = re.match(r"^/api/staff/([A-Za-z0-9_-]{1,40})$", path)
        if staff_match and method == "PATCH":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages the staff roster."})
            return self.patch_staff(handler, conn, staff_match.group(1))
        if staff_match and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages the staff roster."})
            return self.delete_staff(handler, conn, staff_match.group(1))
        reset_match = re.match(r"^/api/users/([A-Za-z0-9_-]{1,40})/password$", path)
        if reset_match and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "Only an admin can reset a password."})
            return self.reset_password(handler, conn, user, reset_match.group(1))
        user_match = re.match(r"^/api/users/([A-Za-z0-9_-]{1,40})$", path)
        if user_match and method == "PATCH":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages logins."})
            return self.patch_user_role(handler, conn, user_match.group(1))
        if user_match and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages logins."})
            return self.delete_user(handler, conn, user, user_match.group(1))
        if path == "/api/class-exceptions" and method == "GET":
            return self.list_class_exceptions(handler, conn, public=False)
        if path == "/api/class-exceptions" and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin edits the class calendar."})
            return self.save_class_exception(handler, conn, user)
        exception_date = re.fullmatch(r"/api/class-exceptions/(\d{4}-\d{2}-\d{2})", path)
        if exception_date and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin edits the class calendar."})
            return self.delete_class_exception(handler, conn, exception_date.group(1))
        if path == "/api/plans" and method == "GET":
            return self.list_plans(handler, conn)
        if path == "/api/plans" and method == "PUT":
            return self.save_plan(handler, conn, user)
        plan_match = re.match(r"^/api/plans/([A-Za-z0-9_-]{1,40})$", path)
        if plan_match and method == "GET":
            return self.load_plan(handler, conn, plan_match.group(1))
        if plan_match and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin removes saved plans."})
            return self.delete_plan(handler, conn, plan_match.group(1))
        if path == "/api/students" and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin adds students."})
            return self.add_student(handler, conn)
        student_match = re.match(r"^/api/students/([A-Za-z0-9_-]{1,40})$", path)
        if student_match and method == "PATCH":
            if not admin:
                return self.send(handler, 403, {"error": "An admin edits the roster."})
            return self.patch_student(handler, conn, student_match.group(1))
        if student_match and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin removes students."})
            return self.delete_student(handler, conn, student_match.group(1))
        if path == "/api/cards" and method == "GET":
            rows = conn.execute("SELECT * FROM cards ORDER BY created_at, code").fetchall()
            return self.send(handler, 200, {"cards": [self.card_json(row) for row in rows]})
        if path == "/api/cards" and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin prints blank cards."})
            return self.create_cards(handler, conn)
        claim_match = re.match(r"^/api/cards/([A-Za-z0-9_-]{1,40})/claim$", path)
        if claim_match and method == "POST":
            return self.claim_card(handler, conn, claim_match.group(1))
        retire_match = re.match(r"^/api/cards/([A-Za-z0-9_-]{1,40})/retire$", path)
        if retire_match and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin retires cards."})
            return self.retire_card(handler, conn, retire_match.group(1))
        card_match = re.match(r"^/api/cards/([A-Za-z0-9_-]{1,40})$", path)
        if card_match and method == "PATCH":
            if not admin:
                return self.send(handler, 403, {"error": "An admin re-links cards."})
            return self.relink_card(handler, conn, card_match.group(1))
        if path == "/api/classes" and method == "PUT":
            saved = self.save_class(conn, self.sanitize_class(self.read_json(handler)), merge=False)
            conn.commit()
            return self.send(handler, 200, saved)
        class_match = re.match(r"^/api/classes/([A-Za-z0-9_-]{1,40})$", path)
        if class_match and method == "DELETE":
            cid = class_match.group(1)
            if not conn.execute("SELECT 1 FROM classes WHERE id = ?", (cid,)).fetchone():
                return self.send(handler, 404, {"error": "That class is already gone."})
            conn.execute("DELETE FROM classes WHERE id = ?", (cid,))
            conn.commit()
            return self.send(handler, 200, {"ok": True})
        if path == "/api/attendance" and method == "POST":
            body = self.read_json(handler)
            saved = self.save_class(conn, self.sanitize_class(body), merge=True)
            conn.commit()
            return self.send(handler, 200, saved)
        if path == "/api/levels" and method == "PUT":
            body = self.read_json(handler)
            sid = clean_id(body.get("studentId"))
            tid = clean_id(body.get("techId"))
            level = body.get("level")
            if not sid or not tid or level not in LEVELS:
                raise ValueError("That progress update is missing a student, a technique, or a level.")
            conn.execute(
                """
                INSERT INTO levels (student_id, tech_id, level) VALUES (?, ?, ?)
                ON CONFLICT(student_id, tech_id) DO UPDATE SET level = excluded.level
                """,
                (sid, tid, level),
            )
            conn.commit()
            return self.send(handler, 200, {"ok": True})
        if path == "/api/levels" and method == "DELETE":
            body = self.read_json(handler)
            sid = clean_id(body.get("studentId"))
            tid = clean_id(body.get("techId"))
            if not sid or not tid:
                raise ValueError("That progress update is missing a student or a technique.")
            conn.execute("DELETE FROM levels WHERE student_id = ? AND tech_id = ?", (sid, tid))
            conn.commit()
            return self.send(handler, 200, {"ok": True})
        if path == "/api/notes" and method == "PUT":
            body = self.read_json(handler)
            sid = clean_id(body.get("studentId"))
            note = clip(body.get("note"), 800)
            if not sid:
                raise ValueError("That note needs a student.")
            if note:
                conn.execute(
                    "INSERT INTO notes (student_id, note) VALUES (?, ?) ON CONFLICT(student_id) DO UPDATE SET note = excluded.note",
                    (sid, note),
                )
            else:
                conn.execute("DELETE FROM notes WHERE student_id = ?", (sid,))
            conn.commit()
            return self.send(handler, 200, {"ok": True})
        if path == "/api/stripe" and method == "PUT":
            if not admin:
                return self.send(handler, 403, {"error": "Only an admin can change the stripe hint."})
            body = self.read_json(handler)
            try:
                own = int(body.get("own"))
            except (TypeError, ValueError):
                own = 6
            try:
                attend = int(body.get("attend"))
            except (TypeError, ValueError):
                attend = 8
            own = max(1, min(40, own))
            attend = max(1, min(40, attend))
            self.put_setting(conn, "stripe_own", str(own))
            self.put_setting(conn, "stripe_attend", str(attend))
            conn.commit()
            return self.send(handler, 200, {"own": own, "attend": attend})
        if path == "/api/featured" and method == "PUT":
            body = self.read_json(handler)
            sheet_id = clean_id(body.get("sheetId"))
            caption = clip(body.get("caption"), 160)
            self.put_setting(conn, "featured_sheet", sheet_id)
            self.put_setting(conn, "featured_caption", caption)
            conn.commit()
            return self.send(handler, 200, {"sheetId": sheet_id, "caption": caption})
        if path == "/api/sheets" and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin publishes coloring sheets."})
            return self.save_sheet(handler, conn)
        if path == "/api/import" and method == "POST":
            return self.import_local(handler, conn, admin)
        if path == "/api/kids-cap" and method == "PUT":
            if not admin:
                return self.send(handler, 403, {"error": "An admin sets the kids class size."})
            return self.save_kids_cap(handler, conn)
        if path == "/api/export" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin downloads the attendance backup."})
            body = self.bootstrap(conn)
            body.pop("sheets", None)
            return self.send(handler, 200, body)
        if path == "/api/export/roster.csv" and method == "GET":
            return self.send_csv(handler, "grace-roster.csv", self.roster_csv(conn))
        if path == "/api/export/attendance.csv" and method == "GET":
            return self.send_csv(handler, "grace-attendance.csv", self.attendance_csv(conn))
        if path == "/api/waivers" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.list_waivers(handler, conn)
        if path == "/api/waivers.csv" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.send_csv(handler, "grace-waivers.csv", self.waivers_csv(conn))
        waiver_roster = re.fullmatch(r"/api/waivers/([A-Za-z0-9_-]{1,40})/roster", path)
        if waiver_roster and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.mark_waiver_on_roster(handler, conn, waiver_roster.group(1))
        waiver_match = re.fullmatch(r"/api/waivers/([A-Za-z0-9_-]{1,40})", path)
        if waiver_match and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.waiver_detail(handler, conn, waiver_match.group(1))
        return self.send(handler, 404, {"error": "That address is not part of the API."})

    def get_csrf(self, handler):
        token = secrets.token_urlsafe(24)
        conn = self.db()
        try:
            conn.execute(
                "INSERT INTO csrf_challenges (token, expires_at) VALUES (?, ?)",
                (token, iso(utcnow() + timedelta(minutes=10))),
            )
            conn.commit()
        finally:
            conn.close()
        self.send(handler, 200, {"csrf": token})

    def login(self, handler, conn=None):
        own = conn or self.db()
        try:
            ip = self.client_ip(handler)
            if self.too_many_logins(own, ip):
                return self.send(handler, 429, {"error": "Too many sign-in tries. Wait a few minutes."})
            body = self.read_json(handler)
            sent = handler.headers.get("X-CSRF-Token", "")
            challenge = own.execute(
                "SELECT token, expires_at FROM csrf_challenges WHERE token = ?",
                (sent,),
            ).fetchone()
            if not challenge or not secrets.compare_digest(challenge["token"], sent) or parse_iso(challenge["expires_at"]) < utcnow():
                return self.send(handler, 403, {"error": "Reload the login page and try again."})
            own.execute("DELETE FROM csrf_challenges WHERE token = ?", (sent,))
            username = clip(body.get("username"), 32)
            password = str(body.get("password") or "")
            row = own.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            if not row or not check_password(password, row["password_hash"]):
                own.execute("INSERT INTO login_attempts (ip, at) VALUES (?, ?)", (ip, iso(utcnow())))
                own.commit()
                return self.send(handler, 401, {"error": "Those details don't match."})
            token, csrf, _expires = self.issue_session(own, row["id"])
            own.commit()
            user = {
                "id": row["id"],
                "username": row["username"],
                "role": row["role"],
                "mustChangePassword": bool(row["must_change_password"]),
            }
            self.send(handler, 200, self.public_user(user, csrf, own), set_cookie=token)
        finally:
            if conn is None:
                own.close()

    def logout(self, handler, conn):
        token = self.cookie_token(handler)
        if token:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))
            conn.commit()
        self.send(handler, 200, {"ok": True}, clear_cookie=True)

    def nginx_auth(self, handler):
        conn = self.db()
        try:
            user, _csrf = self.session_user(conn, handler)
        finally:
            conn.close()
        if not user:
            handler.send_response(401)
            handler.send_header("Cache-Control", "no-store")
            handler.end_headers()
            return
        handler.send_response(204)
        handler.send_header("Cache-Control", "no-store")
        handler.end_headers()

    def plan_date_allowed(self, conn, value):
        if is_class_day(value):
            return True
        row = conn.execute(
            "SELECT kind FROM class_exceptions WHERE date = ?",
            (str(value or "").strip(),),
        ).fetchone()
        return bool(row and row["kind"] == "extra")

    def exception_json(self, row, public):
        body = {
            "date": row["date"],
            "kind": row["kind"],
            "reason": row["reason"] or "",
            "start": row["start_time"],
            "end": row["end_time"],
        }
        if not public:
            body["createdBy"] = row["created_by"] or ""
            body["createdAt"] = row["created_at"]
        return body

    def list_exception_rows(self, conn):
        return conn.execute("SELECT * FROM class_exceptions ORDER BY date").fetchall()

    def public_class_exceptions(self, handler):
        conn = self.db()
        try:
            rows = self.list_exception_rows(conn)
        finally:
            conn.close()
        self.send(handler, 200, {"exceptions": [self.exception_json(row, True) for row in rows]})

    def list_class_exceptions(self, handler, conn, public):
        rows = self.list_exception_rows(conn)
        return self.send(handler, 200, {"exceptions": [self.exception_json(row, public) for row in rows]})

    def clean_clock(self, value, fallback):
        text = fallback if value in (None, "") else str(value).strip()
        match = re.fullmatch(r"(\d{1,2}):(\d{2})", text)
        if not match:
            raise ValueError("Use a time like 17:30.")
        hour = int(match.group(1))
        minute = int(match.group(2))
        if hour > 23 or minute > 59:
            raise ValueError("That time is not valid.")
        return f"{hour:02d}:{minute:02d}"

    def save_class_exception(self, handler, conn, user):
        body = self.read_json(handler)
        date = str(body.get("date") or "").strip()
        try:
            parsed = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise ValueError("Choose a real date.")
        if parsed.strftime("%Y-%m-%d") != date:
            raise ValueError("Choose a real date.")
        kind = str(body.get("kind") or "").strip()
        if kind not in ("skip", "extra"):
            raise ValueError("Choose skip or a make-up class.")
        if kind == "skip" and not is_class_day(date):
            raise ValueError("Only a regular class Tuesday can be skipped.")
        if kind == "extra" and is_class_day(date):
            raise ValueError("That Tuesday is already on the schedule. Skip it if class is cancelled.")
        reason = str(body.get("reason") or "").replace("\u0000", "").strip()
        if len(reason) > 120:
            raise ValueError("Keep the reason to 120 characters.")
        start = self.clean_clock(body.get("start") or body.get("startTime"), "17:30")
        end = self.clean_clock(body.get("end") or body.get("endTime"), "18:15")
        if end <= start:
            raise ValueError("The end time needs to be after the start.")
        now = iso(utcnow())
        conn.execute(
            """
            INSERT INTO class_exceptions
              (date, kind, reason, start_time, end_time, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
              kind = excluded.kind,
              reason = excluded.reason,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              created_by = excluded.created_by,
              created_at = excluded.created_at
            """,
            (date, kind, reason, start, end, user.get("username") or "", now),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM class_exceptions WHERE date = ?", (date,)).fetchone()
        return self.send(handler, 200, {"exception": self.exception_json(row, False)})

    def delete_class_exception(self, handler, conn, date):
        row = conn.execute("SELECT date FROM class_exceptions WHERE date = ?", (date,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That date is not changed."})
        conn.execute("DELETE FROM class_exceptions WHERE date = ?", (date,))
        conn.commit()
        return self.send(handler, 200, {"ok": True, "date": date})

    def public_featured(self, handler):
        conn = self.db()
        try:
            body = {
                "sheetId": self.setting(conn, "featured_sheet", ""),
                "caption": self.setting(conn, "featured_caption", ""),
            }
        finally:
            conn.close()
        self.send(handler, 200, body)

    def public_sheets(self, handler):
        conn = self.db()
        try:
            rows = conn.execute(
                "SELECT id, title, caption, theme FROM sheets WHERE published = 1 ORDER BY created_at"
            ).fetchall()
        finally:
            conn.close()
        self.send(
            handler,
            200,
            {"sheets": [{"id": row["id"], "title": row["title"], "caption": row["caption"], "theme": row["theme"]} for row in rows]},
        )

    def public_image(self, handler, sid):
        conn = self.db()
        try:
            row = conn.execute(
                "SELECT filename FROM sheets WHERE id = ? AND published = 1",
                (sid,),
            ).fetchone()
        finally:
            conn.close()
        if not row:
            return self.send(handler, 404, {"error": "That sheet is not published."})
        filename = os.path.basename(row["filename"])
        path = os.path.join(self.cfg["sheets_dir"], filename)
        if not os.path.isfile(path):
            return self.send(handler, 404, {"error": "That sheet file is missing."})
        ext = os.path.splitext(filename)[1].lower()
        ctype = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(ext, "application/octet-stream")
        with open(path, "rb") as handle:
            blob = handle.read()
        handler.send_response(200)
        handler.send_header("Content-Type", ctype)
        handler.send_header("Content-Length", str(len(blob)))
        handler.send_header("Cache-Control", "public, max-age=300")
        self.security_headers(handler)
        handler.end_headers()
        handler.wfile.write(blob)

    def change_password(self, handler, conn, user):
        body = self.read_json(handler)
        current = str(body.get("current") or "")
        nxt = str(body.get("next") or "")
        if len(nxt) < 10:
            raise ValueError("Use at least 10 characters.")
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not check_password(current, row["password_hash"]):
            return self.send(handler, 401, {"error": "The current password does not match."})
        if nxt == current:
            raise ValueError("Choose a different password.")
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?",
            (hash_password(nxt), user["id"]),
        )
        conn.commit()
        return self.send(handler, 200, {"ok": True})

    def create_user(self, handler, conn):
        body = self.read_json(handler)
        username = clip(body.get("username"), 32)
        password = str(body.get("password") or "")
        role = body.get("role") if body.get("role") in ("admin", "teacher") else "teacher"
        if not USER_RE.match(username):
            raise ValueError("Usernames are 3–32 letters, numbers, dots, or dashes.")
        if len(password) < 10:
            raise ValueError("Use at least 10 characters.")
        if conn.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
            raise ValueError("That username is already in use.")
        uid = new_id("u-")
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
            (uid, username, hash_password(password), role, iso(utcnow())),
        )
        self.ensure_login_staff(conn)
        conn.commit()
        return self.send(handler, 201, {"id": uid, "username": username, "role": role})

    def reset_password(self, handler, conn, user, uid):
        if uid == user["id"]:
            raise ValueError("Change your own password from Account.")
        target = conn.execute("SELECT id, role FROM users WHERE id = ?", (uid,)).fetchone()
        if not target:
            return self.send(handler, 404, {"error": "That login is already gone."})
        if target["role"] == "admin":
            others = conn.execute(
                "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND id != ? AND must_change_password = 0",
                (uid,),
            ).fetchone()["n"]
            if others < 1:
                raise ValueError("Keep at least one admin who can still sign in.")
        body = self.read_json(handler)
        password = str(body.get("password") or "")
        if len(password) < 10:
            raise ValueError("Use at least 10 characters.")
        if len(password) > 200:
            raise ValueError("That password is too long.")
        conn.execute(
            "UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?",
            (hash_password(password), uid),
        )
        conn.execute("DELETE FROM sessions WHERE user_id = ?", (uid,))
        conn.commit()
        return self.send(handler, 200, {"ok": True})

    def delete_user(self, handler, conn, user, uid):
        if uid == user["id"]:
            raise ValueError("You can't remove the login you are using.")
        target = conn.execute("SELECT role FROM users WHERE id = ?", (uid,)).fetchone()
        if not target:
            return self.send(handler, 404, {"error": "That login is already gone."})
        if target["role"] == "admin":
            admins = conn.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").fetchone()["n"]
            if admins <= 1:
                raise ValueError("Keep at least one admin.")
        conn.execute("UPDATE staff SET user_id = NULL WHERE user_id = ?", (uid,))
        conn.execute("DELETE FROM users WHERE id = ?", (uid,))
        conn.commit()
        return self.send(handler, 200, {"ok": True})

    def user_public(self, conn, uid):
        row = conn.execute(
            """
            SELECT users.id AS id, users.username AS username, users.role AS role,
                   users.must_change_password AS must_change_password, staff.name AS staff_name
            FROM users
            LEFT JOIN staff ON staff.user_id = users.id
            WHERE users.id = ?
            """,
            (uid,),
        ).fetchone()
        if not row:
            return None
        return {
            "id": row["id"],
            "username": row["username"],
            "role": row["role"],
            "mustChangePassword": bool(row["must_change_password"]),
            "displayName": self.display_staff_name(row["staff_name"], row["username"]),
        }

    def patch_user_role(self, handler, conn, uid):
        body = self.read_json(handler)
        role = body.get("role")
        if role not in ("admin", "teacher"):
            raise ValueError("Role needs to be admin or teacher.")
        target = conn.execute(
            "SELECT id, role, must_change_password FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
        if not target:
            return self.send(handler, 404, {"error": "That login is already gone."})
        if target["role"] == "admin" and role != "admin":
            others = conn.execute(
                """
                SELECT COUNT(*) AS n FROM users
                WHERE role = 'admin' AND id != ? AND must_change_password = 0
                """,
                (uid,),
            ).fetchone()["n"]
            if others < 1:
                raise ValueError("Keep at least one admin who can still sign in.")
        conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, uid))
        conn.commit()
        return self.send(handler, 200, self.user_public(conn, uid))

    def plan_age_group(self, value):
        raw = str(value or "").strip().lower()
        if not raw:
            raise ValueError("Choose an age group.")
        # A leftover row from before the two-group change keeps its key so a
        # save does not overwrite the plan that already uses the new key.
        if is_legacy_storage_key(raw):
            return raw
        canonical = normalize_age_group(raw)
        if raw != canonical:
            raise ValueError("Choose an age group.")
        return canonical

    def clean_plan_document(self, raw):
        if not isinstance(raw, dict):
            raise ValueError("That plan could not be saved.")
        if raw.get("mode") not in ("grace", "toddler"):
            raise ValueError("That plan could not be saved.")
        if not isinstance(raw.get("settings"), dict):
            raise ValueError("That plan could not be saved.")
        encoded = json.dumps(raw, ensure_ascii=False, separators=(",", ":"))
        if len(encoded) > 500_000:
            raise ValueError("That plan is too large to save.")
        return encoded

    def plan_summary(self, conn, row):
        user_id = row["updated_by"]
        who = conn.execute(
            """
            SELECT users.username AS username, staff.name AS staff_name
            FROM users
            LEFT JOIN staff ON staff.user_id = users.id
            WHERE users.id = ?
            """,
            (user_id,),
        ).fetchone()
        saved_by = "A teacher"
        username = ""
        if who:
            username = who["username"] or ""
            saved_by = self.display_staff_name(who["staff_name"], who["username"]) or "A teacher"
        return {
            "id": row["id"],
            "classDate": row["class_date"],
            "ageGroup": row["age_group"],
            "updatedAt": row["updated_at"],
            "savedBy": saved_by,
            "savedByUsername": username,
        }

    def list_plans(self, handler, conn):
        rows = conn.execute("SELECT * FROM lesson_plans").fetchall()
        ordered = order_lesson_plans(rows, today_pacific())
        return self.send(handler, 200, {"plans": [self.plan_summary(conn, row) for row in ordered]})

    def save_plan(self, handler, conn, user):
        body = self.read_json(handler)
        date = str(body.get("date") or body.get("classDate") or "").strip()
        if not self.plan_date_allowed(conn, date):
            raise ValueError("Choose a class Tuesday, or a make-up date from the class calendar.")
        age = self.plan_age_group(body.get("ageGroup"))
        encoded = self.clean_plan_document(body.get("plan"))
        now = iso(utcnow())
        existing = conn.execute(
            "SELECT id FROM lesson_plans WHERE class_date = ? AND age_group = ?",
            (date, age),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE lesson_plans SET plan_json = ?, updated_by = ?, updated_at = ? WHERE id = ?",
                (encoded, user["id"], now, existing["id"]),
            )
            plan_id = existing["id"]
            created = False
        else:
            plan_id = new_id("lp-")
            conn.execute(
                """
                INSERT INTO lesson_plans
                  (id, class_date, age_group, plan_json, created_by, updated_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (plan_id, date, age, encoded, user["id"], user["id"], now, now),
            )
            created = True
        conn.commit()
        row = conn.execute("SELECT * FROM lesson_plans WHERE id = ?", (plan_id,)).fetchone()
        payload = self.plan_summary(conn, row)
        payload["plan"] = json.loads(row["plan_json"])
        payload["created"] = created
        return self.send(handler, 201 if created else 200, payload)

    def load_plan(self, handler, conn, plan_id):
        row = conn.execute("SELECT * FROM lesson_plans WHERE id = ?", (plan_id,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That saved plan is already gone."})
        payload = self.plan_summary(conn, row)
        payload["plan"] = json.loads(row["plan_json"])
        return self.send(handler, 200, payload)

    def delete_plan(self, handler, conn, plan_id):
        row = conn.execute("SELECT id FROM lesson_plans WHERE id = ?", (plan_id,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That saved plan is already gone."})
        conn.execute("DELETE FROM lesson_plans WHERE id = ?", (plan_id,))
        conn.commit()
        return self.send(handler, 200, {"ok": True})

    def create_staff(self, handler, conn):
        raw = self.sanitize_staff(self.read_json(handler))
        sid = new_id("st-")
        conn.execute(
            "INSERT INTO staff (id, name, belt, stripes, user_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
            (sid, raw["name"], raw["belt"], raw["stripes"], iso(utcnow())),
        )
        conn.commit()
        rows = self.staff_rows(conn, "staff.id = ?", (sid,))
        return self.send(handler, 201, self.staff_json(rows[0]))

    def patch_staff(self, handler, conn, sid):
        row = conn.execute("SELECT * FROM staff WHERE id = ?", (sid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That person is not on the staff roster."})
        raw = self.sanitize_staff(self.read_json(handler), row)
        conn.execute(
            "UPDATE staff SET name = ?, belt = ?, stripes = ? WHERE id = ?",
            (raw["name"], raw["belt"], raw["stripes"], sid),
        )
        conn.commit()
        updated = self.staff_rows(conn, "staff.id = ?", (sid,))
        return self.send(handler, 200, self.staff_json(updated[0]))

    def delete_staff(self, handler, conn, sid):
        row = conn.execute("SELECT * FROM staff WHERE id = ?", (sid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That person is not on the staff roster."})
        if row["user_id"]:
            raise ValueError("That person has a login. Edit their belt here, or remove the login from Account.")
        conn.execute("DELETE FROM staff WHERE id = ?", (sid,))
        conn.commit()
        return self.send(handler, 200, {"ok": True})

    def create_cards(self, handler, conn):
        body = self.read_json(handler)
        try:
            count = int(body.get("count", 8))
        except (TypeError, ValueError):
            count = 8
        count = max(1, min(24, count))
        now = iso(utcnow())
        made = []
        for _ in range(count):
            code = "b-" + secrets.token_hex(16)
            conn.execute(
                "INSERT INTO cards (code, status, student_id, created_at) VALUES (?, 'unclaimed', NULL, ?)",
                (code, now),
            )
            made.append({"code": code, "status": "unclaimed", "studentId": "", "createdAt": now})
        conn.commit()
        return self.send(handler, 201, {"cards": made})

    def claim_card(self, handler, conn, code):
        student = self.student_from_claim(self.read_json(handler))
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT status FROM cards WHERE code = ?", (code,)).fetchone()
        if not row:
            conn.rollback()
            return self.send(handler, 404, {"error": "That code is not a Grace card."})
        if row["status"] == "retired":
            conn.rollback()
            return self.send(handler, 409, {"error": "That card was retired."})
        if row["status"] != "unclaimed":
            conn.rollback()
            return self.send(handler, 409, {"error": "That card is already linked to a student."})
        now = iso(utcnow())
        conn.execute(
            "INSERT INTO students (id, name, age, belt, stripes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (student["id"], student["name"], student["age"], student["belt"], student["stripes"], now),
        )
        conn.execute(
            """
            UPDATE cards
            SET status = 'claimed', student_id = ?, claimed_at = ?
            WHERE code = ? AND status = 'unclaimed'
            """,
            (student["id"], now, code),
        )
        if conn.execute("SELECT changes()").fetchone()[0] != 1:
            conn.rollback()
            return self.send(handler, 409, {"error": "That card is already linked to a student."})
        conn.commit()
        card = conn.execute("SELECT * FROM cards WHERE code = ?", (code,)).fetchone()
        return self.send(handler, 201, {"student": student, "card": self.card_json(card)})

    def retire_card(self, handler, conn, code):
        row = conn.execute("SELECT * FROM cards WHERE code = ?", (code,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That code is not a Grace card."})
        now = iso(utcnow())
        conn.execute(
            "UPDATE cards SET status = 'retired', retired_at = ? WHERE code = ?",
            (now, code),
        )
        conn.commit()
        card = conn.execute("SELECT * FROM cards WHERE code = ?", (code,)).fetchone()
        return self.send(handler, 200, {"card": self.card_json(card)})

    def relink_card(self, handler, conn, code):
        body = self.read_json(handler)
        sid = clean_id(body.get("studentId"))
        if not sid or not conn.execute("SELECT 1 FROM students WHERE id = ?", (sid,)).fetchone():
            raise ValueError("Choose a student on the roster.")
        row = conn.execute("SELECT * FROM cards WHERE code = ?", (code,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That code is not a Grace card."})
        now = iso(utcnow())
        conn.execute(
            """
            UPDATE cards
            SET status = 'claimed', student_id = ?, claimed_at = COALESCE(claimed_at, ?), retired_at = NULL
            WHERE code = ?
            """,
            (sid, now, code),
        )
        conn.commit()
        card = conn.execute("SELECT * FROM cards WHERE code = ?", (code,)).fetchone()
        return self.send(handler, 200, {"card": self.card_json(card)})

    def save_sheet(self, handler, conn):
        body = self.read_json(handler)
        title = clip(body.get("title"), 80) or "Coloring sheet"
        caption = clip(body.get("caption"), 160)
        theme = clip(body.get("theme"), 32).lower()
        client_id = clean_id(body.get("clientId")) or None
        published = 1 if body.get("published") else 0
        blob, ext = self.decode_image(body.get("image"))
        existing = None
        if client_id:
            existing = conn.execute("SELECT * FROM sheets WHERE client_id = ?", (client_id,)).fetchone()
        sid = existing["id"] if existing else new_id("p-")
        filename = sid + ext
        path = os.path.join(self.cfg["sheets_dir"], filename)
        tmp = path + ".tmp"
        with open(tmp, "wb") as handle:
            handle.write(blob)
        os.replace(tmp, path)
        if existing and existing["filename"] != filename:
            old = os.path.join(self.cfg["sheets_dir"], os.path.basename(existing["filename"]))
            if os.path.isfile(old):
                os.remove(old)
        conn.execute(
            """
            INSERT INTO sheets (id, client_id, title, caption, theme, filename, published, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              caption = excluded.caption,
              theme = excluded.theme,
              filename = excluded.filename,
              published = excluded.published
            """,
            (sid, client_id, title, caption, theme, filename, published, iso(utcnow())),
        )
        conn.commit()
        return self.send(
            handler,
            200,
            {"id": sid, "clientId": client_id or "", "title": title, "caption": caption, "theme": theme, "published": bool(published)},
        )

    def import_local(self, handler, conn, admin):
        body = self.read_json(handler)
        roster = body.get("roster") if isinstance(body.get("roster"), list) else []
        progress = body.get("progress") if isinstance(body.get("progress"), dict) else {}
        stripe = progress.get("stripe") if isinstance(progress.get("stripe"), dict) else {}
        if not admin and ("own" in stripe or "attend" in stripe):
            return self.send(handler, 403, {"error": "Only an admin can change the stripe hint."})
        if not admin and roster:
            return self.send(handler, 403, {"error": "An admin imports the roster. Teachers can import attendance after that."})
        id_map = {}
        confirm = body.get("confirmOverCap") is True
        before = None
        if admin and roster:
            self.lock_kids(conn)
            before = self.kids_enrolled_count(conn)
        for raw in roster[:200]:
            if not isinstance(raw, dict):
                continue
            student = self.sanitize_student(raw, clean_id(raw.get("id")) or None)
            id_map[raw.get("id")] = student["id"]
            conn.execute(
                """
                INSERT INTO students (id, name, age, belt, stripes, created_at) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET name = excluded.name, age = excluded.age, belt = excluded.belt, stripes = excluded.stripes
                """,
                (student["id"], student["name"], student["age"], student["belt"], student["stripes"], iso(utcnow())),
            )
        for entry in (progress.get("classes") or [])[:400]:
            if not isinstance(entry, dict):
                continue
            attended = []
            for sid in entry.get("attended") or []:
                mapped = id_map.get(sid, sid)
                clean = clean_id(mapped)
                if clean:
                    attended.append(clean)
            try:
                saved = self.sanitize_class({**entry, "attended": attended})
            except ValueError:
                continue
            self.save_class(conn, saved, merge=True)
        levels = progress.get("levels") if isinstance(progress.get("levels"), dict) else {}
        for sid, tech_levels in levels.items():
            mapped = clean_id(id_map.get(sid, sid))
            if not mapped or not isinstance(tech_levels, dict):
                continue
            for tid, level in tech_levels.items():
                tech = clean_id(tid)
                if tech and level in LEVELS:
                    conn.execute(
                        """
                        INSERT INTO levels (student_id, tech_id, level) VALUES (?, ?, ?)
                        ON CONFLICT(student_id, tech_id) DO NOTHING
                        """,
                        (mapped, tech, level),
                    )
        notes = progress.get("notes") if isinstance(progress.get("notes"), dict) else {}
        for sid, note in notes.items():
            mapped = clean_id(id_map.get(sid, sid))
            text = clip(note, 800)
            if mapped and text:
                conn.execute(
                    "INSERT INTO notes (student_id, note) VALUES (?, ?) ON CONFLICT(student_id) DO NOTHING",
                    (mapped, text),
                )
        stripe = progress.get("stripe") if isinstance(progress.get("stripe"), dict) else {}
        if admin and ("own" in stripe or "attend" in stripe):
            try:
                own = max(1, min(40, int(stripe.get("own", 6))))
                attend = max(1, min(40, int(stripe.get("attend", 8))))
            except (TypeError, ValueError):
                own, attend = 6, 8
            self.put_setting(conn, "stripe_own", str(own))
            self.put_setting(conn, "stripe_attend", str(attend))
        if before is not None:
            blocked = self.over_cap(conn, before)
            if blocked and not confirm:
                after, cap = blocked
                conn.rollback()
                return self.send(
                    handler,
                    409,
                    {
                        "error": f"This import would pass the kids class size of {cap}. {after} of {cap} would be enrolled.",
                        "needsConfirm": True,
                        "enrolled": before,
                        "cap": cap,
                    },
                )
        conn.commit()
        return self.send(handler, 200, {"ok": True, "students": len(id_map), "kidsEnrollment": self.enrollment_snapshot(conn)})

    def security_headers(self, handler):
        handler.send_header("X-Content-Type-Options", "nosniff")
        handler.send_header("X-Frame-Options", "SAMEORIGIN")
        handler.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        handler.send_header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
        handler.send_header(
            "Content-Security-Policy",
            "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; "
            "form-action 'self'; img-src 'self' data: https://i.ytimg.com; font-src 'self'; "
            "style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; "
            "frame-src https://www.youtube-nocookie.com; connect-src 'self'",
        )

    def csv_cell(self, value):
        text = "" if value is None else str(value)
        if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
            text = "'" + text
        if any(ch in text for ch in '",\n\r'):
            text = '"' + text.replace('"', '""') + '"'
        return text

    def waiver_submissions_enabled(self):
        forced = self.cfg.get("waiver_submissions_enabled", None)
        if forced is not None:
            return bool(forced)
        paths = []
        root = self.cfg.get("static_root") or ""
        if root:
            paths.append(os.path.join(root, "waiver-config.json"))
        paths.append(os.path.join(os.getcwd(), "waiver-config.json"))
        for path in paths:
            try:
                with open(path, encoding="utf-8") as handle:
                    data = json.load(handle)
            except (OSError, json.JSONDecodeError, TypeError):
                continue
            if isinstance(data, dict):
                return data.get("waiverSubmissionsEnabled") is True
        return False

    def allow_waiver_post(self, ip):
        now = utcnow().timestamp()
        posts = [item for item in self._waiver_posts if now - item[0] < 3600]
        count = sum(1 for item in posts if item[1] == ip)
        if count >= 10:
            self._waiver_posts = posts
            return False
        posts.append((now, ip))
        self._waiver_posts = posts
        return True

    def waiver_age(self, dob):
        text = clip(dob, 10)
        try:
            born = datetime.strptime(text, "%Y-%m-%d").date()
        except ValueError as err:
            raise ValueError("Enter a date of birth.") from err
        if born.isoformat() != text or born.year < 1900:
            raise ValueError("Enter a date of birth.")
        today = datetime.strptime(today_pacific(), "%Y-%m-%d").date()
        if born > today:
            raise ValueError("Enter a date of birth.")
        age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
        return text, age

    def waiver_png(self, data_url, required):
        text = str(data_url or "")
        if not text:
            if required:
                raise ValueError("Draw a signature.")
            return ""
        blob, ext = self.decode_image(text)
        if ext != ".png" or not blob.startswith(b"\x89PNG"):
            raise ValueError("Draw the signature in the box.")
        return "data:image/png;base64," + base64.b64encode(blob).decode("ascii")

    def waiver_phone(self, value, label):
        text = clip(value, 40)
        if sum(ch.isdigit() for ch in text) < 7:
            raise ValueError("Enter a " + label + ".")
        return text

    def norm_name(self, value):
        return " ".join(str(value or "").casefold().split())

    def clean_dob(self, value):
        text = clip(str(value or ""), 10)
        if not re.match(r"^\d{4}-\d{2}-\d{2}$", text):
            return ""
        try:
            born = datetime.strptime(text, "%Y-%m-%d").date()
        except ValueError:
            return ""
        if born.isoformat() != text or born.year < 1900:
            return ""
        return text

    def counts_as_kid(self, age):
        try:
            number = int(age)
        except (TypeError, ValueError):
            return False
        return 3 <= number <= 10

    def kids_cap(self, conn):
        try:
            cap = int(str(self.setting(conn, "kids_cap", str(DEFAULT_KIDS_CAP))).strip())
        except (TypeError, ValueError):
            cap = DEFAULT_KIDS_CAP
        return max(1, min(200, cap))

    def waiver_years(self, dob):
        try:
            _text, age = self.waiver_age(dob)
        except ValueError:
            return None
        return age

    def kids_enrolled_count(self, conn):
        students = list(conn.execute("SELECT id, name, age, dob FROM students"))
        roster_ids = {row["id"] for row in students}
        kid_keys = set()
        kid_count = 0
        for row in students:
            if not self.counts_as_kid(row["age"]):
                continue
            kid_count += 1
            dob = self.cell(row, "dob", "") or ""
            if dob:
                kid_keys.add((self.norm_name(row["name"]), dob))
        pending = 0
        waivers = conn.execute(
            """
            SELECT participant_name, dob, added_to_roster, roster_student_id
            FROM waivers WHERE kind = 'kids'
            """
        ).fetchall()
        for row in waivers:
            if int(row["added_to_roster"] or 0):
                continue
            linked = row["roster_student_id"] or ""
            if linked and linked in roster_ids:
                continue
            if not self.counts_as_kid(self.waiver_years(row["dob"])):
                continue
            if (self.norm_name(row["participant_name"]), row["dob"]) in kid_keys:
                continue
            pending += 1
        return kid_count + pending

    def enrollment_snapshot(self, conn):
        cap = self.kids_cap(conn)
        enrolled = self.kids_enrolled_count(conn)
        return {
            "cap": cap,
            "enrolled": enrolled,
            "spotsOpen": max(0, cap - enrolled),
            "full": enrolled >= cap,
            "submissionsEnabled": self.waiver_submissions_enabled(),
        }

    def public_kids_enrollment(self, handler):
        conn = self.db()
        try:
            return self.send(handler, 200, self.enrollment_snapshot(conn))
        finally:
            conn.close()

    def lock_kids(self, conn):
        conn.commit()
        conn.execute("BEGIN IMMEDIATE")

    def over_cap(self, conn, before):
        after = self.kids_enrolled_count(conn)
        cap = self.kids_cap(conn)
        if after > before and after > cap:
            return after, cap
        return None

    def cap_confirm_body(self, before, after, cap):
        return {
            "error": f"This would be past the kids class size of {cap}. {after} of {cap} would be enrolled.",
            "needsConfirm": True,
            "enrolled": before,
            "cap": cap,
        }

    def remember_dob(self, conn, student_id, dob):
        if not student_id or not dob:
            return
        current = conn.execute("SELECT dob FROM students WHERE id = ?", (student_id,)).fetchone()
        if current and not (current["dob"] or ""):
            conn.execute("UPDATE students SET dob = ? WHERE id = ?", (dob, student_id))

    def link_waiver_row(self, conn, wid, student_id):
        conn.execute(
            "UPDATE waivers SET added_to_roster = 1, roster_student_id = ? WHERE id = ?",
            (student_id or "", wid),
        )

    def match_kid(self, conn, name, dob):
        if not dob:
            return None
        target = self.norm_name(name)
        for row in conn.execute("SELECT id, name, age, dob FROM students"):
            if not self.counts_as_kid(row["age"]):
                continue
            if (row["dob"] or "") == dob and self.norm_name(row["name"]) == target:
                return row
        return None

    def attach_new_waiver(self, conn, wid, name, dob, age):
        if not self.counts_as_kid(age):
            return
        match = self.match_kid(conn, name, dob)
        if match:
            self.link_waiver_row(conn, wid, match["id"])

    def link_student_forms(self, conn, student_id, name, age, dob, waiver_id=""):
        if waiver_id:
            row = conn.execute(
                "SELECT id, kind, dob FROM waivers WHERE id = ?",
                (waiver_id,),
            ).fetchone()
            if row and row["kind"] == "kids":
                if not dob:
                    dob = row["dob"] or ""
                    self.remember_dob(conn, student_id, dob)
                self.link_waiver_row(conn, row["id"], student_id)
        if not dob or not self.counts_as_kid(age):
            return
        target = self.norm_name(name)
        rows = conn.execute(
            "SELECT id, participant_name, dob FROM waivers WHERE kind = 'kids' AND added_to_roster = 0"
        ).fetchall()
        for row in rows:
            if (row["dob"] or "") == dob and self.norm_name(row["participant_name"]) == target:
                self.link_waiver_row(conn, row["id"], student_id)
                self.remember_dob(conn, student_id, dob)

    def unlink_student_forms(self, conn, student_id):
        conn.execute(
            "UPDATE waivers SET added_to_roster = 0, roster_student_id = '' WHERE roster_student_id = ?",
            (student_id,),
        )

    def student_payload(self, conn, sid):
        row = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        body = self.student_json(row)
        body["kidsEnrollment"] = self.enrollment_snapshot(conn)
        return body

    def add_student(self, handler, conn):
        body = self.read_json(handler)
        raw = self.sanitize_student(body)
        dob = self.clean_dob(body.get("dob"))
        confirm = body.get("confirmOverCap") is True
        waiver_id = clean_id(body.get("waiverId")) or ""
        adding = self.counts_as_kid(raw["age"])
        before = None
        if adding:
            self.lock_kids(conn)
            before = self.kids_enrolled_count(conn)
        conn.execute(
            "INSERT INTO students (id, name, age, belt, stripes, created_at, dob) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (raw["id"], raw["name"], raw["age"], raw["belt"], raw["stripes"], iso(utcnow()), dob),
        )
        self.link_student_forms(conn, raw["id"], raw["name"], raw["age"], dob, waiver_id)
        if adding:
            blocked = self.over_cap(conn, before)
            if blocked and not confirm:
                after, cap = blocked
                conn.rollback()
                return self.send(handler, 409, self.cap_confirm_body(before, after, cap))
        conn.commit()
        return self.send(handler, 201, self.student_payload(conn, raw["id"]))

    def patch_student(self, handler, conn, sid):
        old = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        if not old:
            return self.send(handler, 404, {"error": "That student is not on the roster."})
        body = self.read_json(handler)
        raw = self.sanitize_student(body, sid)
        dob = old["dob"] or ""
        if "dob" in body:
            dob = self.clean_dob(body.get("dob"))
        confirm = body.get("confirmOverCap") is True
        growing = self.counts_as_kid(raw["age"]) and not self.counts_as_kid(old["age"])
        before = None
        if growing:
            self.lock_kids(conn)
            before = self.kids_enrolled_count(conn)
        conn.execute(
            "UPDATE students SET name = ?, age = ?, belt = ?, stripes = ?, dob = ? WHERE id = ?",
            (raw["name"], raw["age"], raw["belt"], raw["stripes"], dob, sid),
        )
        self.link_student_forms(conn, sid, raw["name"], raw["age"], dob, "")
        if growing:
            blocked = self.over_cap(conn, before)
            if blocked and not confirm:
                after, cap = blocked
                conn.rollback()
                return self.send(handler, 409, self.cap_confirm_body(before, after, cap))
        conn.commit()
        return self.send(handler, 200, self.student_payload(conn, sid))

    def delete_student(self, handler, conn, sid):
        self.lock_kids(conn)
        self.unlink_student_forms(conn, sid)
        conn.execute("DELETE FROM students WHERE id = ?", (sid,))
        conn.execute("DELETE FROM levels WHERE student_id = ?", (sid,))
        conn.execute("DELETE FROM notes WHERE student_id = ?", (sid,))
        conn.execute(
            "UPDATE cards SET status = 'retired', retired_at = ? WHERE student_id = ? AND status != 'retired'",
            (iso(utcnow()), sid),
        )
        conn.commit()
        return self.send(handler, 200, {"ok": True, "kidsEnrollment": self.enrollment_snapshot(conn)})

    def save_kids_cap(self, handler, conn):
        body = self.read_json(handler)
        try:
            cap = int(body.get("cap"))
        except (TypeError, ValueError):
            raise ValueError("Enter a kids class size from 1 to 200.") from None
        if cap < 1 or cap > 200:
            raise ValueError("Enter a kids class size from 1 to 200.")
        self.put_setting(conn, "kids_cap", str(cap))
        conn.commit()
        return self.send(handler, 200, self.enrollment_snapshot(conn))

    def mark_waiver_on_roster(self, handler, conn, wid):
        length = int(handler.headers.get("Content-Length") or 0)
        body = self.read_json(handler) if length else {}
        row = conn.execute("SELECT * FROM waivers WHERE id = ?", (wid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That enrollment form is not on file."})
        if row["kind"] != "kids":
            raise ValueError("Only a kids form is tied to the kids roster.")
        student_id = clean_id(body.get("studentId")) or ""
        if student_id:
            student = conn.execute("SELECT id FROM students WHERE id = ?", (student_id,)).fetchone()
            if not student:
                return self.send(handler, 404, {"error": "That student is not on the roster."})
        else:
            match = self.match_kid(conn, row["participant_name"], row["dob"])
            student_id = match["id"] if match else ""
        if student_id:
            self.remember_dob(conn, student_id, row["dob"])
        self.link_waiver_row(conn, wid, student_id)
        conn.commit()
        return self.send(
            handler,
            200,
            {
                "ok": True,
                "addedToRoster": True,
                "rosterStudentId": student_id,
                "kidsEnrollment": self.enrollment_snapshot(conn),
            },
        )

    def submit_waiver(self, handler):
        if not self.waiver_submissions_enabled():
            return self.send(handler, 403, {"error": "Do not submit yet. Enrollment is not open."})
        if not self.allow_waiver_post(self.client_ip(handler)):
            return self.send(handler, 429, {"error": "Too many enrollment tries. Wait and try again."})
        body = self.read_json(handler)
        kind = body.get("kind")
        if kind not in ("adult", "kids"):
            raise ValueError("Choose the adult or kids enrollment form.")
        name = clip(body.get("participantName"), 120)
        if len(name) < 2:
            raise ValueError("Enter a name.")
        address = clip(body.get("address"), 300)
        if len(address) < 4:
            raise ValueError("Enter an address.")
        email = clip(body.get("email"), 160)
        if not EMAIL_RE.match(email):
            raise ValueError("Enter an email address.")
        phone = self.waiver_phone(body.get("phone"), "phone number")
        dob, age = self.waiver_age(body.get("dob"))
        if kind == "adult" and age < 11:
            raise ValueError("This enrollment is for ages 11 and up.")
        goals = body.get("goals") or []
        if not isinstance(goals, list) or any(goal not in WAIVER_GOALS for goal in goals):
            raise ValueError("Choose goals from the list.")
        emergency_name = clip(body.get("emergencyName"), 120)
        if len(emergency_name) < 2:
            raise ValueError("Enter an emergency contact name.")
        emergency_phone = self.waiver_phone(body.get("emergencyPhone"), "emergency contact phone")
        parent_name = clip(body.get("parentName"), 120)
        typed = clip(body.get("typedName"), 120)
        printed = clip(body.get("printName"), 120)
        if len(typed) < 2 or len(printed) < 2:
            raise ValueError("Sign and print your name.")
        minor = kind == "adult" and age < 18
        if kind == "kids" and len(parent_name) < 2:
            raise ValueError("Enter the parent or guardian name.")
        if minor and len(parent_name) < 2:
            raise ValueError("Enter the parent or guardian name.")
        parent_typed = clip(body.get("parentTypedName"), 120)
        parent_printed = clip(body.get("parentPrintName"), 120)
        if minor and (len(parent_typed) < 2 or len(parent_printed) < 2):
            raise ValueError("A parent or guardian must sign and print their name.")
        signature = self.waiver_png(body.get("signature"), True)
        parent_signature = self.waiver_png(body.get("parentSignature"), minor)
        injuries = clip(body.get("injuries"), 2000) if kind == "kids" else ""
        payload = {
            "address": address,
            "parentName": parent_name,
            "goals": goals,
            "emergencyName": emergency_name,
            "emergencyPhone": emergency_phone,
            "injuries": injuries,
            "typedName": typed,
            "printName": printed,
            "parentTypedName": parent_typed if minor else "",
            "parentPrintName": parent_printed if minor else "",
            "age": age,
        }
        wid = new_id("w-")
        signed_on = today_pacific()
        conn = self.db()
        try:
            self.lock_kids(conn)
            before = self.kids_enrolled_count(conn) if kind == "kids" else None
            conn.execute(
                """
                INSERT INTO waivers (
                  id, kind, submitted_at, signed_on, participant_name, signer_name,
                  dob, email, phone, payload_json, signature_png, parent_signature_png
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    wid,
                    kind,
                    iso(utcnow()),
                    signed_on,
                    name,
                    printed,
                    dob,
                    email,
                    phone,
                    json.dumps(payload),
                    signature,
                    parent_signature,
                ),
            )
            if kind == "kids":
                self.attach_new_waiver(conn, wid, name, dob, age)
                blocked = self.over_cap(conn, before)
                if blocked:
                    conn.rollback()
                    return self.send(handler, 409, {"error": KIDS_FULL, "full": True})
            conn.commit()
        finally:
            conn.close()
        return self.send(handler, 201, {"id": wid, "signedOn": signed_on})

    def waiver_summary(self, row):
        return {
            "id": row["id"],
            "kind": row["kind"],
            "submittedAt": row["submitted_at"],
            "signedOn": row["signed_on"],
            "participantName": row["participant_name"],
            "signerName": row["signer_name"],
            "dob": row["dob"],
            "email": row["email"],
            "phone": row["phone"],
            "addedToRoster": bool(int(self.cell(row, "added_to_roster", 0) or 0)),
            "rosterStudentId": self.cell(row, "roster_student_id", "") or "",
        }

    def list_waivers(self, handler, conn):
        rows = conn.execute(
            """
            SELECT id, kind, submitted_at, signed_on, participant_name, signer_name, dob, email, phone,
                   added_to_roster, roster_student_id
            FROM waivers ORDER BY submitted_at DESC
            """
        ).fetchall()
        return self.send(handler, 200, {"waivers": [self.waiver_summary(row) for row in rows]})

    def waiver_detail(self, handler, conn, wid):
        row = conn.execute("SELECT * FROM waivers WHERE id = ?", (wid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That enrollment form is not on file."})
        try:
            payload = json.loads(row["payload_json"])
        except json.JSONDecodeError:
            payload = {}
        body = self.waiver_summary(row)
        body["payload"] = payload
        body["signature"] = row["signature_png"]
        body["parentSignature"] = row["parent_signature_png"]
        return self.send(handler, 200, body)

    def waivers_csv(self, conn):
        rows = [[
            "id", "kind", "submitted_at", "signed_on", "participant_name", "dob",
            "email", "phone", "address", "parent_name", "emergency_name", "emergency_phone",
            "goals", "injuries", "print_name", "parent_print_name", "signature", "parent_signature",
            "added_to_roster",
        ]]
        for row in conn.execute("SELECT * FROM waivers ORDER BY submitted_at"):
            try:
                payload = json.loads(row["payload_json"])
            except json.JSONDecodeError:
                payload = {}
            goals = payload.get("goals") or []
            rows.append([
                row["id"],
                row["kind"],
                row["submitted_at"],
                row["signed_on"],
                row["participant_name"],
                row["dob"],
                row["email"],
                row["phone"],
                payload.get("address", ""),
                payload.get("parentName", ""),
                payload.get("emergencyName", ""),
                payload.get("emergencyPhone", ""),
                ", ".join(goals) if isinstance(goals, list) else "",
                payload.get("injuries", ""),
                payload.get("printName", ""),
                payload.get("parentPrintName", ""),
                "yes" if row["signature_png"] else "no",
                "yes" if row["parent_signature_png"] else "no",
                "yes" if int(self.cell(row, "added_to_roster", 0) or 0) else "no",
            ])
        return rows

    def roster_csv(self, conn):
        rows = [["name", "age", "belt", "stripes"]]
        for row in conn.execute("SELECT name, age, belt, stripes FROM students ORDER BY name COLLATE NOCASE"):
            rows.append([row["name"], row["age"], row["belt"], row["stripes"]])
        return rows

    def attendance_csv(self, conn):
        names = {row["id"]: row["name"] for row in conn.execute("SELECT id, name FROM students")}
        rows = [["date", "age_group", "theme", "taught", "student"]]
        for row in conn.execute("SELECT date, age_group, theme, theme_label, attended, taught FROM classes ORDER BY date, age_group"):
            theme = row["theme_label"] or row["theme"] or ""
            taught = "yes" if row["taught"] else "no"
            attended = []
            for sid in self.json_list(row["attended"]):
                if sid in names:
                    attended.append(names[sid])
            if not attended:
                rows.append([row["date"], row["age_group"], theme, taught, ""])
                continue
            for name in attended:
                rows.append([row["date"], row["age_group"], theme, taught, name])
        return rows

    def send_csv(self, handler, filename, rows):
        raw = ("\r\n".join(",".join(self.csv_cell(cell) for cell in row) for row in rows) + "\r\n").encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", "text/csv; charset=utf-8")
        handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        handler.send_header("Content-Length", str(len(raw)))
        handler.send_header("Cache-Control", "no-store")
        self.security_headers(handler)
        handler.end_headers()
        if handler.command != "HEAD" and not getattr(handler, "_bjj_head", False):
            handler.wfile.write(raw)

    def send(self, handler, status, body, set_cookie=None, clear_cookie=False):
        raw = json.dumps(body).encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(raw)))
        handler.send_header("Cache-Control", "no-store")
        self.security_headers(handler)
        if set_cookie:
            handler.send_header("Set-Cookie", self.cookie(set_cookie, SESSION_DAYS * 86400))
        if clear_cookie:
            handler.send_header("Set-Cookie", self.cookie("", 0))
        handler.end_headers()
        if not getattr(handler, "_bjj_head", False):
            handler.wfile.write(raw)

    def cookie(self, token, max_age):
        parts = [f"bjj_session={token}", "HttpOnly", "SameSite=Lax", "Path=/", f"Max-Age={max_age}"]
        if self.cfg["secure"]:
            parts.append("Secure")
        return "; ".join(parts)

    def static_cache_control(self, rel):
        path = (rel or "").split("?", 1)[0]
        if path in ("/app/manifest.webmanifest", "/app/offline.html", "/sw.js", "/manifest.webmanifest") or path.endswith(".webmanifest") or os.path.basename(path) == "sw.js":
            return "no-cache"
        gated = (
            path.startswith("/js/")
            or path.startswith("/vendor/")
            or path.startswith("/app/")
            or path == "/css/styles.css"
        )
        if gated:
            return "private, no-store"
        ext = os.path.splitext(path)[1].lower()
        if ext in (".html", ".js", ".css") or path.endswith("/") or path in ("", "/"):
            return "no-cache"
        return ""

    def serve_static(self, handler, path):
        root = os.path.realpath(self.cfg["static_root"])
        rel = path.split("?", 1)[0]
        if rel.endswith("/"):
            rel += "index.html"
        if rel == "":
            rel = "/index.html"
        target = os.path.realpath(os.path.join(root, rel.lstrip("/")))
        if not target.startswith(root + os.sep) and target != root:
            return self.send(handler, 403, {"error": "No."})
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            handler.send_response(404)
            handler.send_header("Content-Type", "text/plain; charset=utf-8")
            handler.send_header("Cache-Control", "no-store")
            self.security_headers(handler)
            handler.end_headers()
            if not getattr(handler, "_bjj_head", False):
                handler.wfile.write(b"Not found")
            return
        ext = os.path.splitext(target)[1].lower()
        ctype = {
            ".html": "text/html; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".js": "text/javascript; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".svg": "image/svg+xml",
            ".gif": "image/gif",
            ".ttf": "font/ttf",
            ".json": "application/json",
            ".ico": "image/x-icon",
            ".webmanifest": "application/manifest+json",
            ".ics": "text/calendar; charset=utf-8",
        }.get(ext, "application/octet-stream")
        with open(target, "rb") as handle:
            blob = handle.read()
        handler.send_response(200)
        handler.send_header("Content-Type", ctype)
        handler.send_header("Content-Length", str(len(blob)))
        cache = self.static_cache_control(rel)
        if cache:
            handler.send_header("Cache-Control", cache)
        self.security_headers(handler)
        handler.end_headers()
        if handler.command != "HEAD" and not getattr(handler, "_bjj_head", False):
            handler.wfile.write(blob)
