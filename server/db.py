"""SQLite storage. The database file is never served by nginx."""

import hashlib
import json
import os
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone

BELTS = [
    "white",
    "grey-white",
    "grey",
    "grey-black",
    "yellow-white",
    "yellow",
    "yellow-black",
    "orange-white",
    "orange",
    "orange-black",
    "green-white",
    "green",
    "green-black",
]
LEVELS = ("introduced", "practicing", "help", "own")
AGE_GROUPS = ("mite", "upper", "toddler")
GRACE_AGES = ("mite", "upper")
LEGACY_CLASS_PARTS = ("peewee", "junior", "teen")
CLASS_AGE_MAP = {
    "mite": "mite",
    "upper": "upper",
    "peewee": "upper",
    "junior": "upper",
    "teen": "upper",
}
ADULT_BELTS = ("white", "blue", "purple", "brown", "black")
# Representative age when a blank card is claimed with a class and no number.
AGE_GROUP_AGES = {
    "toddler": 4,
    "mite": 5,
    "upper": 9,
    # Old claim aliases fold into 7–10. The stand-in ages stay inside Pee Wees.
    "peewee": 8,
    "junior": 10,
    "teen": 10,
}
_PLAN_AGE_LABELS = {
    "4–6 Mighty Mite": "3–6 Mighty Mites",
    "4–6 Mighty Mites": "3–6 Mighty Mites",
    "Mighty Mite 4–6": "Mighty Mites 3–6",
    "4–7 Mighty Mites": "3–6 Mighty Mites",
    "Mighty Mites 4–7": "Mighty Mites 3–6",
    "7–9 Pee Wee": "7–10 Pee Wees",
    "Pee Wee 7–9": "Pee Wees 7–10",
    "8–10": "7–10 Pee Wees",
    "10–12 Junior": "7–10 Pee Wees",
    "Junior 10–12": "7–10 Pee Wees",
    "13–15 Teen": "7–10 Pee Wees",
    "Teen 13–15": "7–10 Pee Wees",
    "Combo class: 4–6 + 7–9": "Combo class: 3–6 + 7–10",
    "Combo class: 4–6 + 10–12": "Combo class: 3–6 + 7–10",
    "Combo class: 4–6 + 13–15": "Combo class: 3–6 + 7–10",
    "Combo class: 4–7 + 8–10": "Combo class: 3–6 + 7–10",
    "Combo class: 7–9 + 10–12": "7–10 Pee Wees",
    "Combo class: 7–9 + 13–15": "7–10 Pee Wees",
    "Combo class: 10–12 + 13–15": "7–10 Pee Wees",
}


def canonical_class_key(value):
    """Map a stored class key onto mite, upper, or a combo of those.

    Empty when the value is not a known class key. mite stays mite.
    peewee, junior, and teen fold into upper. A combo that mixes mite
    with any older group becomes mite+upper.
    """
    raw = str(value or "").strip().lower()
    if raw == "toddler":
        return "toddler"
    parts = []
    for piece in raw.split("+"):
        mapped = CLASS_AGE_MAP.get(piece.strip())
        if mapped and mapped not in parts:
            parts.append(mapped)
    if not parts:
        return ""
    parts.sort(key=GRACE_AGES.index)
    return "+".join(parts)


def is_legacy_storage_key(value):
    """True for a pre-change key that migration could not merge."""
    raw = str(value or "").strip().lower()
    if raw in LEGACY_CLASS_PARTS:
        return True
    parts = [piece.strip() for piece in raw.split("+") if piece.strip()]
    if len(parts) < 2:
        return False
    known = set(LEGACY_CLASS_PARTS) | set(GRACE_AGES)
    return any(piece in LEGACY_CLASS_PARTS for piece in parts) and all(piece in known for piece in parts)


def normalize_age_group(value):
    """Canonical class key stored in classes.age_group.

    mite is 3–6 Mighty Mites. upper is 7–10 Pee Wees. toddler stays the intro preset.
    Old peewee, junior, and teen keys fold into upper. Two groups become
    mite+upper, youngest first. Unknown text still becomes mite.
    """
    raw = str(value or "").strip().lower()
    if raw == "toddler":
        return "toddler"
    mapped = canonical_class_key(raw)
    return mapped or "mite"


def age_group_for_age(age):
    """Map a stored integer age onto a kids class.

    3–6 is mite (Mighty Mites). 7–10 is upper (Pee Wees).
    Younger than 3 and older than 10 stay outside these two class groups.
    A date of birth is stored on the student only when a kids enrollment
    form is linked, so that form is not counted a second time.
    """
    try:
        number = int(age)
    except (TypeError, ValueError):
        return ""
    if 3 <= number <= 6:
        return "mite"
    if 7 <= number <= 10:
        return "upper"
    return ""


