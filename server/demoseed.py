"""Seed the demo database with obviously fake rows.

This module refuses to open a file named data.db. It never reads the
production database. Demo logins are dakota and pierre, both admins.
Their passwords are passed in by the caller and are not stored in the repo.
"""

import json
import os
import secrets

from server.db import connect, iso, migrate, utcnow
from server.httpapp import USER_RE, hash_password

PROD_DB = "/var/lib/bjj-planner/data.db"
PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class DemoSeedError(Exception):
    pass


def assert_demo_db(path):
    if not path:
        raise DemoSeedError("Pass --db or set BJJ_DB to the demo database.")
    real = os.path.realpath(path)
    if os.path.basename(real) == "data.db":
        raise DemoSeedError("Refusing to seed data.db. The demo database must be named demo.db.")
    if real == os.path.realpath(PROD_DB):
        raise DemoSeedError("Refusing to touch the production database.")
    return real


DEMO_ADMINS = (
    ("dakota", "Dakota"),
    ("pierre", "Pierre"),
)


def _password_ok(password):
    if not isinstance(password, str) or len(password) < 10:
        return False
    return not any(char in password for char in "\r\n\x00")


def _ensure_admin(conn, username, display_name, password, now):
    if not USER_RE.match(username):
        raise DemoSeedError("Demo username is not allowed.")
    if not _password_ok(password):
        raise DemoSeedError(
            "Set DEMO_PASSWORD_DAKOTA and DEMO_PASSWORD_PIERRE to 10 or more characters. Do not commit them."
        )
    row = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
    if row:
        user_id = row["id"]
        conn.execute(
            "UPDATE users SET password_hash = ?, role = 'admin', must_change_password = 0 WHERE id = ?",
            (hash_password(password), user_id),
        )
    else:
        user_id = "demo-user-" + username
        conn.execute(
            """
            INSERT INTO users (id, username, password_hash, role, created_at, must_change_password)
            VALUES (?, ?, ?, 'admin', ?, 0)
            """,
            (user_id, username, hash_password(password), now),
        )
    staff = conn.execute("SELECT id FROM staff WHERE user_id = ?", (user_id,)).fetchone()
    if not staff:
        conn.execute(
            """
            INSERT INTO staff (id, name, belt, stripes, user_id, created_at)
            VALUES (?, ?, 'white', 0, ?, ?)
            """,
            ("demo-staff-" + username, display_name, user_id, now),
        )
    else:
        conn.execute("UPDATE staff SET name = ? WHERE user_id = ?", (display_name, user_id))
    return user_id


def _drop_other_users(conn):
    """The demo database has only dakota and pierre."""
    keep = {username for username, _display in DEMO_ADMINS}
    rows = conn.execute("SELECT id, username FROM users").fetchall()
    for row in rows:
        if row["username"] in keep:
            continue
        conn.execute("DELETE FROM staff WHERE user_id = ?", (row["id"],))
        conn.execute("DELETE FROM users WHERE id = ?", (row["id"],))


