"""JSON API for roster, attendance, and progress. No student data is written to the repo."""

import base64
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timedelta
from urllib.parse import parse_qs, unquote, urlparse

import bcrypt

from server.db import (
    ADULT_BELTS,
    AGE_GROUP_AGES,
    BELTS,
    LEVELS,
    canonical_level,
    age_group_for_age,
    cleanup,
    connect,
    is_adult_class_day,
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
SKIP_REASONS = ("time", "different", "needed", "other")
SKIP_REASON_LABELS = {
    "time": "Ran out of time",
    "different": "Class ran differently",
    "needed": "Kids needed something else",
    "other": "Other",
}
LOGIN_LIMIT = 8
LOGIN_WINDOW_MIN = 15
SESSION_DAYS = 14
DEFAULT_KIDS_CAP = 12
KIDS_FULL = (
    "Kids class is full right now. Email dits+bjj@mail.grokbot.com to ask about the next opening."
)
PARENT_COOKIE = "bjj_parent"
PARENT_GRANT_SECONDS = 7200
PARENT_MISS = "Those details don't match."
PARENT_INCOMPLETE = "Ask a teacher to finish this card."
PARENT_LIMIT = "Too many tries. Wait and try again."


def env_optional_bool(name):
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return None
    return raw == "1"


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
        "cookie_name": os.environ.get("BJJ_COOKIE_NAME", "bjj_session"),
        "cookie_path": os.environ.get("BJJ_COOKIE_PATH", "/"),
        # None means "read waiver-config.json". The demo unit sets these to 1.
        # Production does not set them, so the committed file stays in charge.
        "waiver_submissions_enabled": env_optional_bool("BJJ_WAIVER_SUBMISSIONS"),
        "waitlist_enabled": env_optional_bool("BJJ_WAITLIST"),
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
        self._waitlist_posts = []
        self._parent_fails = []
        self._parent_grants = {}

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

    def cookie_name(self):
        name = str(self.cfg.get("cookie_name") or "bjj_session")
        if not re.fullmatch(r"[A-Za-z0-9_]{1,64}", name):
            return "bjj_session"
        return name

    def cookie_path(self):
        path = str(self.cfg.get("cookie_path") or "/")
        if not path.startswith("/") or path.startswith("//") or re.search(r"[\s;,]", path):
            return "/"
        return path

    def cookie_token(self, handler):
        header = handler.headers.get("Cookie", "")
        want = self.cookie_name()
        for part in header.split(";"):
            name, _, value = part.strip().partition("=")
            if name == want and value:
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

    def student_json(self, row, conn=None):
        waiver = (
            self.waiver_for_student(conn, row["id"])
            if conn is not None
            else {"signed": False, "signedOn": "", "signerName": "", "waiverId": ""}
        )
        pin_hash = self.cell(row, "card_pin_hash", "") or ""
        body = {
            "id": row["id"],
            "name": row["name"],
            "age": row["age"],
            "belt": row["belt"],
            "stripes": row["stripes"],
            "dob": self.cell(row, "dob", "") or "",
            "program": self.cell(row, "program", "") or "kids",
            "parentToken": self.cell(row, "parent_token", "") or "",
            "pinSet": bool(pin_hash),
            "waiver": waiver,
        }
        if conn is not None:
            body["staffLink"] = self.staff_link_for_student(conn, row["id"])
        return body

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

    def sanitize_adult(self, raw, existing_id=None):
        name = clip(raw.get("name"), 40)
        if not name:
            raise ValueError("Add the student's name.")
        try:
            age = int(raw.get("age"))
        except (TypeError, ValueError):
            age = 18
        age = max(11, min(120, age))
        belt = self.adult_belt_value(raw)
        stripes = self.stripe_value(raw.get("stripes")) if "stripes" in raw and raw.get("stripes") not in (None, "") else 0
        sid = clean_id(existing_id or raw.get("id")) or new_id("s-")
        return {"id": sid, "name": name, "age": age, "belt": belt, "stripes": stripes, "program": "adult"}

    def adult_belt_value(self, raw):
        if "belt" not in raw or raw.get("belt") in (None, ""):
            return "white"
        belt = raw.get("belt")
        if belt not in ADULT_BELTS:
            raise ValueError("Adult belts are white, blue, purple, brown, or black.")
        return belt

    def stripe_value(self, value):
        if isinstance(value, bool) or isinstance(value, float):
            raise ValueError("Stripes are 0 through 4.")
        if isinstance(value, str):
            if not re.fullmatch(r"[0-4]", value.strip()):
                raise ValueError("Stripes are 0 through 4.")
            return int(value.strip())
        if isinstance(value, int) and 0 <= value <= 4:
            return value
        raise ValueError("Stripes are 0 through 4.")

    def staff_link_for_student(self, conn, student_id):
        row = conn.execute(
            """
            SELECT users.id AS user_id, users.username AS username, staff.name AS staff_name
            FROM staff_member_links
            JOIN users ON users.id = staff_member_links.user_id
            LEFT JOIN staff ON staff.user_id = users.id
            WHERE staff_member_links.student_id = ?
            """,
            (student_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "userId": row["user_id"],
            "username": row["username"],
            "displayName": self.display_staff_name(row["staff_name"], row["username"]),
        }

    def member_for_user(self, conn, user_id):
        row = conn.execute(
            """
            SELECT students.id AS student_id, students.name AS student_name
            FROM staff_member_links
            JOIN students ON students.id = staff_member_links.student_id
            WHERE staff_member_links.user_id = ?
            """,
            (user_id,),
        ).fetchone()
        if not row:
            return "", ""
        return row["student_id"], row["student_name"]

    def linked_student_id(self, conn, user_id):
        row = conn.execute(
            "SELECT student_id FROM staff_member_links WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return row["student_id"] if row else ""

    def block_self_edit(self, handler, conn, user, student_id):
        if student_id and self.linked_student_id(conn, user["id"]) == student_id:
            self.send(handler, 403, {"error": "Ask another staff member to update your record."})
            return True
        return False

    def sole_admin(self, conn, user):
        if not user or user.get("role") != "admin":
            return False
        count = conn.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").fetchone()["n"]
        return count == 1

    def block_own_link(self, handler, conn, actor, target_user_id):
        if actor["id"] != target_user_id:
            return False
        if self.sole_admin(conn, actor):
            return False
        self.send(handler, 403, {"error": "Another admin has to link your own login."})
        return True

    def append_change(self, conn, user, student_id, student_name, action, before, after):
        conn.execute(
            """
            INSERT INTO change_log (at, actor_id, actor_name, student_id, student_name, action, before_json, after_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                iso(utcnow()),
                user["id"],
                self.display_name_for_user(conn, user),
                student_id or "",
                student_name or "",
                action,
                json.dumps(before, ensure_ascii=False, separators=(",", ":")),
                json.dumps(after, ensure_ascii=False, separators=(",", ":")),
            ),
        )

    def format_pacific(self, value):
        when = parse_iso(value)
        if not when:
            return ""
        try:
            from zoneinfo import ZoneInfo

            local = when.astimezone(ZoneInfo("America/Los_Angeles"))
        except Exception:
            local = when
        hour = local.strftime("%I").lstrip("0") or "12"
        return f"{local.strftime('%b')} {local.day}, {local.year}, {hour}:{local.strftime('%M %p')} PT"

    def change_json(self, row):
        def parsed(text):
            try:
                value = json.loads(text or "null")
            except json.JSONDecodeError:
                return None
            return value

        return {
            "id": row["id"],
            "at": row["at"],
            "atPt": self.format_pacific(row["at"]),
            "actorId": row["actor_id"],
            "actorName": row["actor_name"],
            "studentId": row["student_id"],
            "studentName": row["student_name"],
            "action": row["action"],
            "before": parsed(row["before_json"]),
            "after": parsed(row["after_json"]),
        }

    def _truthy_flag(self, value):
        return value is True or value == 1

    def sanitize_techniques(self, raw):
        planned = []
        off_script = []
        if not isinstance(raw, list):
            return []
        for item in raw:
            if not isinstance(item, dict):
                continue
            tid = clean_id(item.get("id"))
            name = clip(item.get("name"), 80)
            if not tid or not name:
                continue
            base = {
                "id": tid,
                "name": name,
                "position": clip(item.get("position"), 40),
                "theme": clip(item.get("theme"), 32).lower(),
            }
            if self._truthy_flag(item.get("offScript")):
                if len(off_script) >= 8:
                    continue
                note = clip(item.get("note"), 160)
                row = dict(base)
                row["offScript"] = True
                if note:
                    row["note"] = note
                off_script.append(row)
                continue
            if len(planned) >= 12:
                continue
            reason = item.get("skipReason") if item.get("skipReason") in SKIP_REASONS else ""
            note = clip(item.get("skipNote"), 160)
            skipped = self._truthy_flag(item.get("skipped"))
            if skipped and reason == "other" and not note:
                raise ValueError("Add a note for Other.")
            row = dict(base)
            if skipped and reason:
                row["skipped"] = True
                row["skipReason"] = reason
                if reason == "other":
                    row["skipNote"] = note
            planned.append(row)
        planned_ids = {row["id"] for row in planned}
        kept = []
        seen = set()
        for row in off_script:
            if row["id"] in planned_ids or row["id"] in seen:
                continue
            seen.add(row["id"])
            kept.append(row)
        return planned + kept

    def kids_class_label(self, age_group):
        names = {"mite": "Mighty Mites", "upper": "Pee Wees", "toddler": "Toddler"}
        parts = [names.get(part, part) for part in str(age_group or "").split("+") if part]
        return " + ".join(parts) if parts else "Kids class"

    def review_snapshot(self, techniques):
        skipped = []
        off_script = []
        for tech in techniques or []:
            if not isinstance(tech, dict):
                continue
            if tech.get("offScript"):
                item = {"name": tech.get("name") or ""}
                if tech.get("note"):
                    item["note"] = tech["note"]
                off_script.append(item)
                continue
            if tech.get("skipped"):
                item = {
                    "name": tech.get("name") or "",
                    "reason": SKIP_REASON_LABELS.get(tech.get("skipReason"), ""),
                }
                if tech.get("skipNote"):
                    item["note"] = tech["skipNote"]
                skipped.append(item)
        return {"skipped": skipped, "offScript": off_script}

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
        students = [self.student_json(row, conn) for row in conn.execute("SELECT * FROM students ORDER BY name")]
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
            "kidsEnrollment": self.enrollment_snapshot(conn, staff=True),
            "adultCurriculum": self.adult_curriculum_public(),
            "adultChecks": self.adult_checks_map(conn),
            "adultAttendance": self.adult_attendance_list(conn),
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

    def save_class(self, conn, entry, merge, user=None):
        current = conn.execute(
            "SELECT * FROM classes WHERE date = ? AND age_group = ?",
            (entry["date"], entry["ageGroup"]),
        ).fetchone()
        before_techniques = self.json_list(current["techniques"]) if current else []
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
        saved = self.class_json(row)
        if user is not None:
            before_snap = self.review_snapshot(before_techniques)
            after_snap = self.review_snapshot(saved["techniques"])
            if before_snap != after_snap:
                label = self.kids_class_label(saved["ageGroup"])
                self.append_change(
                    conn,
                    user,
                    "",
                    f"{label} · {saved['date']}",
                    "class_review",
                    {"date": saved["date"], "ageGroup": saved["ageGroup"], **before_snap},
                    {"date": saved["date"], "ageGroup": saved["ageGroup"], **after_snap},
                )
        return saved

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
            if method == "POST" and path == "/api/public/waitlist":
                return self.join_waitlist(handler)
            if method == "POST" and path == "/api/public/parent":
                return self.public_parent_check(handler)
            if method == "GET" and path == "/api/public/parent":
                return self.public_parent_grant(handler)
            if method == "GET" and path == "/api/public/parent/waiver":
                return self.public_parent_waiver(handler)
            if method == "GET" and path == "/api/public/demo-examples":
                return self.public_demo_examples(handler)
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
                    if user["role"] == "admin":
                        body["kidsEnrollment"]["waitlistNext"] = self.waitlist_next(conn)
                    body.update(self.public_user(user, csrf, conn))
                    return self.send(handler, 200, body)
                if not user and self.anonymous_adult_calendar_write(handler, path, method):
                    return self.send(handler, 401, {"error": "Log in first."})
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
        except (BrokenPipeError, ConnectionResetError):
            return None
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
            users = []
            for row in rows:
                member_id, member_name = self.member_for_user(conn, row["id"])
                users.append(
                    {
                        "id": row["id"],
                        "username": row["username"],
                        "role": row["role"],
                        "mustChangePassword": bool(row["must_change_password"]),
                        "displayName": self.display_staff_name(row["staff_name"], row["username"]),
                        "memberStudentId": member_id,
                        "memberName": member_name,
                    }
                )
            return self.send(handler, 200, {"users": users, "soleAdmin": self.sole_admin(conn, user)})
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
        member_match = re.match(r"^/api/users/([A-Za-z0-9_-]{1,40})/member$", path)
        if member_match and method == "PUT":
            if not admin:
                return self.send(handler, 403, {"error": "An admin links staff to members."})
            return self.link_staff_member(handler, conn, user, member_match.group(1))
        if member_match and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin links staff to members."})
            return self.unlink_staff_member(handler, conn, user, member_match.group(1))
        if path == "/api/change-log" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reads the change log."})
            return self.list_change_log(handler, conn)
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
            return self.save_class_exception(handler, conn, user)
        exception_date = re.fullmatch(r"/api/class-exceptions/(\d{4}-\d{2}-\d{2})", path)
        if exception_date and method == "DELETE":
            return self.delete_class_exception(handler, conn, user, exception_date.group(1))
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
        if path == "/api/adult-progress" and method == "POST":
            return self.set_adult_progress(handler, conn, user)
        if path == "/api/adult-attendance" and method == "POST":
            return self.mark_adult_attendance(handler, conn)
        if path == "/api/students" and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin adds students."})
            return self.add_student(handler, conn)
        rank_match = re.match(r"^/api/students/([A-Za-z0-9_-]{1,40})/rank$", path)
        if rank_match and method == "POST":
            return self.set_student_rank(handler, conn, user, rank_match.group(1))
        name_match = re.match(r"^/api/students/([A-Za-z0-9_-]{1,40})/name$", path)
        if name_match and method == "POST":
            return self.rename_student(handler, conn, user, name_match.group(1))
        attend_match = re.match(r"^/api/students/([A-Za-z0-9_-]{1,40})/attendance$", path)
        if attend_match and method == "POST":
            return self.set_student_attendance(handler, conn, user, attend_match.group(1))
        student_match = re.match(r"^/api/students/([A-Za-z0-9_-]{1,40})$", path)
        if student_match and method == "PATCH":
            if not admin:
                return self.send(handler, 403, {"error": "An admin edits the roster."})
            return self.patch_student(handler, conn, student_match.group(1))
        if student_match and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin removes students."})
            return self.delete_student(handler, conn, user, student_match.group(1))
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
            saved = self.save_class(conn, self.sanitize_class(self.read_json(handler)), merge=False, user=user)
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
            saved = self.save_class(conn, self.sanitize_class(body), merge=True, user=user)
            conn.commit()
            return self.send(handler, 200, saved)
        if path == "/api/levels" and method == "PUT":
            return self.save_level(handler, conn, user)
        if path == "/api/levels" and method == "DELETE":
            return self.clear_level(handler, conn, user)
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
        if path == "/api/waitlist" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages the waitlist."})
            return self.list_waitlist(handler, conn)
        if path == "/api/waitlist.csv" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages the waitlist."})
            group = (parse_qs(urlparse(handler.path).query).get("group") or ["all"])[0]
            return self.send_csv(handler, "grace-waitlist.csv", self.waitlist_csv(conn, group))
        wait_action = re.fullmatch(r"/api/waitlist/([A-Za-z0-9_-]{1,40})/(contacted|enrolled)", path)
        if wait_action and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages the waitlist."})
            return self.set_waitlist_status(handler, conn, wait_action.group(1), wait_action.group(2))
        wait_row = re.fullmatch(r"/api/waitlist/([A-Za-z0-9_-]{1,40})", path)
        if wait_row and method == "DELETE":
            if not admin:
                return self.send(handler, 403, {"error": "An admin manages the waitlist."})
            return self.set_waitlist_status(handler, conn, wait_row.group(1), "removed")
        if path == "/api/export" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin downloads the attendance backup."})
            body = self.bootstrap(conn)
            body.pop("sheets", None)
            body["waitlist"] = self.waitlist_export(conn)
            return self.send(handler, 200, body)
        if path == "/api/export/roster.csv" and method == "GET":
            return self.send_csv(handler, "grace-roster.csv", self.roster_csv(conn))
        if path == "/api/export/attendance.csv" and method == "GET":
            return self.send_csv(handler, "grace-attendance.csv", self.attendance_csv(conn))
        if path == "/api/waivers" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.list_waivers(handler, conn)
        if path == "/api/enrollment-review" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.enrollment_review(handler, conn)
        if path == "/api/waivers.csv" and method == "GET":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.send_csv(handler, "grace-waivers.csv", self.waivers_csv(conn))
        waiver_roster = re.fullmatch(r"/api/waivers/([A-Za-z0-9_-]{1,40})/roster", path)
        if waiver_roster and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.mark_waiver_on_roster(handler, conn, waiver_roster.group(1))
        waiver_match_post = re.fullmatch(r"/api/waivers/([A-Za-z0-9_-]{1,40})/match", path)
        if waiver_match_post and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.match_waiver_student(handler, conn, waiver_match_post.group(1))
        waiver_add = re.fullmatch(r"/api/waivers/([A-Za-z0-9_-]{1,40})/add", path)
        if waiver_add and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.add_waiver_student(handler, conn, waiver_add.group(1))
        waiver_unlink = re.fullmatch(r"/api/waivers/([A-Za-z0-9_-]{1,40})/unlink", path)
        if waiver_unlink and method == "POST":
            if not admin:
                return self.send(handler, 403, {"error": "An admin reviews enrollment forms."})
            return self.unlink_waiver(handler, conn, waiver_unlink.group(1))
        waiver_match = re.fullmatch(r"/api/waivers/([A-Za-z0-9_-]{1,40})", path)
        if waiver_match and method == "GET":
            return self.waiver_detail(handler, conn, waiver_match.group(1))
        parent_token_route = re.fullmatch(r"/api/students/([A-Za-z0-9_-]{1,40})/parent-token", path)
        if parent_token_route and method == "POST":
            return self.rotate_parent_token(handler, conn, parent_token_route.group(1))
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
            "SELECT kind FROM class_exceptions WHERE program = 'kids' AND date = ?",
            (str(value or "").strip(),),
        ).fetchone()
        return bool(row and row["kind"] == "extra")

    def calendar_program(self, raw):
        text = str(raw or "").strip().lower()
        if text in ("", "kids"):
            return "kids"
        if text == "adult":
            return "adult"
        raise ValueError("Choose the kids or adult calendar.")

    def anonymous_adult_calendar_write(self, handler, path, method):
        """Adult calendar edits require a login. Kids writes keep the usual check."""
        if method == "DELETE" and re.fullmatch(r"/api/class-exceptions/\d{4}-\d{2}-\d{2}", path):
            raw = (parse_qs(urlparse(handler.path).query).get("program") or [""])[0]
            return str(raw or "").strip().lower() == "adult"
        if method != "POST" or path != "/api/class-exceptions":
            return False
        length = int(handler.headers.get("Content-Length") or 0)
        if length < 0 or length > 100_000:
            return False
        raw = handler.rfile.read(length) if length else b""
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError):
            return False
        if not isinstance(data, dict):
            return False
        return str(data.get("program") or "").strip().lower() == "adult"

    def require_calendar_admin(self, handler, user, program):
        if program == "adult" or (user and user.get("role") == "admin"):
            return False
        self.send(handler, 403, {"error": "An admin edits the class calendar."})
        return True

    def calendar_snapshot(self, row):
        if not row:
            return {}
        return {
            "date": row["date"],
            "kind": row["kind"],
            "reason": row["reason"] or "",
            "start": row["start_time"],
            "end": row["end_time"],
        }

    def query_program(self, handler):
        raw = (parse_qs(urlparse(handler.path).query).get("program") or [""])[0]
        return self.calendar_program(raw)

    def exception_json(self, row, public):
        body = {
            "date": row["date"],
            "kind": row["kind"],
            "reason": row["reason"] or "",
            "start": row["start_time"],
            "end": row["end_time"],
            "program": row["program"] if "program" in row.keys() else "kids",
        }
        if not public:
            body["createdBy"] = row["created_by"] or ""
            body["createdAt"] = row["created_at"]
        return body

    def list_exception_rows(self, conn, program):
        return conn.execute(
            "SELECT * FROM class_exceptions WHERE program = ? ORDER BY date",
            (program,),
        ).fetchall()

    def public_class_exceptions(self, handler):
        program = self.query_program(handler)
        conn = self.db()
        try:
            rows = self.list_exception_rows(conn, program)
        finally:
            conn.close()
        self.send(handler, 200, {"exceptions": [self.exception_json(row, True) for row in rows]})

    def list_class_exceptions(self, handler, conn, public):
        program = self.query_program(handler)
        rows = self.list_exception_rows(conn, program)
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
        program = self.calendar_program(body.get("program"))
        if self.require_calendar_admin(handler, user, program):
            return None
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
        on_schedule = is_adult_class_day(date) if program == "adult" else is_class_day(date)
        if kind == "skip" and not on_schedule:
            if program == "adult":
                raise ValueError("Only a regular Tuesday or Thursday can be skipped.")
            raise ValueError("Only a regular class Tuesday can be skipped.")
        if kind == "extra" and on_schedule:
            if program == "adult":
                raise ValueError("That day is already on the schedule. Skip it if class is cancelled.")
            raise ValueError("That Tuesday is already on the schedule. Skip it if class is cancelled.")
        reason = str(body.get("reason") or "").replace("\u0000", "").strip()
        if len(reason) > 120:
            raise ValueError("Keep the reason to 120 characters.")
        fallback_start, fallback_end = ("18:30", "20:00") if program == "adult" else ("17:30", "18:15")
        start = self.clean_clock(body.get("start") or body.get("startTime"), fallback_start)
        end = self.clean_clock(body.get("end") or body.get("endTime"), fallback_end)
        if end <= start:
            raise ValueError("The end time needs to be after the start.")
        previous = conn.execute(
            "SELECT * FROM class_exceptions WHERE program = ? AND date = ?",
            (program, date),
        ).fetchone()
        now = iso(utcnow())
        conn.execute(
            """
            INSERT INTO class_exceptions
              (program, date, kind, reason, start_time, end_time, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(program, date) DO UPDATE SET
              kind = excluded.kind,
              reason = excluded.reason,
              start_time = excluded.start_time,
              end_time = excluded.end_time,
              created_by = excluded.created_by,
              created_at = excluded.created_at
            """,
            (program, date, kind, reason, start, end, user.get("username") or "", now),
        )
        row = conn.execute(
            "SELECT * FROM class_exceptions WHERE program = ? AND date = ?",
            (program, date),
        ).fetchone()
        if program == "adult":
            self.append_change(
                conn,
                user,
                "",
                "Adult calendar",
                "adult_calendar",
                self.calendar_snapshot(previous),
                self.calendar_snapshot(row),
            )
        conn.commit()
        return self.send(handler, 200, {"exception": self.exception_json(row, False)})

    def delete_class_exception(self, handler, conn, user, date):
        program = self.query_program(handler)
        if self.require_calendar_admin(handler, user, program):
            return None
        row = conn.execute(
            "SELECT * FROM class_exceptions WHERE program = ? AND date = ?",
            (program, date),
        ).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That date is not changed."})
        conn.execute(
            "DELETE FROM class_exceptions WHERE program = ? AND date = ?",
            (program, date),
        )
        if program == "adult":
            self.append_change(
                conn,
                user,
                "",
                "Adult calendar",
                "adult_calendar",
                self.calendar_snapshot(row),
                {},
            )
        conn.commit()
        return self.send(handler, 200, {"ok": True, "date": date, "program": program})

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
        link = conn.execute(
            """
            SELECT staff_member_links.student_id AS student_id, students.name AS student_name
            FROM staff_member_links
            LEFT JOIN students ON students.id = staff_member_links.student_id
            WHERE staff_member_links.user_id = ?
            """,
            (uid,),
        ).fetchone()
        if link:
            self.append_change(
                conn,
                user,
                link["student_id"] or "",
                link["student_name"] or "",
                "staff_unlink",
                {"userId": uid, "studentId": link["student_id"] or ""},
                {"userId": "", "studentId": ""},
            )
            conn.execute("DELETE FROM staff_member_links WHERE user_id = ?", (uid,))
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
            """
            INSERT INTO students (id, name, age, belt, stripes, created_at, parent_token)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                student["id"],
                student["name"],
                student["age"],
                student["belt"],
                student["stripes"],
                now,
                self.new_parent_token(conn),
            ),
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
                INSERT INTO students (id, name, age, belt, stripes, created_at, parent_token)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  name = excluded.name, age = excluded.age, belt = excluded.belt, stripes = excluded.stripes
                """,
                (
                    student["id"],
                    student["name"],
                    student["age"],
                    student["belt"],
                    student["stripes"],
                    iso(utcnow()),
                    self.new_parent_token(conn),
                ),
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
                level = canonical_level(level)
                if tech and level:
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
        snap = self.enrollment_snapshot(conn, staff=True, next_names=admin)
        return self.send(handler, 200, {"ok": True, "students": len(id_map), "kidsEnrollment": snap})

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

    def read_waiver_config(self):
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
                return data
        return {}

    def config_flag(self, cfg_key, file_key):
        forced = self.cfg.get(cfg_key, None)
        if forced is not None:
            return bool(forced)
        return self.read_waiver_config().get(file_key) is True

    def waiver_submissions_enabled(self):
        return self.config_flag("waiver_submissions_enabled", "waiverSubmissionsEnabled")

    def waitlist_enabled(self):
        return self.config_flag("waitlist_enabled", "waitlistEnabled")

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
        students = list(conn.execute("SELECT id, name, age, dob, program FROM students"))
        roster_ids = {row["id"] for row in students}
        kid_keys = set()
        kid_count = 0
        for row in students:
            if (self.cell(row, "program", "kids") or "kids") == "adult":
                continue
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

    def enrollment_snapshot(self, conn, staff=False, next_names=False):
        cap = self.kids_cap(conn)
        enrolled = self.kids_enrolled_count(conn)
        body = {
            "cap": cap,
            "enrolled": enrolled,
            "spotsOpen": max(0, cap - enrolled),
            "full": enrolled >= cap,
            "submissionsEnabled": self.waiver_submissions_enabled(),
            "waitlistEnabled": self.waitlist_enabled(),
        }
        if staff:
            active = self.active_waitlist_count(conn)
            body["waitlistActive"] = active
            body["waitlistSpotOpen"] = enrolled < cap and active > 0
            if next_names:
                body["waitlistNext"] = self.waitlist_next(conn)
        return body

    def active_waitlist_count(self, conn):
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM waitlist WHERE status IN ('waiting', 'contacted')"
        ).fetchone()
        return int(row["n"])

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

    def apply_waiver_pin(self, conn, wid, student_id):
        row = conn.execute(
            "SELECT kind, card_pin_hash FROM waivers WHERE id = ?",
            (wid,),
        ).fetchone()
        if not row or row["kind"] != "adult":
            return
        pin_hash = self.cell(row, "card_pin_hash", "") or ""
        if not pin_hash or not student_id:
            return
        conn.execute(
            "UPDATE students SET card_pin_hash = ? WHERE id = ?",
            (pin_hash, student_id),
        )
        self.drop_parent_grants(student_id)

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

    def link_student_forms(self, conn, student_id, name, age, dob, waiver_id=""):
        # A typed name is not enough to attach a form. Staff pass waiverId,
        # or the parent card token is checked in submit_waiver.
        if not waiver_id:
            return
        row = conn.execute(
            "SELECT id, kind, dob FROM waivers WHERE id = ?",
            (waiver_id,),
        ).fetchone()
        if row and row["kind"] == "kids":
            if not dob:
                dob = row["dob"] or ""
                self.remember_dob(conn, student_id, dob)
            self.link_waiver_row(conn, row["id"], student_id)

    def unlink_student_forms(self, conn, student_id):
        conn.execute(
            "UPDATE waivers SET added_to_roster = 0, roster_student_id = '' WHERE roster_student_id = ?",
            (student_id,),
        )

    def student_payload(self, conn, sid):
        row = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        body = self.student_json(row, conn)
        body["kidsEnrollment"] = self.enrollment_snapshot(conn, staff=True, next_names=True)
        return body

    def add_student(self, handler, conn):
        body = self.read_json(handler)
        adult = body.get("program") == "adult"
        raw = self.sanitize_adult(body) if adult else self.sanitize_student(body)
        dob = self.clean_dob(body.get("dob"))
        confirm = body.get("confirmOverCap") is True
        waiver_id = clean_id(body.get("waiverId")) or ""
        adding = (not adult) and self.counts_as_kid(raw["age"])
        before = None
        if adding:
            self.lock_kids(conn)
            before = self.kids_enrolled_count(conn)
        conn.execute(
            """
            INSERT INTO students (id, name, age, belt, stripes, created_at, dob, parent_token, program)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                raw["id"],
                raw["name"],
                raw["age"],
                raw["belt"],
                raw["stripes"],
                iso(utcnow()),
                dob,
                self.new_parent_token(conn),
                "adult" if adult else "kids",
            ),
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
        adult = (self.cell(old, "program", "kids") or "kids") == "adult" or body.get("program") == "adult"
        raw = self.sanitize_adult(body, sid) if adult else self.sanitize_student(body, sid)
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
            "UPDATE students SET name = ?, age = ?, belt = ?, stripes = ?, dob = ?, program = ? WHERE id = ?",
            (raw["name"], raw["age"], raw["belt"], raw["stripes"], dob, "adult" if adult else "kids", sid),
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

    def delete_student(self, handler, conn, user, sid):
        self.lock_kids(conn)
        existing = conn.execute("SELECT name FROM students WHERE id = ?", (sid,)).fetchone()
        student_name = existing["name"] if existing else ""
        link = conn.execute(
            "SELECT user_id FROM staff_member_links WHERE student_id = ?",
            (sid,),
        ).fetchone()
        if link:
            self.append_change(
                conn,
                user,
                sid,
                student_name,
                "staff_unlink",
                {"userId": link["user_id"], "studentId": sid},
                {"userId": "", "studentId": ""},
            )
            conn.execute("DELETE FROM staff_member_links WHERE student_id = ?", (sid,))
        self.unlink_student_forms(conn, sid)
        conn.execute("DELETE FROM students WHERE id = ?", (sid,))
        conn.execute("DELETE FROM levels WHERE student_id = ?", (sid,))
        conn.execute("DELETE FROM notes WHERE student_id = ?", (sid,))
        conn.execute("DELETE FROM adult_progress WHERE student_id = ?", (sid,))
        conn.execute(
            "UPDATE cards SET status = 'retired', retired_at = ? WHERE student_id = ? AND status != 'retired'",
            (iso(utcnow()), sid),
        )
        conn.commit()
        return self.send(handler, 200, {"ok": True, "kidsEnrollment": self.enrollment_snapshot(conn, staff=True, next_names=True)})

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
        return self.send(handler, 200, self.enrollment_snapshot(conn, staff=True, next_names=True))

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
                "kidsEnrollment": self.enrollment_snapshot(conn, staff=True),
            },
        )

    def waiver_payload(self, row):
        try:
            payload = json.loads(row["payload_json"] or "{}")
        except (TypeError, json.JSONDecodeError):
            payload = {}
        return payload if isinstance(payload, dict) else {}

    def phone_key(self, value):
        digits = "".join(ch for ch in str(value or "") if ch.isdigit())
        if len(digits) == 11 and digits.startswith("1"):
            digits = digits[1:]
        return digits

    def student_in_program(self, student, kind):
        try:
            age = int(student["age"])
        except (TypeError, ValueError):
            return False
        if kind == "kids":
            return age < 11
        return age >= 11

    def contact_index(self, conn):
        index = {}
        rows = conn.execute(
            "SELECT roster_student_id, email, phone, payload_json, added_to_roster FROM waivers"
        ).fetchall()
        for row in rows:
            sid = row["roster_student_id"] or ""
            if not sid or not int(row["added_to_roster"] or 0):
                continue
            bucket = index.setdefault(sid, {"names": [], "emails": [], "phones": []})
            if row["email"]:
                bucket["emails"].append(row["email"])
            if row["phone"]:
                bucket["phones"].append(row["phone"])
            payload = self.waiver_payload(row)
            parent = payload.get("parentName") or ""
            if parent:
                bucket["names"].append(parent)
            emergency = payload.get("emergencyPhone") or ""
            if emergency:
                bucket["phones"].append(emergency)
        return index

    def contacts_for(self, student, index):
        bucket = {
            "names": list(index.get(student["id"], {}).get("names", [])),
            "emails": list(index.get(student["id"], {}).get("emails", [])),
            "phones": list(index.get(student["id"], {}).get("phones", [])),
        }
        parent = self.cell(student, "parent_name", "") or ""
        email = self.cell(student, "parent_email", "") or ""
        phone = self.cell(student, "parent_phone", "") or ""
        if parent:
            bucket["names"].append(parent)
        if email:
            bucket["emails"].append(email)
        if phone:
            bucket["phones"].append(phone)
        return bucket

    def rank_waiver_student(self, waiver, payload, student, contacts):
        reasons = []
        score = 0
        wname = self.norm_name(waiver["participant_name"])
        sname = self.norm_name(student["name"])
        wset = {tok for tok in wname.split() if tok}
        sset = {tok for tok in sname.split() if tok}
        if wname and wname == sname:
            score += 50
            reasons.append("Same name")
        else:
            shared = {tok for tok in wset & sset if len(tok) >= 3}
            if wset and sset and wset == sset:
                score += 40
                reasons.append("Same name")
            elif shared and (wset <= sset or sset <= wset):
                score += 30
                reasons.append("Similar name")
            elif shared:
                score += 12
                reasons.append("Similar name")
        wdob = waiver["dob"] or ""
        sdob = self.cell(student, "dob", "") or ""
        exact_dob = bool(wdob and sdob and wdob == sdob)
        if exact_dob:
            score += 40
            reasons.append("Same birth date")
        elif wdob and sdob and len(wdob) == 10 and len(sdob) == 10 and wdob[5:] == sdob[5:]:
            score += 8
            reasons.append("Same month and day")
        parent = self.norm_name(payload.get("parentName"))
        parent_hit = False
        if parent:
            for name in contacts["names"]:
                if parent == self.norm_name(name):
                    score += 25
                    reasons.append("Same parent or guardian")
                    parent_hit = True
                    break
            if not parent_hit:
                pset = {tok for tok in parent.split() if len(tok) >= 3}
                for name in contacts["names"]:
                    other = {tok for tok in self.norm_name(name).split() if len(tok) >= 3}
                    if pset & other:
                        score += 10
                        reasons.append("Similar parent or guardian")
                        break
        wemail = str(waiver["email"] or "").casefold()
        if wemail and any(str(item or "").casefold() == wemail for item in contacts["emails"]):
            score += 25
            reasons.append("Same email")
        wphone = self.phone_key(waiver["phone"])
        if len(wphone) >= 7 and any(self.phone_key(item) == wphone for item in contacts["phones"]):
            score += 20
            reasons.append("Same phone")
        exact = bool(wname and wname == sname and exact_dob)
        return score, reasons, exact

    def waiver_suggestions(self, waiver, payload, students, index):
        ranked = []
        for student in students:
            if not self.student_in_program(student, waiver["kind"]):
                continue
            score, reasons, exact = self.rank_waiver_student(
                waiver, payload, student, self.contacts_for(student, index)
            )
            if score <= 0:
                continue
            ranked.append(
                {
                    "studentId": student["id"],
                    "name": student["name"],
                    "age": student["age"],
                    "dob": self.cell(student, "dob", "") or "",
                    "score": score,
                    "reasons": reasons,
                    "exact": exact,
                }
            )
        ranked.sort(key=lambda item: (-item["score"], item["name"].casefold(), item["studentId"]))
        exacts = [item for item in ranked if item["exact"]]
        preselect = exacts[0]["studentId"] if len(exacts) == 1 else ""
        return ranked[:5], preselect

    def roster_pick(self, student):
        return {
            "id": student["id"],
            "name": student["name"],
            "age": student["age"],
            "dob": self.cell(student, "dob", "") or "",
            "parentName": self.cell(student, "parent_name", "") or "",
            "email": self.cell(student, "parent_email", "") or "",
            "phone": self.cell(student, "parent_phone", "") or "",
        }

    def review_form(self, row, students, index, linked):
        payload = self.waiver_payload(row)
        try:
            age = int(payload.get("age"))
        except (TypeError, ValueError):
            age = self.waiver_years(row["dob"])
        suggestions, preselect = self.waiver_suggestions(row, payload, students, index)
        if linked is not None:
            preselect = linked["id"]
        return {
            "id": row["id"],
            "kind": row["kind"],
            "submittedAt": row["submitted_at"],
            "signedOn": row["signed_on"],
            "participantName": row["participant_name"],
            "signerName": row["signer_name"],
            "dob": row["dob"],
            "age": age if age is not None else "",
            "ageGroupLabel": self.age_group_label(age) if age is not None else "",
            "email": row["email"],
            "phone": row["phone"],
            "parentName": payload.get("parentName") or "",
            "emergencyName": payload.get("emergencyName") or "",
            "emergencyPhone": payload.get("emergencyPhone") or "",
            "injuries": payload.get("injuries") or "",
            "addedToRoster": bool(int(self.cell(row, "added_to_roster", 0) or 0)),
            "rosterStudentId": linked["id"] if linked is not None else "",
            "rosterStudentName": linked["name"] if linked is not None else "",
            "linked": linked is not None,
            "suggestions": suggestions,
            "preselectId": preselect,
        }

    def enrollment_review(self, handler, conn):
        students = list(conn.execute("SELECT * FROM students ORDER BY name COLLATE NOCASE"))
        by_id = {row["id"]: row for row in students}
        index = self.contact_index(conn)
        kids = []
        adults = []
        for row in conn.execute("SELECT * FROM waivers ORDER BY submitted_at DESC"):
            sid = row["roster_student_id"] or ""
            linked = by_id.get(sid) if sid else None
            form = self.review_form(row, students, index, linked)
            if row["kind"] == "kids":
                kids.append(form)
            else:
                adults.append(form)
        snap = self.enrollment_snapshot(conn, staff=True)
        return self.send(
            handler,
            200,
            {
                "kids": kids,
                "adults": adults,
                "roster": {
                    "kids": [self.roster_pick(row) for row in students if self.student_in_program(row, "kids")],
                    "adults": [self.roster_pick(row) for row in students if self.student_in_program(row, "adult")],
                },
                "kidsEnrollment": {
                    "cap": snap["cap"],
                    "enrolled": snap["enrolled"],
                    "full": snap["full"],
                    "waitlistEnabled": snap["waitlistEnabled"],
                },
            },
        )

    def waiver_row(self, conn, wid):
        return conn.execute("SELECT * FROM waivers WHERE id = ?", (wid,)).fetchone()

    def match_waiver_student(self, handler, conn, wid):
        body = self.read_json(handler)
        row = self.waiver_row(conn, wid)
        if not row:
            return self.send(handler, 404, {"error": "That enrollment form is not on file."})
        sid = clean_id(body.get("studentId"))
        if not sid:
            raise ValueError("Choose a student on the roster.")
        student = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        if not student:
            return self.send(handler, 404, {"error": "That student is not on the roster."})
        if not self.student_in_program(student, row["kind"]):
            raise ValueError("That student is in the other program.")
        self.remember_dob(conn, sid, row["dob"])
        self.link_waiver_row(conn, wid, sid)
        self.apply_waiver_pin(conn, wid, sid)
        conn.commit()
        return self.send(
            handler,
            200,
            {"ok": True, "rosterStudentId": sid, "waiver": self.waiver_for_student(conn, sid)},
        )

    def unlink_waiver(self, handler, conn, wid):
        # Read the body so a keep-alive connection does not treat "{}" as the next request.
        self.read_json(handler)
        row = self.waiver_row(conn, wid)
        if not row:
            return self.send(handler, 404, {"error": "That enrollment form is not on file."})
        previous = row["roster_student_id"] or ""
        conn.execute(
            "UPDATE waivers SET added_to_roster = 0, roster_student_id = '' WHERE id = ?",
            (wid,),
        )
        conn.commit()
        waiver = self.waiver_for_student(conn, previous) if previous else {"signed": False}
        return self.send(handler, 200, {"ok": True, "waiver": waiver})

    def add_waiver_student(self, handler, conn, wid):
        body = self.read_json(handler)
        confirm = body.get("confirmOverCap") is True
        row = self.waiver_row(conn, wid)
        if not row:
            return self.send(handler, 404, {"error": "That enrollment form is not on file."})
        existing_id = row["roster_student_id"] or ""
        if existing_id and conn.execute("SELECT 1 FROM students WHERE id = ?", (existing_id,)).fetchone():
            raise ValueError("Unlink this form before adding a new student.")
        payload = self.waiver_payload(row)
        name = clip(row["participant_name"], 40)
        if not name:
            raise ValueError("Add the student's name.")
        dob = row["dob"] or ""
        try:
            age = int(payload.get("age"))
        except (TypeError, ValueError):
            age = self.waiver_years(dob)
        if age is None or age < 0 or age > 120:
            raise ValueError("That form needs a date of birth.")
        if row["kind"] == "adult" and age < 11:
            raise ValueError("This enrollment is for ages 11 and up.")
        if row["kind"] == "kids" and age > 10:
            raise ValueError("This enrollment is for ages 3–10.")
        adding_kid = row["kind"] == "kids" and self.counts_as_kid(age)
        before = None
        if adding_kid:
            self.lock_kids(conn)
            before = self.kids_enrolled_count(conn)
        sid = new_id("s-")
        parent_name = clip(payload.get("parentName"), 120)
        injuries = clip(payload.get("injuries"), 760).strip()
        conn.execute(
            """
            INSERT INTO students (
              id, name, age, belt, stripes, created_at, dob, parent_token,
              parent_name, parent_email, parent_phone, program
            ) VALUES (?, ?, ?, 'white', 0, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                sid,
                name,
                age,
                iso(utcnow()),
                dob,
                self.new_parent_token(conn),
                parent_name,
                clip(row["email"], 160),
                clip(row["phone"], 40),
                "adult" if row["kind"] == "adult" else "kids",
            ),
        )
        if injuries:
            conn.execute(
                "INSERT INTO notes (student_id, note) VALUES (?, ?)",
                (sid, clip("Enrollment medical notes: " + injuries, 800)),
            )
        self.link_waiver_row(conn, wid, sid)
        self.apply_waiver_pin(conn, wid, sid)
        if adding_kid:
            blocked = self.over_cap(conn, before)
            if blocked and not confirm:
                after, cap = blocked
                conn.rollback()
                return self.send(handler, 409, self.cap_confirm_body(before, after, cap))
        conn.commit()
        return self.send(handler, 201, self.student_payload(conn, sid))

    def allow_waitlist_post(self, ip):
        now = utcnow().timestamp()
        posts = [item for item in self._waitlist_posts if now - item[0] < 3600]
        count = sum(1 for item in posts if item[1] == ip)
        if count >= 10:
            self._waitlist_posts = posts
            return False
        posts.append((now, ip))
        self._waitlist_posts = posts
        return True

    def waitlist_group_label(self, age_group):
        return {"mite": "3–6 Mighty Mites", "upper": "7–10 Pee Wees"}.get(age_group, "")

    def waitlist_json(self, row, position):
        return {
            "id": row["id"],
            "position": position,
            "createdAt": row["created_at"],
            "parentName": row["parent_name"],
            "email": row["email"],
            "phone": row["phone"],
            "childName": row["child_name"],
            "childAge": row["child_age"],
            "dob": row["dob"] or "",
            "ageGroup": row["age_group"],
            "ageGroupLabel": self.waitlist_group_label(row["age_group"]),
            "note": row["note"] or "",
            "status": row["status"],
        }

    def waitlist_active_rows(self, conn):
        return conn.execute(
            """
            SELECT * FROM waitlist
            WHERE status IN ('waiting', 'contacted')
            ORDER BY created_at, rowid
            """
        ).fetchall()

    def waitlist_grouped(self, conn):
        grouped = {"mite": [], "upper": []}
        for row in self.waitlist_active_rows(conn):
            if row["age_group"] in grouped:
                grouped[row["age_group"]].append(row)
        return grouped

    def waitlist_positioned(self, rows):
        return [self.waitlist_json(row, index + 1) for index, row in enumerate(rows)]

    def waitlist_next(self, conn):
        grouped = self.waitlist_grouped(conn)
        nxt = {}
        for key in ("mite", "upper"):
            rows = grouped[key]
            if not rows:
                nxt[key] = None
                continue
            row = rows[0]
            nxt[key] = {
                "childName": row["child_name"],
                "parentName": row["parent_name"],
                "position": 1,
                "ageGroup": key,
                "ageGroupLabel": self.waitlist_group_label(key),
            }
        return nxt

    def waitlist_payload(self, conn):
        grouped = self.waitlist_grouped(conn)
        groups = [
            {
                "ageGroup": "mite",
                "label": self.waitlist_group_label("mite"),
                "entries": self.waitlist_positioned(grouped["mite"]),
            },
            {
                "ageGroup": "upper",
                "label": self.waitlist_group_label("upper"),
                "entries": self.waitlist_positioned(grouped["upper"]),
            },
        ]
        snap = self.enrollment_snapshot(conn, staff=True)
        entries = groups[0]["entries"] + groups[1]["entries"]
        return {
            "groups": groups,
            "entries": entries,
            "byJoined": sorted(entries, key=lambda item: (item["createdAt"], item["id"])),
            "spotOpen": snap["waitlistSpotOpen"],
            "waitlistNext": self.waitlist_next(conn),
            "enrolled": snap["enrolled"],
            "cap": snap["cap"],
        }

    def list_waitlist(self, handler, conn):
        return self.send(handler, 200, self.waitlist_payload(conn))

    def waitlist_export(self, conn):
        positions = {}
        for rows in self.waitlist_grouped(conn).values():
            for index, row in enumerate(rows):
                positions[row["id"]] = index + 1
        rows = conn.execute(
            """
            SELECT * FROM waitlist
            ORDER BY CASE age_group WHEN 'mite' THEN 0 ELSE 1 END, created_at, rowid
            """
        ).fetchall()
        return [self.waitlist_json(row, positions.get(row["id"])) for row in rows]

    def waitlist_csv(self, conn, group="all"):
        if group not in ("all", "mite", "upper"):
            raise ValueError("Choose All, 3–6, or 7–10.")
        positions = {}
        grouped = self.waitlist_grouped(conn)
        for key, queued in grouped.items():
            for index, row in enumerate(queued):
                positions[row["id"]] = index + 1
        if group == "all":
            selected = self.waitlist_active_rows(conn)
        else:
            selected = grouped[group]
        rows = [[
            "position", "joined", "status", "parent_name", "email", "phone",
            "child_name", "child_age", "dob", "age_group", "note",
        ]]
        for row in selected:
            rows.append([
                positions[row["id"]],
                row["created_at"],
                row["status"],
                row["parent_name"],
                row["email"],
                row["phone"],
                row["child_name"],
                row["child_age"],
                row["dob"] or "",
                self.waitlist_group_label(row["age_group"]),
                row["note"] or "",
            ])
        return rows

    def set_waitlist_status(self, handler, conn, wid, status):
        row = conn.execute("SELECT * FROM waitlist WHERE id = ?", (wid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That family is not on the waitlist."})
        if row["status"] not in ("waiting", "contacted"):
            return self.send(handler, 400, {"error": "That family is already off the active list."})
        if status == "contacted" and row["status"] == "contacted":
            return self.send(handler, 200, self.waitlist_payload(conn))
        conn.execute("UPDATE waitlist SET status = ? WHERE id = ?", (status, wid))
        conn.commit()
        return self.send(handler, 200, self.waitlist_payload(conn))

    def join_waitlist(self, handler):
        if not self.waitlist_enabled():
            return self.send(handler, 403, {"error": "The waitlist is not open."})
        if not self.allow_waitlist_post(self.client_ip(handler)):
            return self.send(handler, 429, {"error": "Too many waitlist tries. Wait and try again."})
        body = self.read_json(handler)
        parent = clip(body.get("parentName"), 120)
        if len(parent) < 2:
            raise ValueError("Enter the parent or guardian name.")
        email = clip(body.get("email"), 160)
        if not EMAIL_RE.match(email):
            raise ValueError("Enter an email address.")
        phone = self.waiver_phone(body.get("phone"), "phone number")
        child = clip(body.get("childName"), 40)
        if len(child) < 2:
            raise ValueError("Enter the child's first name.")
        note = clip(body.get("note"), 500)
        age_group = body.get("ageGroup")
        if age_group not in ("mite", "upper"):
            raise ValueError("Choose an age group.")
        typed_age = body.get("age")
        age = None
        if typed_age not in (None, ""):
            try:
                age = int(typed_age)
            except (TypeError, ValueError) as err:
                raise ValueError("Enter the child's age.") from err
        dob = ""
        dob_age = None
        if clip(body.get("dob"), 10):
            dob, dob_age = self.waiver_age(body.get("dob"))
        if age is None and dob_age is None:
            raise ValueError("Enter the child's age or date of birth.")
        if age is not None and dob_age is not None and age != dob_age:
            raise ValueError("The age and date of birth do not match.")
        if age is None:
            age = dob_age
        if not self.counts_as_kid(age):
            raise ValueError("The kids class is for ages 3–10.")
        if body.get("confirmAgeGroup") is not True:
            raise ValueError("Confirm the age group.")
        expected = "mite" if 3 <= age <= 6 else "upper"
        if age_group != expected:
            raise ValueError("Choose the age group that matches the child's age.")
        age_group = expected
        conn = self.db()
        try:
            self.lock_kids(conn)
            if not self.enrollment_snapshot(conn)["full"]:
                conn.rollback()
                return self.send(handler, 409, {"error": "A spot is open right now. Use the enrollment form."})
            wanted_email = email.casefold()
            wanted_child = self.norm_name(child)
            for existing in self.waitlist_active_rows(conn):
                if existing["email"].casefold() == wanted_email and self.norm_name(existing["child_name"]) == wanted_child:
                    conn.rollback()
                    return self.send(handler, 409, {"error": "This child is already on the waitlist."})
            wid = new_id("q-")
            created = utcnow().strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            conn.execute(
                """
                INSERT INTO waitlist (
                  id, created_at, parent_name, email, phone, child_name, child_age, dob, age_group, note, status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')
                """,
                (wid, created, parent, email, phone, child, age, dob, age_group, note),
            )
            conn.commit()
            rows = [row for row in self.waitlist_active_rows(conn) if row["age_group"] == age_group]
            position = 1
            for index, row in enumerate(rows):
                if row["id"] == wid:
                    position = index + 1
                    break
        finally:
            conn.close()
        return self.send(
            handler,
            201,
            {
                "id": wid,
                "position": position,
                "ageGroup": age_group,
                "ageGroupLabel": self.waitlist_group_label(age_group),
            },
        )

    def new_parent_token(self, conn):
        for _ in range(5):
            token = secrets.token_urlsafe(24)
            taken = conn.execute("SELECT 1 FROM students WHERE parent_token = ?", (token,)).fetchone()
            if not taken:
                return token
        raise ValueError("Could not make a card code.")

    def waiver_for_student(self, conn, sid):
        row = conn.execute(
            """
            SELECT id, signed_on, signer_name FROM waivers
            WHERE roster_student_id = ? AND added_to_roster = 1
            ORDER BY submitted_at DESC LIMIT 1
            """,
            (sid,),
        ).fetchone()
        if not row:
            return {"signed": False, "signedOn": "", "signerName": "", "waiverId": ""}
        return {
            "signed": True,
            "signedOn": row["signed_on"] or "",
            "signerName": row["signer_name"] or "",
            "waiverId": row["id"],
        }

    def belt_words(self, belt):
        parts = [part for part in str(belt or "white").split("-") if part]
        if not parts:
            return "White"
        return "-".join(part[:1].upper() + part[1:] for part in parts)

    def stripes_words(self, stripes):
        try:
            count = int(stripes)
        except (TypeError, ValueError):
            count = 0
        count = max(0, min(4, count))
        if count == 0:
            return "no stripes"
        if count == 1:
            return "1 stripe"
        return f"{count} stripes"

    def age_group_label(self, age):
        try:
            number = int(age)
        except (TypeError, ValueError):
            return ""
        if 3 <= number <= 6:
            return "3–6 Mighty Mites"
        if 7 <= number <= 10:
            return "7–10 Pee Wees"
        if 11 <= number <= 17:
            return "11–17"
        if number >= 18:
            return "18 and up"
        return ""

    def first_name(self, name):
        parts = str(name or "").split()
        return parts[0] if parts else ""

    def dob_month_day(self, dob):
        text = str(dob or "")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
            return None
        try:
            born = datetime.strptime(text, "%Y-%m-%d").date()
        except ValueError:
            return None
        if born.isoformat() != text:
            return None
        return born.month, born.day

    def parent_token_row(self, conn, token):
        text = str(token or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", text):
            return None
        return conn.execute("SELECT * FROM students WHERE parent_token = ?", (text,)).fetchone()

    def parent_month_day(self, month, day):
        try:
            month_n = int(month)
            day_n = int(day)
        except (TypeError, ValueError):
            return None
        if not (1 <= month_n <= 12 and 1 <= day_n <= 31):
            return None
        return month_n, day_n

    def parent_attempt_open(self, ip, token):
        now = utcnow().timestamp()
        self._parent_fails = [item for item in self._parent_fails if now - item[0] < 3600]
        token_fails = sum(1 for item in self._parent_fails if item[2] == token)
        ip_fails = sum(1 for item in self._parent_fails if item[1] == ip)
        return token_fails < 5 and ip_fails < 40

    def note_parent_failure(self, ip, token):
        self._parent_fails.append((utcnow().timestamp(), ip, str(token or "")))

    def cookie_value(self, handler, name):
        header = handler.headers.get("Cookie", "")
        for part in header.split(";"):
            key, _, value = part.strip().partition("=")
            if key == name and value:
                return value
        return ""

    def parent_cookie(self, token, max_age):
        parts = [
            f"{PARENT_COOKIE}={token}",
            "HttpOnly",
            "SameSite=Lax",
            f"Path={self.cookie_path()}",
            f"Max-Age={max_age}",
        ]
        if self.cfg["secure"]:
            parts.append("Secure")
        return "; ".join(parts)

    def issue_parent_grant(self, student_id):
        now = utcnow().timestamp()
        self._parent_grants = {
            key: row for key, row in self._parent_grants.items() if row["exp"] > now
        }
        grant = secrets.token_urlsafe(24)
        self._parent_grants[grant] = {"student_id": student_id, "exp": now + PARENT_GRANT_SECONDS}
        return grant

    def drop_parent_grants(self, student_id):
        self._parent_grants = {
            key: row for key, row in self._parent_grants.items() if row["student_id"] != student_id
        }

    def parent_grant_student(self, handler):
        grant = self.cookie_value(handler, PARENT_COOKIE)
        row = self._parent_grants.get(grant)
        if not row or row["exp"] <= utcnow().timestamp():
            return ""
        return row["student_id"]

    def adult_curriculum(self):
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "adult-curriculum-blue.json")
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
        if not isinstance(data, dict):
            return {"levels": []}
        return data

    def adult_curriculum_public(self):
        data = self.adult_curriculum()
        levels = []
        for level in data.get("levels") or []:
            if not isinstance(level, dict):
                continue
            classes = []
            for item in level.get("classes") or []:
                if not isinstance(item, dict):
                    continue
                techniques = [str(name) for name in (item.get("techniques") or []) if str(name).strip()]
                try:
                    number = int(item.get("number"))
                except (TypeError, ValueError):
                    continue
                classes.append({"number": number, "techniques": techniques})
            levels.append({
                "id": str(level.get("id") or ""),
                "fromBelt": str(level.get("fromBelt") or ""),
                "toBelt": str(level.get("toBelt") or ""),
                "label": str(level.get("label") or ""),
                "classes": classes,
            })
        return {"levels": levels}

    def adult_level_class(self, level_id, number):
        for level in self.adult_curriculum_public()["levels"]:
            if level["id"] != level_id:
                continue
            for item in level["classes"]:
                if item["number"] == number:
                    return level, item
        return None, None

    def adult_checks_map(self, conn):
        grouped = {}
        rows = conn.execute(
            "SELECT student_id, level_id, class_number, technique_index, stage FROM adult_progress"
        ).fetchall()
        top = LEVELS[-1]
        for row in rows:
            student = grouped.setdefault(row["student_id"], {})
            level = student.setdefault(row["level_id"], {})
            bucket = level.setdefault(str(row["class_number"]), {})
            stage = canonical_level(row["stage"]) or top
            bucket[str(int(row["technique_index"]))] = stage
        return grouped

    def adult_attendance_list(self, conn):
        rows = conn.execute("SELECT id, date, attended FROM adult_classes ORDER BY date").fetchall()
        return [
            {"id": row["id"], "date": row["date"], "attended": self.json_list(row["attended"])}
            for row in rows
        ]

    def save_level(self, handler, conn, user):
        body = self.read_json(handler)
        sid = clean_id(body.get("studentId"))
        tid = clean_id(body.get("techId"))
        level = canonical_level(body.get("level"))
        if not sid or not tid or not level:
            raise ValueError("That progress update is missing a student, a technique, or a level.")
        blocked = self.block_self_edit(handler, conn, user, sid)
        if blocked:
            return blocked
        student = conn.execute("SELECT name FROM students WHERE id = ?", (sid,)).fetchone()
        previous = conn.execute(
            "SELECT level FROM levels WHERE student_id = ? AND tech_id = ?",
            (sid, tid),
        ).fetchone()
        before = canonical_level(previous["level"]) if previous else ""
        conn.execute(
            """
            INSERT INTO levels (student_id, tech_id, level) VALUES (?, ?, ?)
            ON CONFLICT(student_id, tech_id) DO UPDATE SET level = excluded.level
            """,
            (sid, tid, level),
        )
        if before != level and student:
            self.append_change(
                conn,
                user,
                sid,
                student["name"],
                "stage",
                {"techId": tid, "stage": before},
                {"techId": tid, "stage": level},
            )
        conn.commit()
        return self.send(handler, 200, {"ok": True})

    def clear_level(self, handler, conn, user):
        body = self.read_json(handler)
        sid = clean_id(body.get("studentId"))
        tid = clean_id(body.get("techId"))
        if not sid or not tid:
            raise ValueError("That progress update is missing a student or a technique.")
        blocked = self.block_self_edit(handler, conn, user, sid)
        if blocked:
            return blocked
        student = conn.execute("SELECT name FROM students WHERE id = ?", (sid,)).fetchone()
        previous = conn.execute(
            "SELECT level FROM levels WHERE student_id = ? AND tech_id = ?",
            (sid, tid),
        ).fetchone()
        before = canonical_level(previous["level"]) if previous else ""
        conn.execute("DELETE FROM levels WHERE student_id = ? AND tech_id = ?", (sid, tid))
        if before and student:
            self.append_change(
                conn,
                user,
                sid,
                student["name"],
                "stage",
                {"techId": tid, "stage": before},
                {"techId": tid, "stage": ""},
            )
        conn.commit()
        return self.send(handler, 200, {"ok": True})

    def set_student_rank(self, handler, conn, user, sid):
        body = self.read_json(handler)
        row = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That student is not on the roster."})
        blocked = self.block_self_edit(handler, conn, user, sid)
        if blocked:
            return blocked
        adult = (self.cell(row, "program", "kids") or "kids") == "adult"
        if "belt" in body and body.get("belt") not in (None, ""):
            belt = body.get("belt")
            allowed = ADULT_BELTS if adult else BELTS
            if belt not in allowed:
                if adult:
                    raise ValueError("Adult belts are white, blue, purple, brown, or black.")
                raise ValueError("That belt is not on the kids list.")
        else:
            belt = row["belt"]
        if "stripes" in body and body.get("stripes") not in (None, ""):
            stripes = self.stripe_value(body.get("stripes"))
        else:
            stripes = int(row["stripes"])
        before_belt = row["belt"]
        before_stripes = int(row["stripes"])
        conn.execute("UPDATE students SET belt = ?, stripes = ? WHERE id = ?", (belt, stripes, sid))
        if belt != before_belt:
            self.append_change(
                conn,
                user,
                sid,
                row["name"],
                "belt",
                {"belt": before_belt},
                {"belt": belt},
            )
        if stripes != before_stripes:
            self.append_change(
                conn,
                user,
                sid,
                row["name"],
                "stripes",
                {"stripes": before_stripes},
                {"stripes": stripes},
            )
        conn.commit()
        fresh = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        return self.send(handler, 200, self.student_json(fresh, conn))

    def rename_student(self, handler, conn, user, sid):
        body = self.read_json(handler)
        row = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That student is not on the roster."})
        blocked = self.block_self_edit(handler, conn, user, sid)
        if blocked:
            return blocked
        if (self.cell(row, "program", "kids") or "kids") == "adult":
            raise ValueError("That name edit is for a kids student.")
        name = clip(body.get("name"), 40)
        if not name:
            raise ValueError("Add the student's name.")
        old = row["name"]
        if name != old:
            conn.execute("UPDATE students SET name = ? WHERE id = ?", (name, sid))
            self.append_change(
                conn,
                user,
                sid,
                name,
                "rename",
                {"name": old},
                {"name": name},
            )
            conn.commit()
        fresh = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        return self.send(handler, 200, self.student_json(fresh, conn))

    def student_attendance_dates(self, conn, sid, program):
        if program == "adult":
            dates = []
            for entry in self.adult_attendance_list(conn):
                if sid in entry["attended"] and entry["date"] and entry["date"] not in dates:
                    dates.append(entry["date"])
            dates.sort(reverse=True)
            return dates
        dates = []
        rows = conn.execute("SELECT date, attended FROM classes ORDER BY date DESC").fetchall()
        for row in rows:
            if sid in self.json_list(row["attended"]) and row["date"] and row["date"] not in dates:
                dates.append(row["date"])
        return dates

    def set_adult_present(self, conn, sid, date, present):
        row = conn.execute("SELECT id, attended FROM adult_classes WHERE date = ?", (date,)).fetchone()
        if present:
            if row:
                attended = self.json_list(row["attended"])
                if sid in attended:
                    return False
                attended.append(sid)
                conn.execute(
                    "UPDATE adult_classes SET attended = ? WHERE id = ?",
                    (json.dumps(attended), row["id"]),
                )
                return True
            conn.execute(
                "INSERT INTO adult_classes (id, date, attended) VALUES (?, ?, ?)",
                (new_id("ac-"), date, json.dumps([sid])),
            )
            return True
        if not row:
            return False
        attended = self.json_list(row["attended"])
        if sid not in attended:
            return False
        attended = [item for item in attended if item != sid]
        conn.execute(
            "UPDATE adult_classes SET attended = ? WHERE id = ?",
            (json.dumps(attended), row["id"]),
        )
        return True

    def kid_class_targets(self, conn, date, age_group):
        rows = conn.execute("SELECT * FROM classes WHERE date = ?", (date,)).fetchall()
        exact = [row for row in rows if (row["age_group"] or "") == age_group]
        if exact:
            return exact
        return [row for row in rows if age_group and age_group in (row["age_group"] or "").split("+")]

    def set_kid_present(self, conn, student, date, present):
        sid = student["id"]
        age_group = age_group_for_age(student["age"])
        if not age_group:
            raise ValueError("That student is not in a kids class.")
        updated = []
        if present:
            rows = self.kid_class_targets(conn, date, age_group)
            if rows:
                changed = False
                for row in rows:
                    attended = self.json_list(row["attended"])
                    if sid not in attended:
                        attended.append(sid)
                        changed = True
                    conn.execute(
                        "UPDATE classes SET attended = ? WHERE id = ?",
                        (json.dumps(attended), row["id"]),
                    )
                    fresh = conn.execute("SELECT * FROM classes WHERE id = ?", (row["id"],)).fetchone()
                    updated.append(self.class_json(fresh))
                return changed, updated
            cid = new_id("k-")
            conn.execute(
                """
                INSERT INTO classes (id, date, age_group, theme, theme_label, techniques, game, attended, taught)
                VALUES (?, ?, ?, '', '', '[]', '', ?, 1)
                """,
                (cid, date, age_group, json.dumps([sid])),
            )
            fresh = conn.execute("SELECT * FROM classes WHERE id = ?", (cid,)).fetchone()
            return True, [self.class_json(fresh)]
        changed = False
        for row in conn.execute("SELECT * FROM classes WHERE date = ?", (date,)).fetchall():
            attended = self.json_list(row["attended"])
            if sid not in attended:
                continue
            attended = [item for item in attended if item != sid]
            conn.execute(
                "UPDATE classes SET attended = ? WHERE id = ?",
                (json.dumps(attended), row["id"]),
            )
            fresh = conn.execute("SELECT * FROM classes WHERE id = ?", (row["id"],)).fetchone()
            updated.append(self.class_json(fresh))
            changed = True
        return changed, updated

    def set_student_attendance(self, handler, conn, user, sid):
        body = self.read_json(handler)
        date = self.clean_dob(body.get("date"))
        if not date:
            raise ValueError("Choose a class date.")
        if date > today_pacific():
            raise ValueError("Choose a class date that is today or earlier.")
        present = body.get("present")
        if present is not True and present is not False:
            raise ValueError("Say whether the student was here.")
        student = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
        if not student:
            return self.send(handler, 404, {"error": "That student is not on the roster."})
        blocked = self.block_self_edit(handler, conn, user, sid)
        if blocked:
            return blocked
        program = self.cell(student, "program", "kids") or "kids"
        if program == "adult":
            changed = self.set_adult_present(conn, sid, date, present)
            classes = []
        else:
            changed, classes = self.set_kid_present(conn, student, date, present)
        if changed:
            self.append_change(
                conn,
                user,
                sid,
                student["name"],
                "attendance_add" if present else "attendance_remove",
                {"date": date, "present": not present},
                {"date": date, "present": present},
            )
        conn.commit()
        payload = {
            "dates": self.student_attendance_dates(conn, sid, program),
            "present": present,
            "date": date,
        }
        if program == "adult":
            payload["adultAttendance"] = self.adult_attendance_list(conn)
        else:
            payload["classes"] = classes
        return self.send(handler, 200, payload)

    def link_staff_member(self, handler, conn, actor, uid):
        blocked = self.block_own_link(handler, conn, actor, uid)
        if blocked:
            return blocked
        body = self.read_json(handler)
        sid = clean_id(body.get("studentId")) or ""
        target = conn.execute(
            "SELECT id, username, password_hash, role FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
        if not target:
            return self.send(handler, 404, {"error": "That login is already gone."})
        before_hash = target["password_hash"]
        before_role = target["role"]
        before_username = target["username"]
        student = conn.execute(
            "SELECT id, name, program FROM students WHERE id = ?",
            (sid,),
        ).fetchone()
        if not student:
            return self.send(handler, 404, {"error": "That student is not on the roster."})
        if (student["program"] or "kids") != "adult":
            raise ValueError("Link a staff login to an adult roster student.")
        current = conn.execute(
            "SELECT student_id FROM staff_member_links WHERE user_id = ?",
            (uid,),
        ).fetchone()
        if current and current["student_id"] != sid:
            raise ValueError("That login is already linked to a member. Unlink it first.")
        other = conn.execute(
            "SELECT user_id FROM staff_member_links WHERE student_id = ?",
            (sid,),
        ).fetchone()
        if other and other["user_id"] != uid:
            raise ValueError("That member is already linked to a staff login. Unlink it first.")
        if not current:
            self.append_change(
                conn,
                actor,
                sid,
                student["name"],
                "staff_link",
                {"userId": "", "username": target["username"], "studentId": ""},
                {
                    "userId": uid,
                    "username": target["username"],
                    "studentId": sid,
                    "studentName": student["name"],
                    "soleAdmin": self.sole_admin(conn, actor) and actor["id"] == uid,
                },
            )
            conn.execute(
                "INSERT INTO staff_member_links (user_id, student_id) VALUES (?, ?)",
                (uid, sid),
            )
        conn.commit()
        after = conn.execute(
            "SELECT username, password_hash, role FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
        if (
            after["password_hash"] != before_hash
            or after["role"] != before_role
            or after["username"] != before_username
        ):
            raise ValueError("That link could not be saved.")
        member_id, member_name = self.member_for_user(conn, uid)
        public = self.user_public(conn, uid)
        public["memberStudentId"] = member_id
        public["memberName"] = member_name
        return self.send(handler, 200, public)

    def unlink_staff_member(self, handler, conn, actor, uid):
        blocked = self.block_own_link(handler, conn, actor, uid)
        if blocked:
            return blocked
        target = conn.execute("SELECT id, username FROM users WHERE id = ?", (uid,)).fetchone()
        if not target:
            return self.send(handler, 404, {"error": "That login is already gone."})
        current = conn.execute(
            """
            SELECT staff_member_links.student_id AS student_id, students.name AS student_name
            FROM staff_member_links
            LEFT JOIN students ON students.id = staff_member_links.student_id
            WHERE staff_member_links.user_id = ?
            """,
            (uid,),
        ).fetchone()
        if current:
            self.append_change(
                conn,
                actor,
                current["student_id"] or "",
                current["student_name"] or "",
                "staff_unlink",
                {"userId": uid, "username": target["username"], "studentId": current["student_id"] or ""},
                {"userId": "", "username": target["username"], "studentId": ""},
            )
            conn.execute("DELETE FROM staff_member_links WHERE user_id = ?", (uid,))
            conn.commit()
        public = self.user_public(conn, uid)
        public["memberStudentId"] = ""
        public["memberName"] = ""
        return self.send(handler, 200, public)

    def list_change_log(self, handler, conn):
        parsed = urlparse(handler.path)
        query = parse_qs(parsed.query)
        student_id = clean_id((query.get("studentId") or [""])[0]) or ""
        actor_id = clean_id((query.get("actorId") or [""])[0]) or ""
        clauses = []
        params = []
        if student_id:
            clauses.append("student_id = ?")
            params.append(student_id)
        if actor_id:
            clauses.append("actor_id = ?")
            params.append(actor_id)
        sql = "SELECT * FROM change_log"
        if clauses:
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY id DESC LIMIT 200"
        rows = conn.execute(sql, params).fetchall()
        return self.send(handler, 200, {"entries": [self.change_json(row) for row in rows]})

    def set_adult_progress(self, handler, conn, user):
        body = self.read_json(handler)
        sid = clean_id(body.get("studentId"))
        level_id = clip(body.get("levelId"), 40)
        try:
            number = int(body.get("classNumber"))
            index = int(body.get("techniqueIndex"))
        except (TypeError, ValueError):
            raise ValueError("Choose a class and a technique.")
        student = conn.execute("SELECT id, name, program FROM students WHERE id = ?", (sid,)).fetchone()
        if not student or (student["program"] or "kids") != "adult":
            return self.send(handler, 404, {"error": "That adult student is not on the roster."})
        blocked = self.block_self_edit(handler, conn, user, sid)
        if blocked:
            return blocked
        _level, item = self.adult_level_class(level_id, number)
        if not item or index < 0 or index >= len(item["techniques"]):
            raise ValueError("That technique is not on this curriculum.")
        stage = canonical_level(body.get("stage"))
        if not stage and body.get("checked") is True:
            stage = LEVELS[-1]
        previous = conn.execute(
            """
            SELECT stage FROM adult_progress
            WHERE student_id = ? AND level_id = ? AND class_number = ? AND technique_index = ?
            """,
            (sid, level_id, number, index),
        ).fetchone()
        before = canonical_level(previous["stage"]) if previous else ""
        after = stage or ""
        if stage:
            conn.execute(
                """
                INSERT INTO adult_progress (student_id, level_id, class_number, technique_index, checked_at, stage)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_id, level_id, class_number, technique_index)
                DO UPDATE SET stage = excluded.stage, checked_at = excluded.checked_at
                """,
                (sid, level_id, number, index, iso(utcnow()), stage),
            )
        else:
            conn.execute(
                """
                DELETE FROM adult_progress
                WHERE student_id = ? AND level_id = ? AND class_number = ? AND technique_index = ?
                """,
                (sid, level_id, number, index),
            )
        if before != after:
            tech = item["techniques"][index]
            self.append_change(
                conn,
                user,
                sid,
                student["name"],
                "stage",
                {"levelId": level_id, "classNumber": number, "techniqueIndex": index, "technique": tech, "stage": before},
                {"levelId": level_id, "classNumber": number, "techniqueIndex": index, "technique": tech, "stage": after},
            )
        conn.commit()
        return self.send(handler, 200, {"adultChecks": self.adult_checks_map(conn)})

    def mark_adult_attendance(self, handler, conn):
        body = self.read_json(handler)
        sid = clean_id(body.get("studentId"))
        date = self.clean_dob(body.get("date"))
        if not date:
            raise ValueError("Choose a class date.")
        student = conn.execute("SELECT id, program FROM students WHERE id = ?", (sid,)).fetchone()
        if not student or (student["program"] or "kids") != "adult":
            return self.send(handler, 404, {"error": "That adult student is not on the roster."})
        row = conn.execute("SELECT id, attended FROM adult_classes WHERE date = ?", (date,)).fetchone()
        if row:
            attended = self.json_list(row["attended"])
            if sid not in attended:
                attended.append(sid)
            conn.execute(
                "UPDATE adult_classes SET attended = ? WHERE id = ?",
                (json.dumps(attended), row["id"]),
            )
        else:
            conn.execute(
                "INSERT INTO adult_classes (id, date, attended) VALUES (?, ?, ?)",
                (new_id("ac-"), date, json.dumps([sid])),
            )
        conn.commit()
        return self.send(handler, 200, {"adultAttendance": self.adult_attendance_list(conn)})

    def adult_curriculum_counts(self, conn, sid):
        curriculum = self.adult_curriculum_public()
        level = curriculum["levels"][0] if curriculum["levels"] else None
        if not level:
            return 0, 0, 0, ""
        checked = {}
        rows = conn.execute(
            """
            SELECT class_number, technique_index, stage FROM adult_progress
            WHERE student_id = ? AND level_id = ?
            """,
            (sid, level["id"]),
        ).fetchall()
        top = LEVELS[-1]
        for row in rows:
            stage = canonical_level(row["stage"]) or top
            checked.setdefault(int(row["class_number"]), {})[int(row["technique_index"])] = stage
        done = 0
        techniques = 0
        for item in level["classes"]:
            marks = checked.get(item["number"], {})
            techniques += len(marks)
            names = item["techniques"]
            if names and all(marks.get(index) == top for index in range(len(names))):
                done += 1
        return done, len(level["classes"]), techniques, level.get("label") or ""

    def parent_progress(self, conn, sid):
        row = conn.execute("SELECT program FROM students WHERE id = ?", (sid,)).fetchone()
        if row and (row["program"] or "") == "adult":
            done, total, techniques, label = self.adult_curriculum_counts(conn, sid)
            recent = []
            classes = 0
            for entry in self.adult_attendance_list(conn):
                if sid not in entry["attended"]:
                    continue
                classes += 1
                if entry["date"]:
                    recent.append(entry["date"])
            recent = list(reversed(recent))[:6]
            return {
                "techniques": techniques,
                "classes": classes,
                "recentAttendance": recent,
                "classesDone": done,
                "classesTotal": total,
                "levelLabel": label,
            }
        techniques = conn.execute(
            "SELECT COUNT(*) AS n FROM levels WHERE student_id = ?",
            (sid,),
        ).fetchone()["n"]
        recent = []
        classes = 0
        rows = conn.execute("SELECT date, attended FROM classes ORDER BY date DESC").fetchall()
        for row in rows:
            if sid not in self.json_list(row["attended"]):
                continue
            classes += 1
            if len(recent) < 6 and row["date"]:
                recent.append(row["date"])
        return {"techniques": int(techniques), "classes": classes, "recentAttendance": recent}

    def parent_profile(self, conn, row):
        age = row["age"]
        group = self.age_group_label(age)
        try:
            number = int(age)
        except (TypeError, ValueError):
            number = 0
        waiver = self.waiver_for_student(conn, row["id"])
        return {
            "firstName": self.first_name(row["name"]),
            "ageGroup": group,
            "belt": row["belt"],
            "beltLabel": self.belt_words(row["belt"]),
            "stripes": int(row["stripes"]),
            "stripesLabel": self.stripes_words(row["stripes"]),
            "signForm": "kids" if 3 <= number <= 10 else "adult",
            "progress": self.parent_progress(conn, row["id"]),
            "waiver": {
                "signed": waiver["signed"],
                "signedOn": waiver["signedOn"],
                "signerName": waiver["signerName"],
            },
        }

    def parent_send(self, handler, status, body, grant=""):
        extra = None
        if grant:
            extra = [self.parent_cookie(grant, PARENT_GRANT_SECONDS)]
        return self.send(handler, status, body, extra_cookies=extra, robots=True)

    def public_parent_check(self, handler):
        body = self.read_json(handler)
        token = str(body.get("token") or "").strip()
        ip = self.client_ip(handler)
        if not self.parent_attempt_open(ip, token):
            return self.parent_send(handler, 429, {"error": PARENT_LIMIT})
        pair = self.parent_month_day(body.get("month"), body.get("day"))
        pin = clip(body.get("pin"), 8)
        conn = self.db()
        try:
            row = self.parent_token_row(conn, token)
            if not row:
                self.note_parent_failure(ip, token)
                return self.parent_send(handler, 400, {"error": PARENT_MISS})
            pin_hash = self.cell(row, "card_pin_hash", "") or ""
            if pin_hash:
                if not re.fullmatch(r"[0-9]{4}", pin) or not check_password(pin, pin_hash):
                    self.note_parent_failure(ip, token)
                    return self.parent_send(handler, 400, {"error": PARENT_MISS})
            else:
                if not pair:
                    self.note_parent_failure(ip, token)
                    return self.parent_send(handler, 400, {"error": PARENT_MISS})
                born = self.dob_month_day(row["dob"] or "")
                if not born:
                    return self.parent_send(handler, 400, {"error": PARENT_INCOMPLETE})
                if born != pair:
                    self.note_parent_failure(ip, token)
                    return self.parent_send(handler, 400, {"error": PARENT_MISS})
            profile = self.parent_profile(conn, row)
            grant = self.issue_parent_grant(row["id"])
        finally:
            conn.close()
        return self.parent_send(handler, 200, profile, grant)

    def public_parent_grant(self, handler):
        sid = self.parent_grant_student(handler)
        if not sid:
            return self.parent_send(handler, 401, {"error": PARENT_MISS})
        conn = self.db()
        try:
            row = conn.execute("SELECT * FROM students WHERE id = ?", (sid,)).fetchone()
            if not row:
                return self.parent_send(handler, 401, {"error": PARENT_MISS})
            return self.parent_send(handler, 200, self.parent_profile(conn, row))
        finally:
            conn.close()

    def public_parent_waiver(self, handler):
        sid = self.parent_grant_student(handler)
        if not sid:
            return self.parent_send(handler, 401, {"error": PARENT_MISS})
        conn = self.db()
        try:
            row = conn.execute(
                """
                SELECT participant_name, signer_name, signed_on, signature_png, parent_signature_png, kind
                FROM waivers
                WHERE roster_student_id = ? AND added_to_roster = 1
                ORDER BY submitted_at DESC LIMIT 1
                """,
                (sid,),
            ).fetchone()
            if not row:
                return self.parent_send(handler, 404, {"error": "No signed enrollment form is on file."})
            body = {
                "participantName": row["participant_name"],
                "signerName": row["signer_name"],
                "signedOn": row["signed_on"],
                "signature": row["signature_png"],
                "kind": row["kind"],
            }
            parent_sig = row["parent_signature_png"] or ""
            if parent_sig:
                body["parentSignature"] = parent_sig
            return self.parent_send(handler, 200, body)
        finally:
            conn.close()

    def public_demo_examples(self, handler):
        conn = self.db()
        try:
            marker = conn.execute("SELECT value FROM settings WHERE key = 'demo_seed'").fetchone()
            if not marker or marker["value"] != "1":
                return self.send(handler, 404, {"error": "Not found."})
            wanted = (
                ("demo-milo", "EXAMPLE signed waiver", ""),
                ("demo-tess", "EXAMPLE waiver not signed", ""),
                ("demo-quinn", "EXAMPLE adult signed", "2468"),
                ("demo-uma", "EXAMPLE adult not signed", ""),
            )
            examples = []
            for sid, label, pin in wanted:
                row = conn.execute(
                    "SELECT dob, parent_token FROM students WHERE id = ?",
                    (sid,),
                ).fetchone()
                born = self.dob_month_day(row["dob"] if row else "")
                token = (row["parent_token"] if row else "") or ""
                if not born or not re.fullmatch(r"[A-Za-z0-9_-]{20,80}", token):
                    continue
                item = {
                    "label": label,
                    "token": token,
                    "month": born[0],
                    "day": born[1],
                }
                if pin:
                    item["pin"] = pin
                examples.append(item)
            return self.send(handler, 200, {"examples": examples}, robots=True)
        finally:
            conn.close()

    def rotate_parent_token(self, handler, conn, sid):
        row = conn.execute("SELECT id FROM students WHERE id = ?", (sid,)).fetchone()
        if not row:
            return self.send(handler, 404, {"error": "That student is not on the roster."})
        body = self.read_json(handler)
        self.drop_parent_grants(sid)
        if body.get("revoke") is True:
            conn.execute("UPDATE students SET parent_token = '' WHERE id = ?", (sid,))
            conn.commit()
            return self.send(handler, 200, {"parentToken": ""})
        token = self.new_parent_token(conn)
        conn.execute("UPDATE students SET parent_token = ? WHERE id = ?", (token, sid))
        conn.commit()
        return self.send(handler, 200, {"parentToken": token})

    def waiver_parent_match(self, conn, body):
        token = str(body.get("parentToken") or "").strip()
        if not token:
            return None
        pair = self.parent_month_day(body.get("birthMonth"), body.get("birthDay"))
        row = self.parent_token_row(conn, token)
        if not row or not pair:
            return "miss"
        born = self.dob_month_day(row["dob"] or "")
        if not born:
            return "incomplete"
        if born != pair:
            return "miss"
        return row

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
        pin = clip(body.get("cardPin") or body.get("pin"), 8)
        if kind == "adult" and not re.fullmatch(r"[0-9]{4}", pin):
            if minor:
                raise ValueError("The parent or guardian sets a 4-digit PIN.")
            raise ValueError("Enter a 4-digit PIN.")
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
            linked = self.waiver_parent_match(conn, body)
            if linked == "miss":
                conn.rollback()
                return self.send(handler, 400, {"error": PARENT_MISS})
            if linked == "incomplete":
                conn.rollback()
                return self.send(handler, 400, {"error": PARENT_INCOMPLETE})
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
            pin_hash = hash_password(pin) if kind == "adult" else ""
            if pin_hash:
                conn.execute(
                    "UPDATE waivers SET card_pin_hash = ? WHERE id = ?",
                    (pin_hash, wid),
                )
            # A parent card already names one student. Every other form waits
            # for staff to confirm a match or add the person. An exact name and
            # birth date is only a suggestion. A card from the other program
            # is not that student.
            if linked and kind == "adult" and (self.cell(linked, "program", "kids") or "kids") != "adult":
                linked = "miss"
            if linked and kind == "kids" and (self.cell(linked, "program", "kids") or "kids") == "adult":
                linked = "miss"
            if linked == "miss":
                conn.rollback()
                return self.send(handler, 400, {"error": PARENT_MISS})
            if linked:
                self.link_waiver_row(conn, wid, linked["id"])
                self.remember_dob(conn, linked["id"], dob)
                self.apply_waiver_pin(conn, wid, linked["id"])
            if kind == "kids":
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

    def send(self, handler, status, body, set_cookie=None, clear_cookie=False, extra_cookies=None, robots=False):
        raw = json.dumps(body).encode("utf-8")
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(raw)))
        handler.send_header("Cache-Control", "no-store")
        if robots:
            handler.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        self.security_headers(handler)
        if set_cookie:
            handler.send_header("Set-Cookie", self.cookie(set_cookie, SESSION_DAYS * 86400))
        if extra_cookies:
            for item in extra_cookies:
                handler.send_header("Set-Cookie", item)
        if clear_cookie:
            handler.send_header("Set-Cookie", self.cookie("", 0))
        handler.end_headers()
        if not getattr(handler, "_bjj_head", False):
            try:
                handler.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                return None

    def cookie(self, token, max_age):
        parts = [
            f"{self.cookie_name()}={token}",
            "HttpOnly",
            "SameSite=Lax",
            f"Path={self.cookie_path()}",
            f"Max-Age={max_age}",
        ]
        if self.cfg["secure"]:
            parts.append("Secure")
        return "; ".join(parts)

    def static_cache_control(self, rel):
        path = (rel or "").split("?", 1)[0]
        if path == "/p" or path.startswith("/p/"):
            return "no-store"
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