def _map_technique_ages(ages):
    if not isinstance(ages, list):
        return ages
    has = set(ages)
    out = []
    if "mite" in has or "peewee" in has:
        out.append("mite")
    if "peewee" in has or "junior" in has or "upper" in has:
        out.append("upper")
    if "toddler" in has:
        out.append("toddler")
    if "teen" in has and not out:
        out.append("teen")
    return out


def _rewrite_plan_node(node):
    if isinstance(node, dict):
        if isinstance(node.get("ages"), list):
            node["ages"] = _map_technique_ages(node["ages"])
        if isinstance(node.get("ages"), str):
            node["ages"] = _PLAN_AGE_LABELS.get(node["ages"], node["ages"])
        if isinstance(node.get("ageGroup"), str):
            mapped = canonical_class_key(node["ageGroup"])
            if mapped:
                node["ageGroup"] = mapped
        for value in node.values():
            _rewrite_plan_node(value)
    elif isinstance(node, list):
        for item in node:
            _rewrite_plan_node(item)


def rewrite_plan_json(text, target_key):
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return text
    if not isinstance(data, dict):
        return text
    _rewrite_plan_node(data)
    settings = data.get("settings")
    if isinstance(settings, dict) and target_key:
        settings["ageGroup"] = target_key
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def migrate_age_groups(conn):
    """Fold old class keys into mite and upper. Never deletes a row.

    When two rows on the same date would share the new key, both stay
    and the one that could not move is recorded in age_group_flags.
    Safe to run more than once.
    """
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS age_group_flags (
          source TEXT NOT NULL,
          row_id TEXT NOT NULL,
          class_date TEXT NOT NULL,
          age_group TEXT NOT NULL,
          wanted TEXT NOT NULL,
          note TEXT NOT NULL,
          UNIQUE(source, row_id)
        )
        """
    )
    _migrate_age_rows(conn, "classes", "date", "id", None)
    _migrate_age_rows(conn, "lesson_plans", "class_date", "id", "plan_json")


def _migrate_age_rows(conn, table, date_col, id_col, json_column):
    extra = f", {json_column}" if json_column else ""
    rows = conn.execute(f"SELECT {id_col} AS row_id, {date_col} AS class_date, age_group{extra} FROM {table}").fetchall()
    occupied = {}
    planned = []
    for row in rows:
        target = canonical_class_key(row["age_group"])
        if not target or target == row["age_group"]:
            occupied[(row["class_date"], row["age_group"])] = row["row_id"]
            if json_column and target:
                rewritten = rewrite_plan_json(row[json_column], target)
                if rewritten != row[json_column]:
                    conn.execute(
                        f"UPDATE {table} SET {json_column} = ? WHERE {id_col} = ?",
                        (rewritten, row["row_id"]),
                    )
            continue
        planned.append(row)
    planned.sort(key=lambda row: (row["class_date"], row["row_id"]))
    for row in planned:
        target = canonical_class_key(row["age_group"])
        owner = occupied.get((row["class_date"], target))
        if owner and owner != row["row_id"]:
            conn.execute(
                """
                INSERT OR IGNORE INTO age_group_flags
                  (source, row_id, class_date, age_group, wanted, note)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    table,
                    row["row_id"],
                    row["class_date"],
                    row["age_group"],
                    target,
                    "Left this row unchanged because another row already uses the new age group for this date.",
                ),
            )
            continue
        occupied[(row["class_date"], target)] = row["row_id"]
        if json_column:
            rewritten = rewrite_plan_json(row[json_column], target)
            conn.execute(
                f"UPDATE {table} SET age_group = ?, {json_column} = ? WHERE {id_col} = ?",
                (target, rewritten, row["row_id"]),
            )
        else:
            conn.execute(
                f"UPDATE {table} SET age_group = ? WHERE {id_col} = ?",
                (target, row["row_id"]),
            )


def utcnow():
    return datetime.now(timezone.utc)


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def is_class_day(value):
    """2nd or 4th Tuesday on or after October 27, 2026. Calendar date, no timezone shift."""
    text = str(value or "").strip()
    try:
        when = datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return False
    if when.strftime("%Y-%m-%d") != text:
        return False
    if when.weekday() != 1:
        return False
    which = (when.day - 1) // 7 + 1
    if which not in (2, 4):
        return False
    return text >= "2026-10-27"


def today_pacific():
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    except Exception:
        return datetime.now(timezone.utc).date().isoformat()


def order_lesson_plans(rows, today):
    """Upcoming class dates first, then earlier class dates newest first."""
    upcoming = [row for row in rows if row["class_date"] >= today]
    past = [row for row in rows if row["class_date"] < today]
    upcoming.sort(key=lambda row: (row["class_date"], row["age_group"]))
    past.sort(key=lambda row: (row["class_date"], row["age_group"]), reverse=True)
    return upcoming + past


def new_id(prefix):
    return prefix + secrets.token_hex(4)


