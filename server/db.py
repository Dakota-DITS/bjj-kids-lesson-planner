"""SQLite storage. The database file is never served by nginx."""

import hashlib
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
AGE_GROUPS = ("mite", "peewee", "junior", "teen", "toddler")
ADULT_BELTS = ("white", "blue", "purple", "brown", "black")
# Representative age when a blank card is claimed with a class and no number.
AGE_GROUP_AGES = {
    "toddler": 4,
    "mite": 5,
    "peewee": 8,
    "junior": 11,
    "teen": 14,
}


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
          created_at TEXT NOT NULL
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
        """
    )
    # Live databases created before this column keep their rows. DEFAULT 0
    # back-fills every existing user so nobody is forced to change a password
    # until an admin resets one.
    columns = {row[1] for row in conn.execute("PRAGMA table_info(users)")}
    if "must_change_password" not in columns:
        conn.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
    conn.execute("UPDATE users SET must_change_password = 0 WHERE must_change_password IS NULL")
    conn.commit()


def cleanup(conn):
    now = iso(utcnow())
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (now,))
    conn.execute("DELETE FROM csrf_challenges WHERE expires_at < ?", (now,))
    cutoff = iso(utcnow() - timedelta(hours=2))
    conn.execute("DELETE FROM login_attempts WHERE at < ?", (cutoff,))
    conn.commit()