def _insert_examples(conn, now):
    # Eleven ages 3–10 on the roster, plus the pending Nia waiver below, fill the
    # cap of 12. Rio is 12 and does not count. The public kids waiver then shows
    # the real waitlist, and the roster line is "12 of 12 enrolled".
    students = [
        ("demo-milo", "EXAMPLE Mite Milo Preview", 5, "white", 0, "2021-06-01", "FAKE preview data. Not a real student."),
        ("demo-tess", "EXAMPLE Peewee Tess Preview", 8, "grey", 1, "2018-06-01", "FAKE preview data. Not a real student."),
        ("demo-rio", "EXAMPLE Teen Rio Preview", 12, "white", 0, "2014-06-01", "FAKE preview data. Not a real student. Age 12 is not in the kids cap."),
        ("demo-ada", "EXAMPLE Mite Ada Preview", 3, "white", 0, "2023-04-04", "FAKE preview data. Not a real student."),
        ("demo-ben", "EXAMPLE Mite Ben Preview", 4, "white", 0, "2022-05-05", "FAKE preview data. Not a real student."),
        ("demo-cam", "EXAMPLE Mite Cam Preview", 6, "white", 0, "2020-06-06", "FAKE preview data. Not a real student."),
        ("demo-dee", "EXAMPLE Peewee Dee Preview", 7, "grey", 0, "2019-07-07", "FAKE preview data. Not a real student."),
        ("demo-eli", "EXAMPLE Peewee Eli Preview", 8, "grey", 0, "2018-08-08", "FAKE preview data. Not a real student."),
        ("demo-fay", "EXAMPLE Peewee Fay Preview", 9, "grey", 1, "2017-09-09", "FAKE preview data. Not a real student."),
        ("demo-gus", "EXAMPLE Peewee Gus Preview", 10, "grey", 0, "2016-10-10", "FAKE preview data. Not a real student."),
        ("demo-hoa", "EXAMPLE Mite Hoa Preview", 5, "white", 0, "2021-01-11", "FAKE preview data. Not a real student."),
        ("demo-ivo", "EXAMPLE Peewee Ivo Preview", 7, "white", 0, "2019-02-12", "FAKE preview data. Not a real student."),
    ]
    for sid, name, age, belt, stripes, dob, note in students:
        conn.execute(
            """
            INSERT INTO students (id, name, age, belt, stripes, created_at, dob, parent_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (sid, name, age, belt, stripes, now, dob, secrets.token_urlsafe(24)),
        )
        conn.execute("INSERT INTO notes (student_id, note) VALUES (?, ?)", (sid, note))

    conn.execute(
        """
        INSERT INTO waivers (
          id, kind, submitted_at, signed_on, participant_name, signer_name, dob, email, phone,
          payload_json, signature_png, parent_signature_png, added_to_roster, roster_student_id
        ) VALUES (?, 'kids', ?, '2026-01-15', ?, ?, ?, ?, ?, ?, ?, ?, 0, '')
        """,
        (
            "demo-waiver-nia",
            now,
            "EXAMPLE Child Nia Preview",
            "EXAMPLE Parent Nia Preview",
            "2020-04-04",
            "nia.preview@example.com",
            "555-0101",
            '{"demo":true,"note":"FAKE preview data. Not a real student."}',
            PNG,
            PNG,
        ),
    )
    conn.execute(
        """
        INSERT INTO waivers (
          id, kind, submitted_at, signed_on, participant_name, signer_name, dob, email, phone,
          payload_json, signature_png, parent_signature_png, added_to_roster, roster_student_id
        ) VALUES (?, 'adult', ?, '2026-01-15', ?, ?, ?, ?, ?, ?, ?, '', 0, '')
        """,
        (
            "demo-waiver-pat",
            now,
            "EXAMPLE Adult Pat Preview",
            "EXAMPLE Adult Pat Preview",
            "1990-02-02",
            "pat.preview@example.com",
            "555-0102",
            '{"demo":true,"note":"FAKE preview data. Not a real student."}',
            PNG,
        ),
    )
    waitlist = [
        ("demo-wait-willa", "2026-02-01T18:00:00.000001Z", "EXAMPLE Parent Willa Preview", "willa.preview@example.com", "555-0103", "EXAMPLE Wait Willa Preview", 4, "2022-03-03", "mite", "waiting"),
        ("demo-wait-hugo", "2026-02-01T18:05:00.000001Z", "EXAMPLE Parent Hugo Preview", "hugo.preview@example.com", "555-0104", "EXAMPLE Wait Hugo Preview", 9, "2017-08-08", "upper", "waiting"),
        ("demo-wait-cora", "2026-02-02T18:00:00.000001Z", "EXAMPLE Parent Cora Preview", "cora.preview@example.com", "555-0105", "EXAMPLE Wait Cora Preview", 6, "2020-01-09", "mite", "contacted"),
    ]
    for row in waitlist:
        conn.execute(
            """
            INSERT INTO waitlist (
              id, created_at, parent_name, email, phone, child_name, child_age, dob, age_group, note, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (*row[:9], "FAKE preview data. Not a real family.", row[9]),
        )
    conn.execute("INSERT INTO settings (key, value) VALUES ('demo_seed', '1')")


def _ensure_parent_examples(conn, now):
    """Fill parent-card codes and one signed plus one unsigned EXAMPLE waiver.

    Safe to run again. It does not print the codes and does not open data.db.
    """
    rows = conn.execute("SELECT id, parent_token FROM students").fetchall()
    for row in rows:
        if row["parent_token"]:
            continue
        conn.execute(
            "UPDATE students SET parent_token = ? WHERE id = ?",
            (secrets.token_urlsafe(24), row["id"]),
        )
    milo = conn.execute("SELECT id, dob FROM students WHERE id = 'demo-milo'").fetchone()
    if milo and not conn.execute("SELECT 1 FROM waivers WHERE id = 'demo-waiver-milo'").fetchone():
        payload = {
            "demo": True,
            "injuries": "EXAMPLE-MEDICAL-NOTE",
            "address": "4197 State St",
            "emergencyName": "EXAMPLE Emergency",
            "emergencyPhone": "555-0199",
            "note": "FAKE preview data. Not a real student.",
        }
        conn.execute(
            """
            INSERT INTO waivers (
              id, kind, submitted_at, signed_on, participant_name, signer_name, dob, email, phone,
              payload_json, signature_png, parent_signature_png, added_to_roster, roster_student_id
            ) VALUES (?, 'kids', ?, '2026-01-15', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'demo-milo')
            """,
            (
                "demo-waiver-milo",
                now,
                "EXAMPLE Mite Milo Preview",
                "EXAMPLE Parent Milo Preview",
                milo["dob"] or "2021-06-01",
                "milo.preview@example.com",
                "555-0111",
                json.dumps(payload),
                PNG,
                PNG,
            ),
        )
    if milo and not conn.execute("SELECT 1 FROM classes WHERE id = 'demo-class-milo'").fetchone():
        conn.execute(
            """
            INSERT INTO classes (id, date, age_group, theme, theme_label, techniques, game, attended, taught)
            VALUES ('demo-class-milo', '2026-10-27', 'mite', 'mount', 'Mount', '[]', '', ?, 1)
            """,
            (json.dumps(["demo-milo"]),),
        )
    if milo and not conn.execute(
        "SELECT 1 FROM levels WHERE student_id = 'demo-milo' AND tech_id = 'ls-upa'"
    ).fetchone():
        conn.execute(
            "INSERT INTO levels (student_id, tech_id, level) VALUES ('demo-milo', 'ls-upa', 'practicing')"
        )


def seed_demo(path, passwords, reset_password=False):
    """Write example rows and the two demo admins. reset_password is accepted and ignored.

    Passwords are always applied so demo.db matches the root credentials file.
    This function does not open the production database.
    """
    real = assert_demo_db(path)
    if not isinstance(passwords, dict):
        raise DemoSeedError(
            "Set DEMO_PASSWORD_DAKOTA and DEMO_PASSWORD_PIERRE. Do not commit them."
        )
    cleaned = {}
    for username, _display in DEMO_ADMINS:
        password = passwords.get(username) or ""
        if not _password_ok(password):
            raise DemoSeedError(
                "Set DEMO_PASSWORD_DAKOTA and DEMO_PASSWORD_PIERRE to 10 or more characters. Do not commit them."
            )
        cleaned[username] = password
    conn = connect(real)
    try:
        migrate(conn)
        students = conn.execute("SELECT COUNT(*) AS n FROM students").fetchone()["n"]
        marker = conn.execute("SELECT value FROM settings WHERE key = 'demo_seed'").fetchone()
        if students and not (marker and marker["value"] == "1"):
            raise DemoSeedError("Refusing to write a database that was not created as demo seed data.")
        now = iso(utcnow())
        if not students:
            _insert_examples(conn, now)
        _ensure_parent_examples(conn, now)
        _drop_other_users(conn)
        for username, display_name in DEMO_ADMINS:
            _ensure_admin(conn, username, display_name, cleaned[username], now)
        conn.commit()
    finally:
        conn.close()
    return real