def token_hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def connect(path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def migrate(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin', 'teacher')),
          created_at TEXT NOT NULL,
          must_change_password INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          csrf TEXT NOT NULL,
          expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS csrf_challenges (
          token TEXT PRIMARY KEY,
          expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS login_attempts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip TEXT NOT NULL,
          at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS students (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          age INTEGER NOT NULL,
          belt TEXT NOT NULL,
          stripes INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          dob TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS classes (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          age_group TEXT NOT NULL,
          theme TEXT NOT NULL DEFAULT '',
          theme_label TEXT NOT NULL DEFAULT '',
          techniques TEXT NOT NULL DEFAULT '[]',
          game TEXT NOT NULL DEFAULT '',
          attended TEXT NOT NULL DEFAULT '[]',
          taught INTEGER NOT NULL DEFAULT 0,
          UNIQUE(date, age_group)
        );
        CREATE TABLE IF NOT EXISTS levels (
          student_id TEXT NOT NULL,
          tech_id TEXT NOT NULL,
          level TEXT NOT NULL,
          PRIMARY KEY (student_id, tech_id)
        );
        CREATE TABLE IF NOT EXISTS notes (
          student_id TEXT PRIMARY KEY,
          note TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sheets (
          id TEXT PRIMARY KEY,
          client_id TEXT UNIQUE,
          title TEXT NOT NULL,
          caption TEXT NOT NULL DEFAULT '',
          theme TEXT NOT NULL DEFAULT '',
          filename TEXT NOT NULL,
          published INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS cards (
          code TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK(status IN ('unclaimed', 'claimed', 'retired')),
          student_id TEXT,
          created_at TEXT NOT NULL,
          claimed_at TEXT,
          retired_at TEXT
        );
        CREATE INDEX IF NOT EXISTS cards_student_idx ON cards(student_id);
        CREATE TABLE IF NOT EXISTS staff (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          belt TEXT NOT NULL DEFAULT 'white' CHECK(belt IN ('white', 'blue', 'purple', 'brown', 'black')),
          stripes INTEGER NOT NULL DEFAULT 0 CHECK(stripes >= 0 AND stripes <= 4),
          user_id TEXT UNIQUE,
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS lesson_plans (
          id TEXT PRIMARY KEY,
          class_date TEXT NOT NULL,
          age_group TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(class_date, age_group)
        );
        CREATE TABLE IF NOT EXISTS class_exceptions (
          date TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('skip', 'extra')),
          reason TEXT NOT NULL DEFAULT '',
          start_time TEXT NOT NULL DEFAULT '17:30',
          end_time TEXT NOT NULL DEFAULT '18:15',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS waivers (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL CHECK(kind IN ('adult', 'kids')),
          submitted_at TEXT NOT NULL,
          signed_on TEXT NOT NULL,
          participant_name TEXT NOT NULL,
          signer_name TEXT NOT NULL,
          dob TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          signature_png TEXT NOT NULL,
          parent_signature_png TEXT NOT NULL DEFAULT '',
          added_to_roster INTEGER NOT NULL DEFAULT 0,
          roster_student_id TEXT NOT NULL DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS waitlist (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          parent_name TEXT NOT NULL,
          email TEXT NOT NULL,
          phone TEXT NOT NULL,
          child_name TEXT NOT NULL,
          child_age INTEGER NOT NULL,
          dob TEXT NOT NULL DEFAULT '',
          age_group TEXT NOT NULL CHECK(age_group IN ('mite', 'upper')),
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'contacted', 'enrolled', 'removed'))
        );
        CREATE INDEX IF NOT EXISTS waitlist_created_idx ON waitlist(created_at, id);
        """
    )
    # Live databases created before this column keep their rows. DEFAULT 0
    # back-fills every existing user so nobody is forced to change a password
    # until an admin resets one.
    columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    if "must_change_password" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
    conn.execute("UPDATE users SET must_change_password = 0 WHERE must_change_password IS NULL")
    student_columns = {row[1] for row in conn.execute("PRAGMA table_info(students)")}
    if "dob" not in student_columns:
        conn.execute("ALTER TABLE students ADD COLUMN dob TEXT NOT NULL DEFAULT ''")
    waiver_columns = {row[1] for row in conn.execute("PRAGMA table_info(waivers)")}
    if "added_to_roster" not in waiver_columns:
        conn.execute("ALTER TABLE waivers ADD COLUMN added_to_roster INTEGER NOT NULL DEFAULT 0")
    if "roster_student_id" not in waiver_columns:
        conn.execute("ALTER TABLE waivers ADD COLUMN roster_student_id TEXT NOT NULL DEFAULT ''")
    migrate_age_groups(conn)
    conn.commit()


def cleanup(conn):
    now = iso(utcnow())
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    conn.execute("DELETE FROM csrf_challenges WHERE expires_at < ?", (now,))
    cutoff = iso(utcnow() - timedelta(hours=2))
    conn.execute("DELETE FROM login_attempts WHERE at < ?", (cutoff,))
    conn.commit()
