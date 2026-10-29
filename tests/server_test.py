"""Attendance API checks. Uses a temporary database and a local HTTP server."""

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from http.server import ThreadingHTTPServer

from server.httpapp import KIDS_FULL, Api, check_password, config_from_env, hash_password
from server.db import (
    age_group_for_age,
    connect,
    is_adult_class_day,
    is_class_day,
    iso,
    migrate,
    new_id,
    normalize_age_group,
    today_pacific,
    utcnow,
)

PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


class Client:
    def __init__(self, base):
        self.base = base
        self.cookie = ""
        self.cookies = {}
        self.csrf = ""

    def call(self, method, path, body=None, csrf=None, raw=False):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        token = self.csrf if csrf is None else csrf
        if method != "GET" and token:
            req.add_header("X-CSRF-Token", token)
        if self.cookies:
            self.cookie = "; ".join(f"{key}={value}" for key, value in self.cookies.items())
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        try:
            with urllib.request.urlopen(req) as res:
                payload = res.read()
                self._take_cookie(res.headers)
                parsed = payload if raw else (json.loads(payload.decode() or "null") if payload else None)
                if isinstance(parsed, dict) and parsed.get("csrf"):
                    self.csrf = parsed["csrf"]
                return res.status, parsed
        except urllib.error.HTTPError as err:
            raw_body = err.read()
            try:
                parsed = json.loads(raw_body.decode() or "null")
            except json.JSONDecodeError:
                parsed = raw_body
            return err.code, parsed

    def _take_cookie(self, headers):
        values = headers.get_all("Set-Cookie") if hasattr(headers, "get_all") else []
        if not values:
            one = headers.get("Set-Cookie")
            values = [one] if one else []
        for raw in values:
            pair = raw.split(";", 1)[0]
            name, sep, value = pair.partition("=")
            if not sep or not name:
                continue
            if value == "" or "Max-Age=0" in raw:
                self.cookies.pop(name, None)
            else:
                self.cookies[name] = value
        self.cookie = "; ".join(f"{key}={value}" for key, value in self.cookies.items())

    def login(self, username, password):
        status, pre = self.call("GET", "/api/auth/csrf")
        assert status == 200, pre
        return self.call("POST", "/api/login", {"username": username, "password": password}, csrf=pre["csrf"])


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        db_path = os.path.join(cls.tmp.name, "data.db")
        cfg = config_from_env()
        cfg["db_path"] = db_path
        cfg["data_dir"] = cls.tmp.name
        cfg["sheets_dir"] = os.path.join(cls.tmp.name, "sheets")
        cfg["secure"] = False
        cfg["static_root"] = ""
        os.makedirs(cfg["sheets_dir"], exist_ok=True)
        conn = connect(db_path)
        migrate(conn)
        for username, role in (("dakota", "admin"), ("alex", "teacher")):
            conn.execute(
                "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (new_id("u-"), username, hash_password("correct-horse"), role, iso(utcnow())),
            )
        conn.commit()
        conn.close()
        cls.api = Api(cfg)
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _handler(cls.api))
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.tmp.cleanup()

    def client(self):
        return Client(f"http://127.0.0.1:{self.port}")

    def test_login_roles_and_shared_attendance(self):
        admin = self.client()
        status, body = admin.login("dakota", "nope-nope-nope")
        self.assertEqual(status, 401)
        self.assertNotIn("password", json.dumps(body))

        status, body = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        self.assertEqual(body["user"]["role"], "admin")

        status, student = admin.call(
            "POST",
            "/api/students",
            {"name": "Sam", "age": 8, "belt": "grey", "stripes": 2},
        )
        self.assertEqual(status, 201)
        sid = student["id"]

        teacher = self.client()
        status, _ = teacher.call("POST", "/api/students", {"name": "Nope", "age": 6, "belt": "white", "stripes": 0})
        self.assertIn(status, (401, 403))
        status, body = teacher.login("alex", "correct-horse")
        self.assertEqual(body["user"]["role"], "teacher")
        status, denied = teacher.call("POST", "/api/users", {"username": "eve", "password": "long-enough", "role": "admin"})
        self.assertEqual(status, 403)
        status, denied = teacher.call("POST", "/api/students", {"name": "Pat", "age": 6, "belt": "white", "stripes": 0})
        self.assertEqual(status, 403)

        status, saved = teacher.call(
            "POST",
            "/api/attendance",
            {
                "date": "2026-10-27",
                "ageGroup": "peewee",
                "theme": "mount",
                "themeLabel": "Mount",
                "techniques": [{"id": "ls-americana", "name": "Americana", "position": "Mount", "theme": "mount"}],
                "game": "Mount switch",
                "attended": [sid],
                "taught": False,
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(saved["attended"], [sid])
        status, level = teacher.call("PUT", "/api/levels", {"studentId": sid, "techId": "ls-americana", "level": "practicing"})
        self.assertEqual(status, 200)

        other = self.client()
        other.login("dakota", "correct-horse")
        status, boot = other.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertEqual(boot["students"][0]["name"], "Sam")
        self.assertEqual(boot["classes"][0]["attended"], [sid])
        self.assertEqual(boot["levels"][sid]["ls-americana"], "drilled")
        self.assertNotIn("password_hash", json.dumps(boot))

        status, exported = other.call("GET", "/api/export")
        self.assertEqual(status, 200)
        self.assertNotIn("password", json.dumps(exported).lower())
        status, hidden = teacher.call("GET", "/api/export")
        self.assertEqual(status, 403)

    def test_public_surface_has_no_students(self):
        admin = self.client()
        admin.login("dakota", "correct-horse")
        status, featured = admin.call("PUT", "/api/featured", {"sheetId": "mount", "caption": "Knees pinch."})
        self.assertEqual(status, 200)
        anon = self.client()
        status, body = anon.call("GET", "/api/public/featured")
        self.assertEqual(status, 200)
        self.assertEqual(set(body), {"sheetId", "caption"})
        self.assertEqual(body["sheetId"], "mount")

        status, missing = anon.call("GET", "/api/public/sheets/missing/image", raw=True)
        self.assertEqual(status, 404)

        status, published = admin.call(
            "POST",
            "/api/sheets",
            {"title": "Sam's mount", "caption": "From class", "theme": "mount", "image": PNG, "published": False, "clientId": "upload1"},
        )
        self.assertEqual(status, 200)
        status, blocked = anon.call("GET", f"/api/public/sheets/{published['id']}/image", raw=True)
        self.assertEqual(status, 404)
        admin.call(
            "POST",
            "/api/sheets",
            {"title": "Mount coloring", "caption": "From class", "theme": "mount", "image": PNG, "published": True, "clientId": "upload1"},
        )
        status, blob = anon.call("GET", f"/api/public/sheets/{published['id']}/image", raw=True)
        self.assertEqual(status, 200)
        self.assertTrue(blob.startswith(b"\x89PNG"))
        status, listing = anon.call("GET", "/api/public/sheets")
        self.assertEqual(listing["sheets"][0]["title"], "Mount coloring")
        self.assertNotIn("students", listing)
        self.assertNotIn("Sam", json.dumps(listing))

        status, auth = anon.call("GET", "/api/auth/nginx", raw=True)
        self.assertEqual(status, 401)
        status, auth = admin.call("GET", "/api/auth/nginx", raw=True)
        self.assertEqual(status, 204)

    def test_blank_cards_are_issued_once_and_keep_old_rows(self):
        path = os.path.join(self.tmp.name, "legacy.db")
        conn = connect(path)
        conn.execute(
            """
            CREATE TABLE students (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              age INTEGER NOT NULL,
              belt TEXT NOT NULL,
              stripes INTEGER NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO students (id, name, age, belt, stripes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("s-old", "Existing", 8, "white", 0, "2026-01-01T00:00:00Z"),
        )
        conn.commit()
        migrate(conn)
        migrate(conn)
        kept = conn.execute("SELECT name FROM students WHERE id = ?", ("s-old",)).fetchone()
        self.assertEqual(kept["name"], "Existing")
        self.assertIsNotNone(conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cards'").fetchone())
        conn.close()

        admin = self.client()
        admin.login("dakota", "correct-horse")
        teacher = self.client()
        teacher.login("alex", "correct-horse")

        status, denied = teacher.call("POST", "/api/cards", {"count": 2})
        self.assertEqual(status, 403)

        status, made = admin.call("POST", "/api/cards", {"count": 3})
        self.assertEqual(status, 201)
        codes = [card["code"] for card in made["cards"]]
        self.assertEqual(len(set(codes)), 3)
        self.assertTrue(all(card["status"] == "unclaimed" and card["code"].startswith("b-") and len(card["code"]) > 20 for card in made["cards"]))

        status, clamped = admin.call("POST", "/api/cards", {"count": 0})
        self.assertEqual(len(clamped["cards"]), 1)
        status, wide = admin.call("POST", "/api/cards", {"count": 99})
        self.assertEqual(len(wide["cards"]), 24)

        forged = "b-" + "ab" * 16
        status, missing = teacher.call(
            "POST",
            f"/api/cards/{forged}/claim",
            {"name": "Ghost", "ageGroup": "mite", "belt": "white", "stripes": 0},
        )
        self.assertEqual(status, 404)

        code = codes[0]
        status, claimed = teacher.call(
            "POST",
            f"/api/cards/{code}/claim",
            {"name": "Jordan", "ageGroup": "peewee", "belt": "white", "stripes": 1},
        )
        self.assertEqual(status, 201)
        self.assertEqual(claimed["student"]["name"], "Jordan")
        self.assertEqual(claimed["student"]["age"], 8)
        self.assertNotEqual(claimed["student"]["id"], code)
        self.assertEqual(claimed["card"]["status"], "claimed")
        self.assertEqual(claimed["card"]["studentId"], claimed["student"]["id"])

        status, again = admin.call(
            "POST",
            f"/api/cards/{code}/claim",
            {"name": "Jordan Two", "age": 9, "belt": "white", "stripes": 0},
        )
        self.assertEqual(status, 409)

        status, boot = teacher.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)
        linked = next(card for card in boot["cards"] if card["code"] == code)
        self.assertEqual(linked["studentId"], claimed["student"]["id"])
        status, present = teacher.call(
            "POST",
            "/api/attendance",
            {"date": "2026-11-10", "ageGroup": "peewee", "attended": [claimed["student"]["id"]], "taught": False},
        )
        self.assertEqual(status, 200)
        self.assertIn(claimed["student"]["id"], present["attended"])

        status, other = admin.call("POST", "/api/students", {"name": "Avery", "age": 6, "belt": "grey", "stripes": 0})
        self.assertEqual(status, 201)
        self.assertFalse(any(card["code"] == other["id"] for card in boot["cards"]))

        status, denied = teacher.call("PATCH", f"/api/cards/{codes[1]}", {"studentId": other["id"]})
        self.assertEqual(status, 403)
        status, linked_blank = admin.call("PATCH", f"/api/cards/{codes[1]}", {"studentId": other["id"]})
        self.assertEqual(status, 200)
        self.assertEqual(linked_blank["card"]["studentId"], other["id"])
        self.assertEqual(linked_blank["card"]["status"], "claimed")
        status, second = teacher.call(
            "POST",
            f"/api/cards/{codes[1]}/claim",
            {"name": "Someone", "age": 7, "belt": "white", "stripes": 0},
        )
        self.assertEqual(status, 409)

        status, denied = teacher.call("POST", f"/api/cards/{codes[2]}/retire")
        self.assertEqual(status, 403)
        status, retired = admin.call("POST", f"/api/cards/{codes[2]}/retire")
        self.assertEqual(status, 200)
        self.assertEqual(retired["card"]["status"], "retired")
        status, blocked = teacher.call(
            "POST",
            f"/api/cards/{codes[2]}/claim",
            {"name": "Late", "ageGroup": "mite"},
        )
        self.assertEqual(status, 409)

        status, restored = admin.call("PATCH", f"/api/cards/{codes[2]}", {"studentId": other["id"]})
        self.assertEqual(status, 200)
        self.assertEqual(restored["card"]["status"], "claimed")
        self.assertEqual(restored["card"]["studentId"], other["id"])

        status, removed = admin.call("DELETE", f"/api/students/{claimed['student']['id']}")
        self.assertEqual(status, 200)
        status, listing = admin.call("GET", "/api/cards")
        gone = next(card for card in listing["cards"] if card["code"] == code)
        self.assertEqual(gone["status"], "retired")
        status, removed = admin.call("DELETE", f"/api/students/{other['id']}")
        self.assertEqual(status, 200)

    def test_past_class_and_staff_roster(self):
        admin = self.client()
        status, body = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        self.assertTrue(body["user"]["id"])
        status, boot = admin.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertTrue(any(person["login"] and person["name"] == "dakota" for person in boot["staff"]))
        self.assertTrue(any(person["login"] and person["userId"] == body["user"]["id"] for person in boot["staff"]))
        dakota_staff = next(person for person in boot["staff"] if person["userId"] == body["user"]["id"])
        self.assertEqual(dakota_staff["username"], "dakota")
        self.assertEqual(dakota_staff["displayName"], "Dakota")
        self.assertEqual(body["user"]["username"], "dakota")
        self.assertEqual(body["user"]["displayName"], "Dakota")
        alex_staff = next(person for person in boot["staff"] if person["username"] == "alex")
        self.assertEqual(alex_staff["name"], "alex")
        self.assertEqual(alex_staff["displayName"], "Alex")
        status, users = admin.call("GET", "/api/users")
        self.assertEqual(status, 200)
        listed = next(user for user in users["users"] if user["id"] == body["user"]["id"])
        self.assertEqual(listed["username"], "dakota")
        self.assertEqual(listed["displayName"], "Dakota")
        conn = self.api.db()
        try:
            stored = conn.execute("SELECT username FROM users WHERE id = ?", (body["user"]["id"],)).fetchone()
            self.assertEqual(stored["username"], "dakota")
        finally:
            conn.close()
        status, renamed = admin.call(
            "PATCH",
            f"/api/staff/{dakota_staff['id']}",
            {"name": "Coach Dak", "belt": dakota_staff["belt"], "stripes": dakota_staff["stripes"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(renamed["name"], "Coach Dak")
        self.assertEqual(renamed["displayName"], "Coach Dak")
        self.assertEqual(renamed["username"], "dakota")
        status, restored_name = admin.call(
            "PATCH",
            f"/api/staff/{dakota_staff['id']}",
            {"name": "dakota", "belt": dakota_staff["belt"], "stripes": dakota_staff["stripes"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(restored_name["name"], "dakota")
        self.assertEqual(restored_name["displayName"], "Dakota")
        conn = self.api.db()
        try:
            stored = conn.execute("SELECT username FROM users WHERE id = ?", (body["user"]["id"],)).fetchone()
            self.assertEqual(stored["username"], "dakota")
        finally:
            conn.close()
        sam = next((student for student in boot["students"] if student["name"] == "Sam"), None)
        created_student = ""
        if not sam:
            status, sam = admin.call("POST", "/api/students", {"name": "Zoe History", "age": 8, "belt": "grey", "stripes": 1})
            self.assertEqual(status, 201)
            created_student = sam["id"]

        teacher = self.client()
        teacher.login("alex", "correct-horse")
        status, denied = teacher.call("POST", "/api/staff", {"name": "Nope", "belt": "blue", "stripes": 0})
        self.assertEqual(status, 403)

        status, helper = admin.call("POST", "/api/staff", {"name": "Quinn Helper", "belt": "white", "stripes": 2})
        self.assertEqual(status, 201)
        self.assertEqual(helper["login"], False)
        self.assertEqual(helper["belt"], "white")
        self.assertEqual(helper["name"], "Quinn Helper")
        self.assertEqual(helper["username"], "")
        self.assertEqual(helper["displayName"], "Quinn Helper")
        status, typed = admin.call("POST", "/api/staff", {"name": "sam", "belt": "white", "stripes": 0})
        self.assertEqual(status, 201)
        self.assertEqual(typed["name"], "sam")
        self.assertEqual(typed["displayName"], "sam")
        self.assertEqual(typed["username"], "")
        status, removed_typed = admin.call("DELETE", f"/api/staff/{typed['id']}")
        self.assertEqual(status, 200)
        status, patched = admin.call("PATCH", f"/api/staff/{helper['id']}", {"name": "Quinn Helper", "belt": "blue", "stripes": 0})
        self.assertEqual(status, 200)
        self.assertEqual(patched["belt"], "blue")
        login_row = next(person for person in boot["staff"] if person["userId"] == body["user"]["id"])
        status, blocked = admin.call("DELETE", f"/api/staff/{login_row['id']}")
        self.assertEqual(status, 400)
        self.assertIn("login", blocked["error"].lower())

        status, saved = teacher.call(
            "PUT",
            "/api/classes",
            {
                "date": "2026-09-15",
                "ageGroup": "mite",
                "theme": "mount",
                "themeLabel": "Mount",
                "techniques": [{"id": "ls-mount-base", "name": "Mount base", "position": "Mount", "theme": "mount"}],
                "attended": [sam["id"]],
                "taught": True,
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(saved["taught"])
        self.assertEqual(saved["attended"], [sam["id"]])
        status, level = teacher.call("PUT", "/api/levels", {"studentId": sam["id"], "techId": "ls-mount-base", "level": "own"})
        self.assertEqual(status, 200)
        status, again = admin.call("GET", "/api/bootstrap")
        self.assertEqual(again["levels"][sam["id"]]["ls-mount-base"], "mastered")
        past = next(entry for entry in again["classes"] if entry["date"] == "2026-09-15")
        self.assertEqual(past["attended"], [sam["id"]])
        self.assertTrue(past["taught"])

        status, cleared = teacher.call("DELETE", "/api/levels", {"studentId": sam["id"], "techId": "ls-mount-base"})
        self.assertEqual(status, 200)
        status, removed = teacher.call("DELETE", f"/api/classes/{saved['id']}")
        self.assertEqual(status, 200)
        status, missing = teacher.call("DELETE", f"/api/classes/{saved['id']}")
        self.assertEqual(status, 404)
        status, after = admin.call("GET", "/api/bootstrap")
        self.assertNotIn("ls-mount-base", after["levels"].get(sam["id"], {}))
        self.assertFalse(any(entry["date"] == "2026-09-15" for entry in after["classes"]))
        status, gone = admin.call("DELETE", f"/api/staff/{helper['id']}")
        self.assertEqual(status, 200)

        status, created = admin.call(
            "POST",
            "/api/users",
            {"username": "tempcoach", "password": "long-enough-1", "role": "teacher"},
        )
        self.assertEqual(status, 201)
        status, roster = admin.call("GET", "/api/staff")
        linked = next(person for person in roster["staff"] if person["userId"] == created["id"])
        status, _ = admin.call("DELETE", f"/api/users/{created['id']}")
        self.assertEqual(status, 200)
        status, roster = admin.call("GET", "/api/staff")
        kept = next(person for person in roster["staff"] if person["id"] == linked["id"])
        self.assertFalse(kept["login"])
        self.assertEqual(kept["userId"], "")
        status, removed = admin.call("DELETE", f"/api/staff/{kept['id']}")
        self.assertEqual(status, 200)
        if created_student:
            status, removed = admin.call("DELETE", f"/api/students/{created_student}")
            self.assertEqual(status, 200)

    def test_bootstrap_survives_empty_staff_and_bad_class_json(self):
        parsed = self.api.class_json(
            {
                "id": "k-1",
                "date": "2026-10-27",
                "age_group": "mite",
                "theme": "mount",
                "theme_label": None,
                "techniques": None,
                "game": None,
                "attended": "",
                "taught": None,
            }
        )
        self.assertEqual(parsed["techniques"], [])
        self.assertEqual(parsed["attended"], [])
        self.assertEqual(parsed["themeLabel"], "")
        self.assertEqual(self.api.static_cache_control("/js/app.js"), "private, no-store")
        self.assertEqual(self.api.static_cache_control("/css/styles.css"), "private, no-store")
        self.assertEqual(self.api.static_cache_control("/app/index.html"), "private, no-store")
        self.assertEqual(self.api.static_cache_control("/css/splash.css"), "no-cache")
        self.assertEqual(self.api.static_cache_control("/"), "no-cache")
        self.assertEqual(self.api.static_cache_control("/sw.js"), "no-cache")
        self.assertEqual(self.api.static_cache_control("/manifest.webmanifest"), "no-cache")
        self.assertEqual(self.api.static_cache_control("/app/manifest.webmanifest"), "no-cache")
        self.assertEqual(self.api.static_cache_control("/app/offline.html"), "no-cache")
        self.assertEqual(self.api.static_cache_control("/vendor/jsQR/jsQR.js"), "private, no-store")
        conn = self.api.db()
        try:
            conn.execute("DELETE FROM staff")
            conn.execute(
                """
                INSERT INTO classes (id, date, age_group, theme, techniques, attended, taught)
                VALUES ('k-badjson', '2026-08-11', 'teen', 'mount', 'not-json', '', 0)
                """
            )
            conn.commit()
            body = self.api.bootstrap(conn)
        finally:
            conn.execute("DELETE FROM classes WHERE id = 'k-badjson'")
            conn.commit()
            conn.close()
        names = {person["name"] for person in body["staff"]}
        self.assertIn("dakota", names)
        self.assertIn("alex", names)
        bad = next(entry for entry in body["classes"] if entry["id"] == "k-badjson")
        self.assertEqual(bad["techniques"], [])
        self.assertEqual(bad["attended"], [])

    def test_staff_migration_keeps_existing_students(self):
        path = os.path.join(self.tmp.name, "pre-staff.db")
        conn = connect(path)
        conn.execute(
            """
            CREATE TABLE students (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              age INTEGER NOT NULL,
              belt TEXT NOT NULL,
              stripes INTEGER NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO students (id, name, age, belt, stripes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("s-old", "Existing", 8, "white", 0, "2026-01-01T00:00:00Z"),
        )
        conn.commit()
        migrate(conn)
        row = conn.execute("SELECT name FROM students WHERE id = ?", ("s-old",)).fetchone()
        self.assertEqual(row["name"], "Existing")
        tables = {item["name"] for item in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertIn("staff", tables)
        self.assertIn("lesson_plans", tables)
        conn.execute(
            "INSERT INTO staff (id, name, belt, stripes, user_id, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
            ("st-old", "Helper", "blue", 0, "2026-01-01T00:00:00Z"),
        )
        conn.commit()
        migrate(conn)
        kept = conn.execute("SELECT belt FROM staff WHERE id = ?", ("st-old",)).fetchone()
        self.assertEqual(kept["belt"], "blue")
        still = conn.execute("SELECT name FROM students WHERE id = ?", ("s-old",)).fetchone()
        self.assertEqual(still["name"], "Existing")
        conn.close()

    def test_admin_password_reset_forces_change_and_drops_sessions(self):
        old_path = os.path.join(self.tmp.name, "reset-legacy.db")
        legacy = connect(old_path)
        legacy.execute(
            """
            CREATE TABLE users (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        legacy.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at) VALUES ('u-old', 'oldadmin', 'hash', 'admin', '2026-01-01T00:00:00Z')"
        )
        legacy.commit()
        migrate(legacy)
        backfill = legacy.execute("SELECT must_change_password FROM users WHERE id = 'u-old'").fetchone()
        self.assertEqual(backfill["must_change_password"], 0)
        migrate(legacy)
        legacy.close()

        admin = self.client()
        status, me = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        self.assertFalse(me["user"]["mustChangePassword"])
        status, created = admin.call(
            "POST",
            "/api/users",
            {"username": "Teacher1", "password": "starter-pass-1", "role": "teacher"},
        )
        self.assertEqual(status, 201)
        uid = created["id"]

        teacher1 = self.client()
        status, _ = teacher1.login("Teacher1", "starter-pass-1")
        self.assertEqual(status, 200)
        status, boot = teacher1.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)

        alex = self.client()
        alex.login("alex", "correct-horse")
        status, denied = alex.call("POST", f"/api/users/{uid}/password", {"password": "not-allowed-1"})
        self.assertEqual(status, 403)
        status, still = teacher1.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)

        status, own = admin.call("POST", f"/api/users/{me['user']['id']}/password", {"password": "another-pass-1"})
        self.assertEqual(status, 400)

        status, reset = admin.call("POST", f"/api/users/{uid}/password", {"password": "handoff-pass-1"})
        self.assertEqual(status, 200)
        self.assertEqual(reset, {"ok": True})
        self.assertNotIn("handoff-pass-1", json.dumps(reset))
        status, dead = teacher1.call("GET", "/api/bootstrap")
        self.assertEqual(status, 401)

        conn = connect(self.api.cfg["db_path"])
        stored = conn.execute("SELECT password_hash, must_change_password FROM users WHERE id = ?", (uid,)).fetchone()
        self.assertEqual(stored["must_change_password"], 1)
        self.assertNotIn("handoff-pass-1", stored["password_hash"])
        self.assertTrue(stored["password_hash"].startswith("$2"))
        conn.close()

        fresh = self.client()
        status, signed = fresh.login("Teacher1", "handoff-pass-1")
        self.assertEqual(status, 200)
        self.assertTrue(signed["user"]["mustChangePassword"])
        status, blocked = fresh.call("GET", "/api/bootstrap")
        self.assertEqual(status, 403)
        self.assertTrue(blocked["mustChangePassword"])
        fresh.csrf = blocked["csrf"]
        status, same = fresh.call("POST", "/api/password", {"current": "handoff-pass-1", "next": "handoff-pass-1"})
        self.assertEqual(status, 400)
        status, changed = fresh.call("POST", "/api/password", {"current": "handoff-pass-1", "next": "chosen-pass-1"})
        self.assertEqual(status, 200)
        status, boot = fresh.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertFalse(boot["user"]["mustChangePassword"])
        status, home = admin.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)

    def test_stripe_thresholds_are_admin_only(self):
        teacher = self.client()
        status, _ = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200)
        status, denied = teacher.call("PUT", "/api/stripe", {"own": 4, "attend": 5})
        self.assertEqual(status, 403)
        status, boot = teacher.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200)
        self.assertEqual(boot["stripe"], {"own": 6, "attend": 8})
        status, blocked = teacher.call(
            "POST",
            "/api/import",
            {"progress": {"stripe": {"own": 3, "attend": 4}, "classes": [{"date": "2026-11-02", "ageGroup": "mite", "taught": True}]}},
        )
        self.assertEqual(status, 403)
        status, boot = teacher.call("GET", "/api/bootstrap")
        self.assertEqual(boot["stripe"], {"own": 6, "attend": 8})
        self.assertFalse(any(row["date"] == "2026-11-02" for row in boot["classes"]))

        admin = self.client()
        status, _ = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        status, saved = admin.call("PUT", "/api/stripe", {"own": 7, "attend": 9})
        self.assertEqual(status, 200)
        self.assertEqual(saved, {"own": 7, "attend": 9})
        status, boot = teacher.call("GET", "/api/bootstrap")
        self.assertEqual(boot["stripe"], {"own": 7, "attend": 9})
        status, imported = admin.call(
            "POST",
            "/api/import",
            {"progress": {"stripe": {"own": 6, "attend": 8}}},
        )
        self.assertEqual(status, 200)
        status, boot = teacher.call("GET", "/api/bootstrap")
        self.assertEqual(boot["stripe"], {"own": 6, "attend": 8})
        self.assertEqual(imported["ok"], True)

    def test_csv_exports_are_staff_only(self):
        anon = self.client()
        status, _ = anon.call("GET", "/api/export/roster.csv", raw=True)
        self.assertEqual(status, 401)
        status, _ = anon.call("GET", "/api/export/attendance.csv", raw=True)
        self.assertEqual(status, 401)

        admin = self.client()
        status, _ = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        status, student = admin.call(
            "POST",
            "/api/students",
            {"name": "=1+1", "age": 8, "belt": "grey", "stripes": 1},
        )
        self.assertEqual(status, 201)
        status, roster = admin.call("GET", "/api/export/roster.csv", raw=True)
        self.assertEqual(status, 200)
        text = roster.decode()
        self.assertIn("name,age,belt,stripes", text)
        self.assertIn("'=1+1,8,grey,1", text)

        status, saved = admin.call(
            "POST",
            "/api/attendance",
            {
                "date": "2027-01-12",
                "ageGroup": "teen",
                "theme": "mount",
                "themeLabel": "Mount",
                "techniques": [],
                "game": "",
                "attended": [student["id"]],
                "taught": True,
            },
        )
        self.assertEqual(status, 200)
        status, sheet = admin.call("GET", "/api/export/attendance.csv", raw=True)
        self.assertEqual(status, 200)
        attendance = sheet.decode()
        self.assertIn("date,age_group,theme,taught,student", attendance)
        self.assertIn("2027-01-12,upper,Mount,yes,'=1+1", attendance)

        teacher = self.client()
        status, _ = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200)
        status, teacher_roster = teacher.call("GET", "/api/export/roster.csv", raw=True)
        self.assertEqual(status, 200)
        self.assertIn("'=1+1", teacher_roster.decode())
        status, _ = admin.call("DELETE", f"/api/students/{student['id']}")
        self.assertEqual(status, 200)

    def test_combo_class_create_edit_list_attend_export(self):
        self.assertEqual(normalize_age_group("peewee+mite"), "mite+upper")
        self.assertEqual(normalize_age_group("junior"), "upper")
        self.assertEqual(normalize_age_group("teen"), "upper")
        self.assertEqual(age_group_for_age(3), "mite")
        self.assertEqual(age_group_for_age(5), "mite")
        self.assertEqual(age_group_for_age(6), "mite")
        self.assertEqual(age_group_for_age(7), "upper")
        self.assertEqual(age_group_for_age(8), "upper")
        self.assertEqual(age_group_for_age(10), "upper")
        self.assertEqual(age_group_for_age(2), "")
        self.assertEqual(age_group_for_age(11), "")
        self.assertEqual(age_group_for_age(14), "")
        self.assertEqual(age_group_for_age(16), "")
        admin = self.client()
        status, _ = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        created = []
        class_id = ""
        ada = ""
        try:
            kids = {}
            for name, age, stripes in (
                ("ComboAda", 5, 0),
                ("ComboBea", 8, 1),
                ("ComboCleo", 7, 1),
                ("ComboDee", 10, 2),
            ):
                status, student = admin.call(
                    "POST",
                    "/api/students",
                    {"name": name, "age": age, "belt": "white", "stripes": stripes},
                )
                self.assertEqual(status, 201, student)
                created.append(student["id"])
                kids[name] = student["id"]
            ada = kids["ComboAda"]
            status, saved = admin.call(
                "POST",
                "/api/attendance",
                {
                    "date": "2027-06-09",
                    "ageGroup": "peewee+mite",
                    "theme": "mount",
                    "themeLabel": "Mount",
                    "techniques": [
                        {"id": "ls-mount-hold", "name": "Hold mount", "position": "Mount", "theme": "mount"}
                    ],
                    "game": "Mount switch",
                    "attended": [kids["ComboAda"], kids["ComboBea"], kids["ComboCleo"], kids["ComboDee"]],
                    "taught": True,
                },
            )
            self.assertEqual(status, 200, saved)
            self.assertEqual(saved["ageGroup"], "mite+upper")
            self.assertEqual(saved["taught"], True)
            self.assertCountEqual(
                saved["attended"],
                [kids["ComboAda"], kids["ComboBea"], kids["ComboCleo"], kids["ComboDee"]],
            )
            class_id = saved["id"]

            status, edited = admin.call(
                "PUT",
                "/api/classes",
                {
                    "id": saved["id"],
                    "date": "2027-06-09",
                    "ageGroup": "mite+upper",
                    "theme": "mount",
                    "themeLabel": "Mount combo",
                    "techniques": saved["techniques"],
                    "game": "Mount switch",
                    "attended": [kids["ComboAda"], kids["ComboBea"]],
                    "taught": True,
                },
            )
            self.assertEqual(status, 200, edited)
            self.assertEqual(edited["id"], saved["id"])
            self.assertEqual(edited["themeLabel"], "Mount combo")
            self.assertEqual(edited["ageGroup"], "mite+upper")

            status, boot = admin.call("GET", "/api/bootstrap")
            self.assertEqual(status, 200)
            listed = [row for row in boot["classes"] if row["date"] == "2027-06-09"]
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["ageGroup"], "mite+upper")
            self.assertEqual(listed[0]["themeLabel"], "Mount combo")
            self.assertCountEqual(
                listed[0]["attended"],
                [kids["ComboAda"], kids["ComboBea"]],
            )

            status, level = admin.call(
                "PUT",
                "/api/levels",
                {"studentId": ada, "techId": "ls-mount-hold", "level": "introduced"},
            )
            self.assertEqual(status, 200, level)
            status, boot = admin.call("GET", "/api/bootstrap")
            self.assertEqual(boot["levels"][ada]["ls-mount-hold"], "introduced")
            taught = [
                row
                for row in boot["classes"]
                if row["date"] == "2027-06-09" and row["taught"] and ada in row["attended"]
            ]
            self.assertEqual(len(taught), 1)

            status, sheet = admin.call("GET", "/api/export/attendance.csv", raw=True)
            self.assertEqual(status, 200)
            lines = [line for line in sheet.decode().splitlines() if line.startswith("2027-06-09,")]
            self.assertGreaterEqual(len(lines), 2)
            self.assertTrue(all(line.split(",")[1] == "mite+upper" for line in lines))
            joined = "\n".join(lines)
            self.assertIn("ComboAda", joined)
            self.assertIn("ComboBea", joined)
            self.assertNotIn("ComboCleo", joined)
            self.assertNotIn("ComboDee", joined)
        finally:
            if class_id:
                admin.call("DELETE", f"/api/classes/{class_id}")
            if ada:
                admin.call("DELETE", "/api/levels", {"studentId": ada, "techId": "ls-mount-hold"})
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")

    def test_single_age_group_class_is_unchanged(self):
        self.assertEqual(normalize_age_group("mite"), "mite")
        self.assertEqual(normalize_age_group("toddler"), "toddler")
        self.assertEqual(normalize_age_group(""), "mite")
        admin = self.client()
        status, _ = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        created = []
        class_id = ""
        try:
            kids = {}
            for name, age in (("SoloMite", 5), ("SoloTeen", 14)):
                status, student = admin.call(
                    "POST",
                    "/api/students",
                    {"name": name, "age": age, "belt": "white", "stripes": 1},
                )
                self.assertEqual(status, 201, student)
                created.append(student["id"])
                kids[name] = student["id"]
            status, saved = admin.call(
                "POST",
                "/api/attendance",
                {
                    "date": "2027-08-11",
                    "ageGroup": "mite",
                    "theme": "mount",
                    "themeLabel": "Mount",
                    "techniques": [],
                    "game": "",
                    "attended": [kids["SoloMite"], kids["SoloTeen"]],
                    "taught": True,
                },
            )
            self.assertEqual(status, 200, saved)
            self.assertEqual(saved["ageGroup"], "mite")
            self.assertCountEqual(saved["attended"], [kids["SoloMite"], kids["SoloTeen"]])
            class_id = saved["id"]
            status, boot = admin.call("GET", "/api/bootstrap")
            listed = [row for row in boot["classes"] if row["date"] == "2027-08-11"]
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0]["ageGroup"], "mite")
            status, sheet = admin.call("GET", "/api/export/attendance.csv", raw=True)
            lines = [line for line in sheet.decode().splitlines() if line.startswith("2027-08-11,")]
            self.assertEqual(len(lines), 2)
            self.assertTrue(all(line.split(",")[1] == "mite" for line in lines))
            joined = "\n".join(lines)
            self.assertIn("SoloMite", joined)
            self.assertIn("SoloTeen", joined)
            self.assertNotIn("+", ",".join(line.split(",")[1] for line in lines))
        finally:
            if class_id:
                admin.call("DELETE", f"/api/classes/{class_id}")
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")


    def test_role_change_is_admin_only_and_keeps_last_admin(self):
        def restore_roles():
            conn = self.api.db()
            conn.execute("UPDATE users SET role = 'admin' WHERE username = 'dakota'")
            conn.execute("UPDATE users SET role = 'teacher' WHERE username = 'alex'")
            conn.execute("DELETE FROM users WHERE username = 'roletemp'")
            conn.execute("DELETE FROM staff WHERE name = 'roletemp'")
            conn.commit()
            conn.close()

        self.addCleanup(restore_roles)
        admin = self.client()
        status, me = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        teacher = self.client()
        status, alex = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200)
        alex_id = alex["user"]["id"]
        dakota_id = me["user"]["id"]
        status, denied = teacher.call("PATCH", f"/api/users/{alex_id}", {"role": "admin"})
        self.assertEqual(status, 403)
        status, bad = admin.call("PATCH", f"/api/users/{alex_id}", {"role": "owner"})
        self.assertEqual(status, 400)
        status, missing = admin.call("PATCH", f"/api/users/{alex_id}", {})
        self.assertEqual(status, 400)
        status, blocked = admin.call("PATCH", f"/api/users/{dakota_id}", {"role": "teacher"})
        self.assertEqual(status, 400)
        self.assertEqual(blocked["error"], "Keep at least one admin who can still sign in.")
        status, promoted = admin.call("PATCH", f"/api/users/{alex_id}", {"role": "admin"})
        self.assertEqual(status, 200)
        self.assertEqual(promoted["role"], "admin")
        self.assertEqual(promoted["username"], "alex")
        status, created = teacher.call(
            "POST",
            "/api/users",
            {"username": "roletemp", "password": "long-enough-1", "role": "teacher"},
        )
        self.assertEqual(status, 201)
        status, demoted_self = admin.call("PATCH", f"/api/users/{dakota_id}", {"role": "teacher"})
        self.assertEqual(status, 200)
        self.assertEqual(demoted_self["role"], "teacher")
        status, still = teacher.call("PATCH", f"/api/users/{alex_id}", {"role": "teacher"})
        self.assertEqual(status, 400)
        self.assertEqual(still["error"], "Keep at least one admin who can still sign in.")
        status, restored = teacher.call("PATCH", f"/api/users/{dakota_id}", {"role": "admin"})
        self.assertEqual(status, 200)
        status, back = admin.call("PATCH", f"/api/users/{alex_id}", {"role": "teacher"})
        self.assertEqual(status, 200)
        self.assertEqual(back["role"], "teacher")
        status, removed = admin.call("DELETE", f"/api/users/{created['id']}")
        self.assertEqual(status, 200)
        conn = self.api.db()
        try:
            row = conn.execute("SELECT username, role FROM users WHERE id = ?", (dakota_id,)).fetchone()
            self.assertEqual(row["username"], "dakota")
            self.assertEqual(row["role"], "admin")
            other = conn.execute("SELECT role FROM users WHERE id = ?", (alex_id,)).fetchone()
            self.assertEqual(other["role"], "teacher")
            conn.execute("DELETE FROM staff WHERE name = 'roletemp'")
            conn.commit()
        finally:
            conn.execute("UPDATE users SET role = 'admin' WHERE id = ?", (dakota_id,))
            conn.execute("UPDATE users SET role = 'teacher' WHERE id = ?", (alex_id,))
            conn.execute("DELETE FROM users WHERE username = 'roletemp'")
            conn.execute("DELETE FROM staff WHERE name = 'roletemp'")
            conn.commit()
            conn.close()

    def test_saved_plans_round_trip_keeps_order_and_overrides(self):
        def clear_plans():
            conn = self.api.db()
            conn.execute("DELETE FROM lesson_plans")
            conn.commit()
            conn.close()

        self.addCleanup(clear_plans)
        self.assertTrue(is_class_day("2026-10-27"))
        self.assertTrue(is_class_day("2026-11-10"))
        self.assertFalse(is_class_day("2026-10-13"))
        self.assertFalse(is_class_day("2026-10-28"))
        admin = self.client()
        admin.login("dakota", "correct-horse")
        teacher = self.client()
        teacher.login("alex", "correct-horse")
        stranger = self.client()
        status, denied = stranger.call("GET", "/api/plans")
        self.assertEqual(status, 401)
        plan = {
            "mode": "grace",
            "settings": {"ageGroup": "mite", "date": "2026-10-27", "title": "GRACE BJJ KIDS"},
            "sparringEnabled": True,
            "sparringChoice": "manual",
            "lesson": {
                "items": [
                    {"id": "ls-second", "name": "Second", "ageOverride": True},
                    {"id": "ls-first", "name": "First", "ageOverride": False},
                ]
            },
        }
        status, saved = teacher.call(
            "PUT",
            "/api/plans",
            {"date": "2026-10-27", "ageGroup": "mite", "plan": plan},
        )
        self.assertEqual(status, 201)
        self.assertTrue(saved["created"])
        self.assertEqual(saved["classDate"], "2026-10-27")
        self.assertEqual(saved["ageGroup"], "mite")
        self.assertEqual(saved["savedByUsername"], "alex")
        items = saved["plan"]["lesson"]["items"]
        self.assertEqual([item["id"] for item in items], ["ls-second", "ls-first"])
        self.assertTrue(items[0]["ageOverride"])
        self.assertFalse(items[1]["ageOverride"])
        self.assertTrue(saved["plan"]["sparringEnabled"])
        self.assertEqual(saved["plan"]["sparringChoice"], "manual")
        plan["lesson"]["items"] = [
            {"id": "ls-first", "name": "First", "ageOverride": False},
            {"id": "ls-second", "name": "Second", "ageOverride": True},
        ]
        status, again = admin.call(
            "PUT",
            "/api/plans",
            {"date": "2026-10-27", "ageGroup": "mite", "plan": plan},
        )
        self.assertEqual(status, 200)
        self.assertFalse(again["created"])
        self.assertEqual(again["id"], saved["id"])
        self.assertEqual(again["savedByUsername"], "dakota")
        loaded_items = again["plan"]["lesson"]["items"]
        self.assertEqual([item["id"] for item in loaded_items], ["ls-first", "ls-second"])
        self.assertFalse(loaded_items[0]["ageOverride"])
        self.assertTrue(loaded_items[1]["ageOverride"])
        status, other = teacher.call(
            "PUT",
            "/api/plans",
            {
                "date": "2026-11-24",
                "ageGroup": "upper",
                "plan": {"mode": "grace", "settings": {"ageGroup": "upper"}, "lesson": {"items": []}},
            },
        )
        self.assertEqual(status, 201)
        status, middle = teacher.call(
            "PUT",
            "/api/plans",
            {
                "date": "2026-11-10",
                "ageGroup": "upper",
                "plan": {"mode": "grace", "settings": {"ageGroup": "upper"}, "lesson": {"items": []}},
            },
        )
        self.assertEqual(status, 201)
        status, bad_day = teacher.call(
            "PUT",
            "/api/plans",
            {"date": "2026-10-28", "ageGroup": "mite", "plan": plan},
        )
        self.assertEqual(status, 400)
        status, early = teacher.call(
            "PUT",
            "/api/plans",
            {"date": "2026-10-13", "ageGroup": "mite", "plan": plan},
        )
        self.assertEqual(status, 400)
        status, bad_age = teacher.call(
            "PUT",
            "/api/plans",
            {"date": "2026-10-27", "ageGroup": "nope", "plan": plan},
        )
        self.assertEqual(status, 400)
        status, listing = teacher.call("GET", "/api/plans")
        self.assertEqual(status, 200)
        dates = [item["classDate"] for item in listing["plans"]]
        today = today_pacific()
        upcoming = sorted(date for date in dates if date >= today)
        past = sorted((date for date in dates if date < today), reverse=True)
        self.assertEqual(dates, upcoming + past)
        self.assertIn("2026-10-27", dates)
        self.assertIn("2026-11-10", dates)
        self.assertIn("2026-11-24", dates)
        status, loaded = teacher.call("GET", f"/api/plans/{saved['id']}")
        self.assertEqual(status, 200)
        round_trip = loaded["plan"]["lesson"]["items"]
        self.assertEqual([item["id"] for item in round_trip], ["ls-first", "ls-second"])
        self.assertTrue(round_trip[1]["ageOverride"])
        self.assertTrue(loaded["plan"]["sparringEnabled"])
        self.assertEqual(loaded["plan"]["sparringChoice"], "manual")
        status, blocked = teacher.call("DELETE", f"/api/plans/{other['id']}")
        self.assertEqual(status, 403)
        status, removed = admin.call("DELETE", f"/api/plans/{other['id']}")
        self.assertEqual(status, 200)
        status, gone = teacher.call("GET", f"/api/plans/{other['id']}")
        self.assertEqual(status, 404)
        admin.call("DELETE", f"/api/plans/{saved['id']}")
        admin.call("DELETE", f"/api/plans/{middle['id']}")

    def test_age_group_migration_keeps_collisions(self):
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        conn = connect(path)
        try:
            migrate(conn)
            conn.execute("INSERT INTO classes (id, date, age_group) VALUES ('k-mite', '2026-10-27', 'mite')")
            conn.execute("INSERT INTO classes (id, date, age_group) VALUES ('k-jr', '2026-11-10', 'junior')")
            conn.execute("INSERT INTO classes (id, date, age_group) VALUES ('k-pw', '2026-11-10', 'peewee')")
            conn.execute("INSERT INTO classes (id, date, age_group) VALUES ('k-teen', '2026-11-24', 'teen')")
            plan = json.dumps(
                {
                    "mode": "grace",
                    "settings": {"ageGroup": "mite", "ages": "4–6 Mighty Mite"},
                    "lesson": {"items": [{"id": "ls-old", "name": "Old", "ages": ["peewee", "junior", "teen"]}]},
                }
            )
            conn.execute(
                """
                INSERT INTO lesson_plans
                  (id, class_date, age_group, plan_json, created_by, updated_by, created_at, updated_at)
                VALUES ('lp-ecd22b41', '2026-10-27', 'mite', ?, 'u', 'u', 't', 't')
                """,
                (plan,),
            )
            older = json.dumps({"mode": "grace", "settings": {"ageGroup": "peewee", "ages": "7–9 Pee Wee"}})
            conn.execute(
                """
                INSERT INTO lesson_plans
                  (id, class_date, age_group, plan_json, created_by, updated_by, created_at, updated_at)
                VALUES ('lp-upper', '2026-12-08', 'peewee', ?, 'u', 'u', 't', 't')
                """,
                (older,),
            )
            conn.commit()
            migrate(conn)
            self.assertEqual(
                conn.execute("SELECT age_group FROM classes WHERE id='k-mite'").fetchone()["age_group"],
                "mite",
            )
            self.assertEqual(
                conn.execute("SELECT age_group FROM classes WHERE id='k-teen'").fetchone()["age_group"],
                "upper",
            )
            same_day = {
                row["id"]: row["age_group"]
                for row in conn.execute("SELECT id, age_group FROM classes WHERE date='2026-11-10'")
            }
            self.assertEqual(same_day["k-jr"], "upper")
            self.assertEqual(same_day["k-pw"], "peewee")
            flags = list(conn.execute("SELECT * FROM age_group_flags"))
            self.assertEqual(len(flags), 1)
            self.assertEqual(flags[0]["source"], "classes")
            self.assertEqual(flags[0]["row_id"], "k-pw")
            self.assertEqual(flags[0]["wanted"], "upper")
            self.assertIn("another row already uses", flags[0]["note"])
            saved = conn.execute(
                "SELECT age_group, plan_json FROM lesson_plans WHERE id='lp-ecd22b41'"
            ).fetchone()
            self.assertEqual(saved["age_group"], "mite")
            body = json.loads(saved["plan_json"])
            self.assertEqual(body["settings"]["ageGroup"], "mite")
            self.assertEqual(body["settings"]["ages"], "3–6 Mighty Mites")
            self.assertEqual(body["lesson"]["items"][0]["ages"], ["mite", "upper"])
            folded = conn.execute(
                "SELECT age_group, plan_json FROM lesson_plans WHERE id='lp-upper'"
            ).fetchone()
            self.assertEqual(folded["age_group"], "upper")
            folded_body = json.loads(folded["plan_json"])
            self.assertEqual(folded_body["settings"]["ageGroup"], "upper")
            self.assertEqual(folded_body["settings"]["ages"], "7–10 Pee Wees")
            migrate(conn)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM age_group_flags").fetchone()["n"], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM classes").fetchone()["n"], 4)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM lesson_plans").fetchone()["n"], 2)
            again = json.loads(
                conn.execute("SELECT plan_json FROM lesson_plans WHERE id='lp-ecd22b41'").fetchone()["plan_json"]
            )
            self.assertEqual(again["settings"]["ages"], "3–6 Mighty Mites")
            self.assertEqual(
                conn.execute("SELECT age_group FROM classes WHERE id='k-pw'").fetchone()["age_group"],
                "peewee",
            )
        finally:
            conn.close()
            os.remove(path)


    def test_class_calendar_admin_skip_and_makeup(self):
        public = self.client()
        status, open_list = public.call("GET", "/api/public/class-exceptions")
        self.assertEqual(status, 200, open_list)
        self.assertEqual(open_list["exceptions"], [])
        teacher = self.client()
        status, _ = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200)
        status, denied = teacher.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2027-03-09", "kind": "skip", "reason": "Church event"},
        )
        self.assertEqual(status, 403, denied)
        self.assertIn("admin", denied["error"].lower())
        status, readable = teacher.call("GET", "/api/class-exceptions")
        self.assertEqual(status, 200, readable)
        self.assertEqual(readable["exceptions"], [])
        admin = self.client()
        status, _ = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        status, not_tuesday = admin.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2027-03-10", "kind": "skip", "reason": "Nope"},
        )
        self.assertEqual(status, 400, not_tuesday)
        status, skipped = admin.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2027-03-09", "kind": "skip", "reason": "Church event"},
        )
        self.assertEqual(status, 200, skipped)
        self.assertEqual(skipped["exception"]["kind"], "skip")
        self.assertEqual(skipped["exception"]["reason"], "Church event")
        self.assertEqual(skipped["exception"]["start"], "17:30")
        self.assertEqual(skipped["exception"]["end"], "18:15")
        status, extra = admin.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2027-03-10", "kind": "extra", "reason": "Make-up", "start": "17:30", "end": "18:15"},
        )
        self.assertEqual(status, 200, extra)
        self.assertEqual(extra["exception"]["kind"], "extra")
        status, again = admin.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2027-03-09", "kind": "skip", "reason": "Church event"},
        )
        self.assertEqual(status, 200, again)
        status, public_rows = public.call("GET", "/api/public/class-exceptions")
        self.assertEqual(status, 200, public_rows)
        by_date = {row["date"]: row for row in public_rows["exceptions"]}
        self.assertEqual(by_date["2027-03-09"]["kind"], "skip")
        self.assertEqual(by_date["2027-03-09"]["reason"], "Church event")
        self.assertEqual(by_date["2027-03-10"]["kind"], "extra")
        self.assertNotIn("createdBy", by_date["2027-03-09"])
        status, teacher_delete = teacher.call("DELETE", "/api/class-exceptions/2027-03-09")
        self.assertEqual(status, 403, teacher_delete)
        plan = {"mode": "grace", "settings": {"ageGroup": "upper", "title": "GRACE BJJ KIDS"}, "lesson": {"items": []}}
        status, on_extra = admin.call(
            "PUT",
            "/api/plans",
            {"date": "2027-03-10", "ageGroup": "upper", "plan": plan},
        )
        self.assertIn(status, (200, 201), on_extra)
        status, on_skip = admin.call(
            "PUT",
            "/api/plans",
            {"date": "2027-03-09", "ageGroup": "mite", "plan": plan},
        )
        self.assertIn(status, (200, 201), on_skip)
        status, still = admin.call("GET", f"/api/plans/{on_skip['id']}")
        self.assertEqual(status, 200, still)
        self.assertEqual(still["classDate"], "2027-03-09")
        status, undone = admin.call("DELETE", "/api/class-exceptions/2027-03-09")
        self.assertEqual(status, 200, undone)
        status, kept = admin.call("GET", f"/api/plans/{on_skip['id']}")
        self.assertEqual(status, 200, kept)
        self.assertEqual(kept["classDate"], "2027-03-09")
        admin.call("DELETE", f"/api/plans/{on_skip['id']}")
        admin.call("DELETE", f"/api/plans/{on_extra['id']}")
        admin.call("DELETE", "/api/class-exceptions/2027-03-10")
        status, empty = public.call("GET", "/api/public/class-exceptions")
        self.assertEqual(status, 200, empty)
        self.assertEqual(empty["exceptions"], [])

    def test_adult_class_calendar_is_separate_from_kids(self):
        self.assertTrue(is_adult_class_day("2026-10-27"))
        self.assertTrue(is_adult_class_day("2026-10-29"))
        self.assertTrue(is_adult_class_day("2026-10-06"))
        self.assertFalse(is_adult_class_day("2026-10-28"))
        self.assertTrue(is_adult_class_day("2026-10-13"))
        self.assertFalse(is_class_day("2026-10-13"))
        self.assertFalse(is_adult_class_day("not-a-date"))

        public = self.client()
        status, guest = public.call(
            "POST",
            "/api/class-exceptions",
            {"program": "adult", "date": "2026-10-29", "kind": "skip", "reason": "church event"},
        )
        self.assertEqual(status, 401, guest)
        self.assertEqual(guest["error"], "Log in first.")
        status, guest_delete = public.call("DELETE", "/api/class-exceptions/2026-10-29?program=adult")
        self.assertEqual(status, 401, guest_delete)
        status, guest_kids = public.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2026-11-10", "kind": "skip", "reason": "Kids only"},
        )
        self.assertEqual(status, 403, guest_kids)
        self.assertIn("reloaded", guest_kids["error"].lower())
        status, guest_list = public.call("GET", "/api/class-exceptions?program=adult")
        self.assertEqual(status, 401, guest_list)

        teacher = self.client()
        status, alex = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200, alex)
        status, denied = teacher.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2026-11-10", "kind": "skip", "reason": "Kids only"},
        )
        self.assertEqual(status, 403, denied)
        self.assertEqual(denied["error"], "An admin edits the class calendar.")
        status, denied_delete = teacher.call("DELETE", "/api/class-exceptions/2026-11-10")
        self.assertEqual(status, 403, denied_delete)
        self.assertEqual(denied_delete["error"], "An admin edits the class calendar.")
        status, readable = teacher.call("GET", "/api/class-exceptions?program=adult")
        self.assertEqual(status, 200, readable)
        self.assertEqual(readable["exceptions"], [])

        admin = self.client()
        admin.login("dakota", "correct-horse")
        status, bad_program = admin.call(
            "POST",
            "/api/class-exceptions",
            {"program": "nope", "date": "2026-10-29", "kind": "skip"},
        )
        self.assertEqual(status, 400, bad_program)
        status, wednesday = admin.call(
            "POST",
            "/api/class-exceptions",
            {"program": "adult", "date": "2026-10-28", "kind": "skip", "reason": "Nope"},
        )
        self.assertEqual(status, 400, wednesday)
        self.assertIn("Tuesday or Thursday", wednesday["error"])
        status, already = admin.call(
            "POST",
            "/api/class-exceptions",
            {"program": "adult", "date": "2026-10-29", "kind": "extra", "reason": "Open mat"},
        )
        self.assertEqual(status, 400, already)
        self.assertIn("already on the schedule", already["error"])
        status, long_reason = admin.call(
            "POST",
            "/api/class-exceptions",
            {"program": "adult", "date": "2026-10-29", "kind": "skip", "reason": "x" * 121},
        )
        self.assertEqual(status, 400, long_reason)
        status, backwards = admin.call(
            "POST",
            "/api/class-exceptions",
            {
                "program": "adult",
                "date": "2026-10-28",
                "kind": "extra",
                "reason": "Open mat",
                "start": "20:00",
                "end": "18:30",
            },
        )
        self.assertEqual(status, 400, backwards)
        self.assertIn("after the start", backwards["error"])

        conn = self.api.db()
        before_log = conn.execute("SELECT COUNT(*) AS n FROM change_log").fetchone()["n"]
        conn.close()
        status, skipped = teacher.call(
            "POST",
            "/api/class-exceptions",
            {"program": "adult", "date": "2026-10-29", "kind": "skip", "reason": "church event"},
        )
        self.assertEqual(status, 200, skipped)
        self.assertEqual(skipped["exception"]["program"], "adult")
        self.assertEqual(skipped["exception"]["start"], "18:30")
        self.assertEqual(skipped["exception"]["end"], "20:00")
        self.assertEqual(skipped["exception"]["reason"], "church event")
        status, extra = teacher.call(
            "POST",
            "/api/class-exceptions",
            {
                "program": "adult",
                "date": "2026-10-28",
                "kind": "extra",
                "reason": "Open mat",
                "start": "18:30",
                "end": "20:00",
            },
        )
        self.assertEqual(status, 200, extra)
        self.assertEqual(extra["exception"]["kind"], "extra")
        status, edited = teacher.call(
            "POST",
            "/api/class-exceptions",
            {
                "program": "adult",
                "date": "2026-10-28",
                "kind": "extra",
                "reason": "Seminar",
                "start": "18:30",
                "end": "19:30",
            },
        )
        self.assertEqual(status, 200, edited)
        self.assertEqual(edited["exception"]["reason"], "Seminar")
        self.assertEqual(edited["exception"]["end"], "19:30")
        status, kids_same_day = admin.call(
            "POST",
            "/api/class-exceptions",
            {"date": "2026-11-10", "kind": "skip", "reason": "Kids only"},
        )
        self.assertEqual(status, 200, kids_same_day)

        status, adult_public = public.call("GET", "/api/public/class-exceptions?program=adult")
        self.assertEqual(status, 200, adult_public)
        by_date = {row["date"]: row for row in adult_public["exceptions"]}
        self.assertEqual(by_date["2026-10-29"]["kind"], "skip")
        self.assertEqual(by_date["2026-10-29"]["reason"], "church event")
        self.assertEqual(by_date["2026-10-28"]["kind"], "extra")
        self.assertEqual(by_date["2026-10-28"]["reason"], "Seminar")
        self.assertNotIn("createdBy", by_date["2026-10-29"])
        self.assertNotIn("2026-11-10", by_date)
        status, kids_public = public.call("GET", "/api/public/class-exceptions")
        self.assertEqual(status, 200, kids_public)
        kids_dates = {row["date"] for row in kids_public["exceptions"]}
        self.assertIn("2026-11-10", kids_dates)
        self.assertNotIn("2026-10-29", kids_dates)
        self.assertNotIn("2026-10-28", kids_dates)
        status, unknown = public.call("GET", "/api/public/class-exceptions?program=nope")
        self.assertEqual(status, 400, unknown)

        plan = {"mode": "grace", "settings": {"ageGroup": "upper", "title": "GRACE BJJ KIDS"}, "lesson": {"items": []}}
        status, blocked = admin.call(
            "PUT",
            "/api/plans",
            {"date": "2026-10-28", "ageGroup": "upper", "plan": plan},
        )
        self.assertEqual(status, 400, blocked)
        status, teacher_log = teacher.call("GET", "/api/change-log")
        self.assertEqual(status, 403, teacher_log)
        status, removed_adult = teacher.call("DELETE", "/api/class-exceptions/2026-10-29?program=adult")
        self.assertEqual(status, 200, removed_adult)
        status, kids_still = public.call("GET", "/api/public/class-exceptions")
        self.assertIn("2026-11-10", {row["date"] for row in kids_still["exceptions"]})
        status, removed_extra = teacher.call("DELETE", "/api/class-exceptions/2026-10-28?program=adult")
        self.assertEqual(status, 200, removed_extra)
        admin.call("DELETE", "/api/class-exceptions/2026-11-10")
        status, adult_empty = public.call("GET", "/api/public/class-exceptions?program=adult")
        self.assertEqual(adult_empty["exceptions"], [])
        status, kids_empty = public.call("GET", "/api/public/class-exceptions")
        self.assertNotIn("2026-11-10", {row["date"] for row in kids_empty["exceptions"]})

        conn = self.api.db()
        try:
            after_log = conn.execute("SELECT COUNT(*) AS n FROM change_log").fetchone()["n"]
            self.assertEqual(after_log - before_log, 5)
            recent = conn.execute(
                "SELECT action, actor_name, student_name, before_json, after_json FROM change_log ORDER BY id DESC LIMIT 5"
            ).fetchall()
            self.assertTrue(all(row["action"] == "adult_calendar" for row in recent))
            self.assertTrue(all(row["student_name"] == "Adult calendar" for row in recent))
            self.assertTrue(all(row["actor_name"] for row in recent))
            blobs = " ".join((row["before_json"] or "") + (row["after_json"] or "") for row in recent)
            self.assertIn("church event", blobs)
            self.assertIn("Open mat", blobs)
            self.assertIn("Seminar", blobs)
            self.assertNotIn("Kids only", blobs)
            status, admin_log = admin.call("GET", "/api/change-log")
            self.assertEqual(status, 200, admin_log)
            adult_entries = [entry for entry in admin_log["entries"] if entry["action"] == "adult_calendar"]
            self.assertGreaterEqual(len(adult_entries), 5)
            edited_row = next(entry for entry in adult_entries if (entry["after"] or {}).get("reason") == "Seminar")
            self.assertEqual(edited_row["before"]["reason"], "Open mat")
            self.assertEqual(edited_row["before"]["end"], "20:00")
            self.assertEqual(edited_row["after"]["end"], "19:30")
            self.assertTrue(edited_row["atPt"].endswith("PT"))
        finally:
            conn.close()

        old_path = tempfile.NamedTemporaryFile(suffix=".db", delete=False).name
        self.addCleanup(lambda: os.path.exists(old_path) and os.remove(old_path))
        old = connect(old_path)
        try:
            old.execute(
                """
                CREATE TABLE class_exceptions (
                  date TEXT PRIMARY KEY,
                  kind TEXT NOT NULL CHECK(kind IN ('skip', 'extra')),
                  reason TEXT NOT NULL DEFAULT '',
                  start_time TEXT NOT NULL DEFAULT '17:30',
                  end_time TEXT NOT NULL DEFAULT '18:15',
                  created_by TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL
                )
                """
            )
            old.execute(
                """
                INSERT INTO class_exceptions
                  (date, kind, reason, start_time, end_time, created_by, created_at)
                VALUES ('2026-10-27', 'skip', 'Church event', '17:30', '18:15', 'dakota', '2026-10-01T00:00:00Z')
                """
            )
            old.commit()
            migrate(old)
            copied = old.execute("SELECT program, date, reason FROM class_exceptions").fetchone()
            self.assertEqual(copied["program"], "kids")
            self.assertEqual(copied["date"], "2026-10-27")
            self.assertEqual(copied["reason"], "Church event")
            migrate(old)
            self.assertEqual(old.execute("SELECT COUNT(*) AS n FROM class_exceptions").fetchone()["n"], 1)
            old.execute(
                """
                INSERT INTO class_exceptions
                  (program, date, kind, reason, start_time, end_time, created_by, created_at)
                VALUES ('adult', '2026-10-27', 'skip', 'Adult night', '18:30', '20:00', 'dakota', '2026-10-01T00:00:00Z')
                """
            )
            old.commit()
            self.assertEqual(old.execute("SELECT COUNT(*) AS n FROM class_exceptions").fetchone()["n"], 2)
        finally:
            old.close()

    def waiver_body(self, **overrides):
        body = {
            "kind": "adult",
            "participantName": "Jordan Lee",
            "address": "4197 State St, Salem",
            "email": "jordan@example.com",
            "phone": "503-555-0100",
            "dob": "1990-04-02",
            "parentName": "",
            "goals": ["Health", "Fun"],
            "emergencyName": "Sam Lee",
            "emergencyPhone": "503-555-0199",
            "injuries": "",
            "typedName": "Jordan Lee",
            "printName": "Jordan Lee",
            "signature": PNG,
            "parentTypedName": "",
            "parentPrintName": "",
            "parentSignature": "",
            "pin": "2468",
        }
        body.update(overrides)
        return body

    def test_waivers_stay_closed_and_admins_review_them(self):
        self.api.cfg["waiver_submissions_enabled"] = False
        guest = self.client()
        status, denied = guest.call("POST", "/api/public/waivers", self.waiver_body())
        self.assertEqual(status, 403, denied)
        self.assertIn("not open", denied["error"])
        teacher = self.client()
        teacher.login("alex", "correct-horse")
        status, hidden = teacher.call("GET", "/api/waivers")
        self.assertEqual(status, 403, hidden)
        status, csv_hidden = teacher.call("GET", "/api/waivers.csv", raw=True)
        self.assertEqual(status, 403, csv_hidden)
        admin = self.client()
        admin.login("dakota", "correct-horse")
        status, empty = admin.call("GET", "/api/waivers")
        self.assertEqual(status, 200, empty)
        self.assertEqual(empty["waivers"], [])

        self.api.cfg["waiver_submissions_enabled"] = True
        try:
            from datetime import date

            year = date.today().year
            young = self.waiver_body(dob=f"{year - 6}-01-15")
            status, too_young = guest.call("POST", "/api/public/waivers", young)
            self.assertEqual(status, 400, too_young)
            minor = self.waiver_body(dob=f"{year - 14}-01-15")
            status, needs_parent = guest.call("POST", "/api/public/waivers", minor)
            self.assertEqual(status, 400, needs_parent)
            minor.update(
                {
                    "parentName": "Pat Parent",
                    "parentTypedName": "Pat Parent",
                    "parentPrintName": "Pat Parent",
                    "parentSignature": PNG,
                }
            )
            status, saved = guest.call("POST", "/api/public/waivers", minor)
            self.assertEqual(status, 201, saved)
            status, kids_saved = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Casey Lee",
                    dob=f"{year - 6}-02-02",
                    parentName="Pat Parent",
                    injuries="None",
                ),
            )
            self.assertEqual(status, 201, kids_saved)
            status, teacher_detail = teacher.call("GET", "/api/waivers/" + saved["id"])
            self.assertEqual(status, 200, teacher_detail)
            self.assertTrue(teacher_detail["signature"].startswith("data:image/png"))
            self.assertEqual(teacher_detail["payload"]["parentName"], "Pat Parent")
            status, guest_hidden = guest.call("GET", "/api/waivers/" + saved["id"])
            self.assertEqual(status, 401, guest_hidden)
            status, detail = admin.call("GET", "/api/waivers/" + saved["id"])
            self.assertEqual(status, 200, detail)
            self.assertTrue(detail["signature"].startswith("data:image/png"))
            self.assertTrue(detail["parentSignature"].startswith("data:image/png"))
            self.assertEqual(detail["payload"]["parentName"], "Pat Parent")
            status, csv_body = admin.call("GET", "/api/waivers.csv", raw=True)
            self.assertEqual(status, 200)
            text = csv_body.decode()
            self.assertIn("Casey Lee", text)
            self.assertIn("Jordan Lee", text)
            self.assertNotIn("data:image", text)
            self.assertEqual(detail["rosterStudentId"], "")
            self.assertFalse(detail["addedToRoster"])
            status, boot = admin.call("GET", "/api/bootstrap")
            names = [row["name"] for row in boot["students"]]
            self.assertNotIn("Jordan Lee", names)
            self.assertNotIn("Casey Lee", names)
        finally:
            self.api.cfg["waiver_submissions_enabled"] = None

    def test_enrollment_review_matches_and_adds(self):
        from datetime import date

        self.api._waiver_posts = []
        self.api.cfg["waiver_submissions_enabled"] = True
        guest = self.client()
        teacher = self.client()
        teacher.login("alex", "correct-horse")
        admin = self.client()
        admin.login("dakota", "correct-horse")
        year = date.today().year
        kid_dob = f"{year - 8}-06-06"
        other_dob = f"{year - 7}-07-07"
        adult_dob = f"{year - 30}-08-08"
        created = []
        try:
            status, hidden = teacher.call("GET", "/api/enrollment-review")
            self.assertEqual(status, 403, hidden)
            status, guest_hidden = guest.call("GET", "/api/enrollment-review")
            self.assertEqual(status, 401, guest_hidden)

            status, kid = admin.call(
                "POST",
                "/api/students",
                {"name": "Sam Review", "age": 8, "belt": "white", "stripes": 0, "dob": kid_dob},
            )
            self.assertEqual(status, 201, kid)
            created.append(kid["id"])
            status, other = admin.call(
                "POST",
                "/api/students",
                {"name": "Alex Review", "age": 7, "belt": "white", "stripes": 0, "dob": other_dob},
            )
            self.assertEqual(status, 201, other)
            created.append(other["id"])
            status, adult = admin.call(
                "POST",
                "/api/students",
                {"name": "Riley Review", "age": 30, "belt": "white", "stripes": 0, "dob": adult_dob},
            )
            self.assertEqual(status, 201, adult)
            created.append(adult["id"])

            before_students = admin.call("GET", "/api/bootstrap")[1]["students"]
            before_count = len(before_students)
            status, exact = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Sam Review",
                    email="review-sam@example.com",
                    phone="503-555-0142",
                    dob=kid_dob,
                    parentName="Pat Review",
                    injuries="STAFF-ONLY-KNEE",
                ),
            )
            self.assertEqual(status, 201, exact)
            status, still = admin.call("GET", "/api/bootstrap")
            self.assertEqual(len(still["students"]), before_count)
            sam = next(row for row in still["students"] if row["id"] == kid["id"])
            self.assertFalse(sam["waiver"]["signed"])

            status, review = admin.call("GET", "/api/enrollment-review")
            self.assertEqual(status, 200, review)
            self.assertFalse(review["kidsEnrollment"]["waitlistEnabled"])
            form = next(row for row in review["kids"] if row["id"] == exact["id"])
            self.assertFalse(form["linked"])
            self.assertEqual(form["preselectId"], kid["id"])
            suggestion = next(row for row in form["suggestions"] if row["studentId"] == kid["id"])
            self.assertTrue(suggestion["exact"])
            self.assertIn("Same name", suggestion["reasons"])
            self.assertIn("Same birth date", suggestion["reasons"])
            self.assertEqual(form["rosterStudentId"], "")
            self.assertTrue(any(row["participantName"] == "Sam Review" for row in review["kids"]))
            self.assertFalse(any(row["id"] == exact["id"] for row in review["adults"]))

            status, teacher_match = teacher.call(
                "POST", f"/api/waivers/{exact['id']}/match", {"studentId": kid["id"]}
            )
            self.assertEqual(status, 403, teacher_match)
            status, teacher_add = teacher.call("POST", f"/api/waivers/{exact['id']}/add", {})
            self.assertEqual(status, 403, teacher_add)

            status, matched = admin.call(
                "POST", f"/api/waivers/{exact['id']}/match", {"studentId": kid["id"]}
            )
            self.assertEqual(status, 200, matched)
            self.assertTrue(matched["waiver"]["signed"])
            self.assertEqual(matched["waiver"]["waiverId"], exact["id"])
            status, signed = admin.call("GET", "/api/bootstrap")
            sam = next(row for row in signed["students"] if row["id"] == kid["id"])
            self.assertTrue(sam["waiver"]["signed"])
            self.assertEqual(sam["waiver"]["waiverId"], exact["id"])
            token = sam["parentToken"]
            status, parent = guest.call(
                "POST", "/api/public/parent", {"token": token, "month": 6, "day": 6}
            )
            self.assertEqual(status, 200, parent)
            self.assertTrue(parent["waiver"]["signed"])
            self.assertNotIn("STAFF-ONLY-KNEE", json.dumps(parent))
            self.assertNotIn("review-sam@example.com", json.dumps(parent))

            status, household = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Quinn Review",
                    email="review-sam@example.com",
                    phone="(503) 555-0142",
                    dob=other_dob,
                    parentName="Pat Review",
                    injuries="",
                ),
            )
            self.assertEqual(status, 201, household)
            status, review = admin.call("GET", "/api/enrollment-review")
            second = next(row for row in review["kids"] if row["id"] == household["id"])
            self.assertEqual(second["preselectId"], "")
            hinted = next(row for row in second["suggestions"] if row["studentId"] == kid["id"])
            self.assertFalse(hinted["exact"])
            self.assertIn("Same email", hinted["reasons"])
            self.assertIn("Same parent or guardian", hinted["reasons"])
            self.assertIn("Same phone", hinted["reasons"])
            self.assertGreater(
                hinted["score"],
                next(row["score"] for row in second["suggestions"] if row["studentId"] == other["id"]),
            )

            status, rematch = admin.call(
                "POST", f"/api/waivers/{exact['id']}/match", {"studentId": other["id"]}
            )
            self.assertEqual(status, 200, rematch)
            status, moved = admin.call("GET", "/api/bootstrap")
            sam = next(row for row in moved["students"] if row["id"] == kid["id"])
            alex = next(row for row in moved["students"] if row["id"] == other["id"])
            self.assertFalse(sam["waiver"]["signed"])
            self.assertTrue(alex["waiver"]["signed"])
            self.assertEqual(alex["waiver"]["waiverId"], exact["id"])

            status, cleared = admin.call("POST", f"/api/waivers/{exact['id']}/unlink", {})
            self.assertEqual(status, 200, cleared)
            self.assertFalse(cleared["waiver"]["signed"])
            status, open_again = admin.call("GET", "/api/enrollment-review")
            again = next(row for row in open_again["kids"] if row["id"] == exact["id"])
            self.assertFalse(again["linked"])
            self.assertEqual(again["preselectId"], kid["id"])

            status, adult_form = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    participantName="Riley Review",
                    email="review-riley@example.com",
                    dob=adult_dob,
                ),
            )
            self.assertEqual(status, 201, adult_form)
            status, adults = admin.call("GET", "/api/bootstrap")
            self.assertEqual(
                len([row for row in adults["students"] if row["name"] == "Riley Review"]),
                1,
            )
            adult_row = next(row for row in admin.call("GET", "/api/enrollment-review")[1]["adults"] if row["id"] == adult_form["id"])
            self.assertFalse(adult_row["linked"])
            self.assertEqual(adult_row["preselectId"], adult["id"])
            self.assertEqual(adult_row["ageGroupLabel"], "18 and up")
            status, adult_match = admin.call(
                "POST", f"/api/waivers/{adult_form['id']}/match", {"studentId": adult["id"]}
            )
            self.assertEqual(status, 200, adult_match)
            status, adult_parent = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": adult["parentToken"], "month": 8, "day": 8, "pin": "2468"},
            )
            self.assertEqual(status, 200, adult_parent)
            self.assertEqual(adult_parent["signForm"], "adult")
            self.assertTrue(adult_parent["waiver"]["signed"])
            self.assertEqual(adult_parent["waiver"]["signerName"], "Jordan Lee")

            status, newbie = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Brand New Review",
                    email="review-new@example.com",
                    phone="503-555-0177",
                    dob=f"{year - 6}-09-09",
                    parentName="Ned Review",
                    injuries="STAFF-ONLY-ASTHMA",
                ),
            )
            self.assertEqual(status, 201, newbie)
            status, added = admin.call("POST", f"/api/waivers/{newbie['id']}/add", {})
            self.assertEqual(status, 201, added)
            created.append(added["id"])
            self.assertEqual(added["name"], "Brand New Review")
            self.assertEqual(added["dob"], f"{year - 6}-09-09")
            self.assertEqual(added["age"], 6)
            self.assertTrue(added["waiver"]["signed"])
            self.assertEqual(added["waiver"]["waiverId"], newbie["id"])
            conn = connect(self.api.cfg["db_path"])
            stored = conn.execute("SELECT * FROM students WHERE id = ?", (added["id"],)).fetchone()
            note = conn.execute("SELECT note FROM notes WHERE student_id = ?", (added["id"],)).fetchone()
            conn.close()
            self.assertEqual(stored["parent_name"], "Ned Review")
            self.assertEqual(stored["parent_email"], "review-new@example.com")
            self.assertEqual(stored["parent_phone"], "503-555-0177")
            self.assertIn("STAFF-ONLY-ASTHMA", note["note"])
            status, parent_new = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": added["parentToken"], "month": 9, "day": 9},
            )
            self.assertEqual(status, 200, parent_new)
            self.assertTrue(parent_new["waiver"]["signed"])
            dumped = json.dumps(parent_new)
            self.assertNotIn("STAFF-ONLY-ASTHMA", dumped)
            self.assertNotIn("review-new@example.com", dumped)
            self.assertNotIn("Ned Review", dumped)
            status, noted = admin.call("GET", "/api/bootstrap")
            self.assertIn("STAFF-ONLY-ASTHMA", noted["notes"][added["id"]])

            status, cap_now = guest.call("GET", "/api/public/kids-enrollment")
            status, tightened = admin.call("PUT", "/api/kids-cap", {"cap": cap_now["enrolled"]})
            self.assertEqual(status, 200, tightened)
            self.assertTrue(tightened["full"])
            status, duplicate = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Sam Review",
                    email="review-dup@example.com",
                    dob=kid_dob,
                    parentName="Pat Review",
                ),
            )
            self.assertEqual(status, 201, duplicate)
            status, blocked = admin.call("POST", f"/api/waivers/{duplicate['id']}/add", {})
            self.assertEqual(status, 409, blocked)
            self.assertTrue(blocked["needsConfirm"])
            self.assertEqual(self._waitlist_count(), 0)
            status, forced = admin.call(
                "POST", f"/api/waivers/{duplicate['id']}/add", {"confirmOverCap": True}
            )
            self.assertEqual(status, 201, forced)
            created.append(forced["id"])
            self.assertGreater(forced["kidsEnrollment"]["enrolled"], forced["kidsEnrollment"]["cap"])
            self.assertEqual(self._waitlist_count(), 0)
            status, wrong = admin.call(
                "POST", f"/api/waivers/{newbie['id']}/match", {"studentId": adult["id"]}
            )
            self.assertEqual(status, 400, wrong)
        finally:
            self.api.cfg["waiver_submissions_enabled"] = None
            self.api._waiver_posts = []
            admin.call("PUT", "/api/kids-cap", {"cap": 12})
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")
            conn = connect(self.api.cfg["db_path"])
            conn.execute("DELETE FROM waivers WHERE email LIKE 'review-%'")
            conn.execute("DELETE FROM students WHERE name LIKE '% Review'")
            conn.execute("DELETE FROM settings WHERE key = 'kids_cap'")
            conn.commit()
            conn.close()

    def test_parent_card_hides_medical_notes(self):
        from datetime import date

        self.api._parent_fails = []
        self.api._parent_grants = {}
        self.api._waiver_posts = []
        self.api.cfg["waiver_submissions_enabled"] = True
        guest = self.client()
        teacher = self.client()
        teacher.login("alex", "correct-horse")
        admin = self.client()
        admin.login("dakota", "correct-horse")
        year = date.today().year
        dob_a = f"{year - 6}-04-04"
        dob_b = f"{year - 6}-05-05"
        created = []
        try:
            status, kid = admin.call(
                "POST",
                "/api/students",
                {"name": "Ada Token", "age": 6, "belt": "grey", "stripes": 2, "dob": dob_a},
            )
            self.assertEqual(status, 201, kid)
            created.append(kid["id"])
            status, twin = admin.call(
                "POST",
                "/api/students",
                {"name": "Ada Token", "age": 6, "belt": "white", "stripes": 0, "dob": dob_b},
            )
            self.assertEqual(status, 201, twin)
            created.append(twin["id"])
            status, blank = admin.call(
                "POST",
                "/api/students",
                {"name": "Bea Token", "age": 7, "belt": "white", "stripes": 0},
            )
            self.assertEqual(status, 201, blank)
            created.append(blank["id"])
            status, boot = admin.call("GET", "/api/bootstrap")
            self.assertEqual(status, 200, boot)
            ada = next(row for row in boot["students"] if row["id"] == kid["id"])
            twin_row = next(row for row in boot["students"] if row["id"] == twin["id"])
            bea = next(row for row in boot["students"] if row["id"] == blank["id"])
            token = ada["parentToken"]
            self.assertGreaterEqual(len(token), 20)
            self.assertNotEqual(token, kid["id"])
            self.assertNotEqual(token, "1")
            self.assertNotEqual(ada["parentToken"], twin_row["parentToken"])
            status, hidden = guest.call("GET", "/api/bootstrap")
            self.assertEqual(status, 401, hidden)
            self.assertNotIn(token, json.dumps(hidden))
            status, examples = guest.call("GET", "/api/public/demo-examples")
            self.assertEqual(status, 404, examples)
            status, public = guest.call("GET", "/api/public/kids-enrollment")
            self.assertNotIn(token, json.dumps(public))
            self.assertNotIn("parentToken", json.dumps(public))
            admin.call("PUT", "/api/notes", {"studentId": kid["id"], "note": "STAFF-NOTE-SECRET"})
            admin.call(
                "POST",
                "/api/attendance",
                {
                    "date": "2026-10-27",
                    "ageGroup": "mite",
                    "theme": "mount",
                    "themeLabel": "Mount",
                    "techniques": [{"id": "ls-upa", "name": "Upa", "position": "Mount", "theme": "mount"}],
                    "game": "",
                    "attended": [kid["id"]],
                    "taught": True,
                },
            )
            teacher.call("PUT", "/api/levels", {"studentId": kid["id"], "techId": "ls-upa", "level": "practicing"})

            status, bad_token = guest.call("POST", "/api/public/parent", {"token": "1", "month": 4, "day": 4})
            status_id, bad_id = guest.call(
                "POST", "/api/public/parent", {"token": kid["id"], "month": 4, "day": 4}
            )
            status_date, bad_date = guest.call(
                "POST", "/api/public/parent", {"token": token, "month": 1, "day": 1}
            )
            self.assertEqual(status, 400, bad_token)
            self.assertEqual(status_id, 400, bad_id)
            self.assertEqual(status_date, 400, bad_date)
            self.assertEqual(bad_token["error"], bad_date["error"])
            self.assertEqual(bad_id["error"], "Those details don't match.")
            self.assertNotIn("Ada", json.dumps(bad_token))
            self.assertNotIn(token, json.dumps(bad_date))

            status, open_card = guest.call(
                "POST", "/api/public/parent", {"token": token, "month": 4, "day": 4}
            )
            self.assertEqual(status, 200, open_card)
            self.assertEqual(
                set(open_card),
                {
                    "firstName",
                    "ageGroup",
                    "belt",
                    "beltLabel",
                    "stripes",
                    "stripesLabel",
                    "signForm",
                    "progress",
                    "waiver",
                },
            )
            self.assertEqual(open_card["firstName"], "Ada")
            self.assertEqual(open_card["ageGroup"], "3–6 Mighty Mites")
            self.assertEqual(open_card["beltLabel"], "Grey")
            self.assertEqual(open_card["stripesLabel"], "2 stripes")
            self.assertEqual(open_card["signForm"], "kids")
            self.assertGreaterEqual(open_card["progress"]["techniques"], 1)
            self.assertGreaterEqual(open_card["progress"]["classes"], 1)
            self.assertIn("2026-10-27", open_card["progress"]["recentAttendance"])
            self.assertFalse(open_card["waiver"]["signed"])
            dumped = json.dumps(open_card)
            for banned in (dob_a, "STAFF-NOTE-SECRET", "SECRET-MEDICAL-NOTE", token, twin_row["parentToken"], "waitlist"):
                self.assertNotIn(banned, dumped)
            self.assertNotEqual(guest.cookies.get("bjj_parent"), token)
            self.assertTrue(guest.cookies.get("bjj_parent"))
            status, again = guest.call("GET", "/api/public/parent")
            self.assertEqual(status, 200, again)
            self.assertEqual(again["firstName"], "Ada")

            status, unfinished = guest.call(
                "POST",
                "/api/public/parent",
                {"token": bea["parentToken"], "month": 1, "day": 1},
            )
            self.assertEqual(status, 400, unfinished)
            self.assertEqual(unfinished["error"], "Ask a teacher to finish this card.")
            self.assertNotIn("Bea", json.dumps(unfinished))

            before = guest.call("GET", "/api/public/kids-enrollment")[1]["enrolled"]
            status, linked = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Totally Other",
                    email="token-view-a@example.com",
                    dob=dob_a,
                    parentName="Pat Parent",
                    injuries="SECRET-MEDICAL-NOTE",
                    parentToken=token,
                    birthMonth=4,
                    birthDay=4,
                ),
            )
            self.assertEqual(status, 201, linked)
            status, after = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(after["enrolled"], before)
            status, signed = guest.call("POST", "/api/public/parent", {"token": token, "month": 4, "day": 4})
            self.assertEqual(status, 200, signed)
            self.assertTrue(signed["waiver"]["signed"])
            self.assertEqual(signed["waiver"]["signerName"], "Jordan Lee")
            self.assertNotIn("SECRET-MEDICAL-NOTE", json.dumps(signed))
            status, printed = guest.call("GET", "/api/public/parent/waiver")
            self.assertEqual(status, 200, printed)
            self.assertEqual(printed["participantName"], "Totally Other")
            self.assertTrue(printed["signature"].startswith("data:image/png"))
            self.assertNotIn("SECRET-MEDICAL-NOTE", json.dumps(printed))
            self.assertNotIn("dob", printed)
            self.assertNotIn("email", printed)
            self.assertNotIn("injuries", printed)
            status, twin_waiver = admin.call("GET", "/api/bootstrap")
            twin_again = next(row for row in twin_waiver["students"] if row["id"] == twin["id"])
            self.assertFalse(twin_again["waiver"]["signed"])
            linked_row = next(row for row in twin_waiver["students"] if row["id"] == kid["id"])
            self.assertTrue(linked_row["waiver"]["signed"])
            self.assertEqual(linked_row["waiver"]["waiverId"], linked["id"])

            status, loose = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Ada Token",
                    email="token-view-b@example.com",
                    dob=dob_a,
                    parentName="Pat Parent",
                    injuries="SECRET-MEDICAL-NOTE",
                ),
            )
            self.assertEqual(status, 201, loose)
            status, listed = admin.call("GET", "/api/waivers/" + loose["id"])
            self.assertEqual(listed["rosterStudentId"], "")
            status, teacher_form = teacher.call("GET", "/api/waivers/" + linked["id"])
            self.assertEqual(status, 200, teacher_form)
            self.assertEqual(teacher_form["payload"]["injuries"], "SECRET-MEDICAL-NOTE")
            status, guest_form = self.client().call("GET", "/api/waivers/" + linked["id"])
            self.assertEqual(status, 401, guest_form)
            status, teacher_list = teacher.call("GET", "/api/waivers")
            self.assertEqual(status, 403, teacher_list)

            other = self.client()
            for _ in range(5):
                status, missed = other.call(
                    "POST",
                    "/api/public/parent",
                    {"token": twin_row["parentToken"], "month": 1, "day": 1},
                )
                self.assertEqual(status, 400, missed)
            status, limited = other.call(
                "POST",
                "/api/public/parent",
                {"token": twin_row["parentToken"], "month": 5, "day": 5},
            )
            self.assertEqual(status, 429, limited)
            self.assertEqual(limited["error"], "Too many tries. Wait and try again.")
            self.assertNotIn("Ada", json.dumps(limited))

            status, revoked = admin.call(
                "POST", f"/api/students/{kid['id']}/parent-token", {"revoke": True}
            )
            self.assertEqual(status, 200, revoked)
            self.assertEqual(revoked["parentToken"], "")
            status, dead = guest.call("POST", "/api/public/parent", {"token": token, "month": 4, "day": 4})
            self.assertEqual(status, 400, dead)
            self.assertEqual(dead["error"], "Those details don't match.")
            status, renewed = teacher.call("POST", f"/api/students/{kid['id']}/parent-token", {})
            self.assertEqual(status, 200, renewed)
            self.assertGreaterEqual(len(renewed["parentToken"]), 20)
            self.assertNotEqual(renewed["parentToken"], token)
            status, fresh = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": renewed["parentToken"], "month": 4, "day": 4},
            )
            self.assertEqual(status, 200, fresh)
            self.assertEqual(fresh["firstName"], "Ada")
            self.assertNotIn("SECRET-MEDICAL-NOTE", json.dumps(fresh))
        finally:
            self.api.cfg["waiver_submissions_enabled"] = None
            self.api._waiver_posts = []
            self.api._parent_fails = []
            self.api._parent_grants = {}
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")
            conn = connect(self.api.cfg["db_path"])
            conn.execute("DELETE FROM waivers WHERE email LIKE 'token-view-%'")
            conn.execute("DELETE FROM students WHERE name IN ('Ada Token', 'Bea Token')")
            conn.commit()
            conn.close()

    def _waiver_count(self):
        conn = connect(self.api.cfg["db_path"])
        try:
            return conn.execute("SELECT COUNT(*) AS n FROM waivers").fetchone()["n"]
        finally:
            conn.close()

    def test_migrate_adds_kids_cap_columns(self):
        path = os.path.join(self.tmp.name, "pre-cap.db")
        conn = connect(path)
        conn.execute(
            """
            CREATE TABLE students (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              age INTEGER NOT NULL,
              belt TEXT NOT NULL,
              stripes INTEGER NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE waivers (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL,
              submitted_at TEXT NOT NULL,
              signed_on TEXT NOT NULL,
              participant_name TEXT NOT NULL,
              signer_name TEXT NOT NULL,
              dob TEXT NOT NULL,
              email TEXT NOT NULL,
              phone TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              signature_png TEXT NOT NULL,
              parent_signature_png TEXT NOT NULL DEFAULT ''
            )
            """
        )
        conn.execute(
            """
            INSERT INTO waivers (
              id, kind, submitted_at, signed_on, participant_name, signer_name,
              dob, email, phone, payload_json, signature_png
            ) VALUES ('w-old', 'kids', 't', '2026-01-01', 'Old Kid', 'Old Kid', '2019-01-01', 'a@b.co', '5035550100', '{}', 'x')
            """
        )
        conn.commit()
        migrate(conn)
        students = {row[1] for row in conn.execute("PRAGMA table_info(students)")}
        waivers = {row[1] for row in conn.execute("PRAGMA table_info(waivers)")}
        self.assertIn("dob", students)
        self.assertIn("parent_token", students)
        self.assertIn("parent_name", students)
        self.assertIn("parent_email", students)
        self.assertIn("parent_phone", students)
        self.assertIn("added_to_roster", waivers)
        self.assertIn("roster_student_id", waivers)
        row = conn.execute("SELECT added_to_roster, roster_student_id FROM waivers WHERE id = 'w-old'").fetchone()
        self.assertEqual(row["added_to_roster"], 0)
        self.assertEqual(row["roster_student_id"], "")
        tables = {item[0] for item in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        self.assertIn("waitlist", tables)
        conn.close()

    def test_kids_enrollment_cap(self):
        self.api._waiver_posts = []
        guest = self.client()
        status, snap = guest.call("GET", "/api/public/kids-enrollment")
        self.assertEqual(status, 200, snap)
        self.assertEqual(set(snap), {"cap", "enrolled", "spotsOpen", "full", "submissionsEnabled", "waitlistEnabled"})
        self.assertEqual(snap["cap"], 12)
        self.assertTrue(snap["submissionsEnabled"])
        self.assertFalse(snap["waitlistEnabled"])
        self.assertNotIn("Sam", json.dumps(snap))

        teacher = self.client()
        teacher.login("alex", "correct-horse")
        status, denied = teacher.call("PUT", "/api/kids-cap", {"cap": 8})
        self.assertEqual(status, 403, denied)
        self.assertIn("admin", denied["error"].lower())

        admin = self.client()
        admin.login("dakota", "correct-horse")
        status, boot = admin.call("GET", "/api/bootstrap")
        self.assertEqual(status, 200, boot)
        self.assertEqual(boot["kidsEnrollment"]["cap"], 12)
        status, changed = admin.call("PUT", "/api/kids-cap", {"cap": 9})
        self.assertEqual(status, 200, changed)
        self.assertEqual(changed["cap"], 9)
        status, seen = guest.call("GET", "/api/public/kids-enrollment")
        self.assertEqual(seen["cap"], 9)
        self.assertEqual(seen["submissionsEnabled"], True)
        status, bad = admin.call("PUT", "/api/kids-cap", {"cap": 0})
        self.assertEqual(status, 400, bad)
        status, huge = admin.call("PUT", "/api/kids-cap", {"cap": 201})
        self.assertEqual(status, 400, huge)
        status, restored = admin.call("PUT", "/api/kids-cap", {"cap": 12})
        self.assertEqual(restored["cap"], 12)

        base = restored["enrolled"]
        created = []
        status, teen = admin.call("POST", "/api/students", {"name": "Cap Teen", "age": 14, "belt": "white", "stripes": 0})
        self.assertEqual(status, 201, teen)
        self.assertEqual(teen["kidsEnrollment"]["enrolled"], base)
        created.append(teen["id"])

        from datetime import date

        year = date.today().year
        dob = f"{year - 7}-03-03"
        status, matched = admin.call(
            "POST",
            "/api/students",
            {"name": "Cap Match", "age": 7, "belt": "white", "stripes": 0, "dob": dob},
        )
        self.assertEqual(status, 201, matched)
        self.assertEqual(matched["dob"], dob)
        self.assertEqual(matched["kidsEnrollment"]["enrolled"], base + 1)
        created.append(matched["id"])

        self.api.cfg["waiver_submissions_enabled"] = True
        try:
            status, same = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(kind="kids", participantName="Cap Match", dob=dob, parentName="Pat Parent"),
            )
            self.assertEqual(status, 201, same)
            status, still = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(still["enrolled"], base + 1)
            self.assertTrue(still["submissionsEnabled"])

            status, tight = admin.call("PUT", "/api/kids-cap", {"cap": still["enrolled"]})
            self.assertEqual(status, 200, tight)
            self.assertTrue(tight["full"])
            status, again = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="cap  match",
                    email="match-again@example.com",
                    dob=dob,
                    parentName="Pat Parent",
                ),
            )
            self.assertEqual(status, 201, again)
            status, still_full = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(still_full["enrolled"], base + 1)
            status, restored = admin.call("PUT", "/api/kids-cap", {"cap": 12})
            self.assertEqual(restored["cap"], 12)

            status, pending = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Cap Pending",
                    email="pending@example.com",
                    dob=f"{year - 6}-03-03",
                    parentName="Pat Parent",
                ),
            )
            self.assertEqual(status, 201, pending)
            status, plus = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(plus["enrolled"], base + 2)
            status, teacher_mark = teacher.call("POST", f"/api/waivers/{pending['id']}/roster", {})
            self.assertEqual(status, 403, teacher_mark)
            status, marked = admin.call("POST", f"/api/waivers/{pending['id']}/roster", {})
            self.assertEqual(status, 200, marked)
            self.assertTrue(marked["addedToRoster"])
            status, back = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(back["enrolled"], base + 1)

            status, adult = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(participantName="Cap Adult", email="adult-cap@example.com"),
            )
            self.assertEqual(status, 201, adult)
            status, same_count = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(same_count["enrolled"], base + 1)

            status, baby = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Cap Baby",
                    email="baby@example.com",
                    dob=f"{year - 2}-03-03",
                    parentName="Pat Parent",
                ),
            )
            self.assertEqual(status, 201, baby)
            status, still_one = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(still_one["enrolled"], base + 1)

            room = still_one["cap"] - still_one["enrolled"]
            for n in range(room):
                status, kid = admin.call(
                    "POST",
                    "/api/students",
                    {"name": f"Cap Fill {n}", "age": 5, "belt": "white", "stripes": 0},
                )
                self.assertEqual(status, 201, kid)
                created.append(kid["id"])
            status, full = guest.call("GET", "/api/public/kids-enrollment")
            self.assertTrue(full["full"], full)
            self.assertEqual(full["spotsOpen"], 0)
            self.assertEqual(full["enrolled"], full["cap"])

            before_rows = self._waiver_count()
            status, blocked = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Cap Extra",
                    email="extra@example.com",
                    dob=f"{year - 8}-03-03",
                    parentName="Pat Parent",
                ),
            )
            self.assertEqual(status, 409, blocked)
            self.assertTrue(blocked["full"])
            self.assertEqual(blocked["error"], KIDS_FULL)
            self.assertEqual(self._waiver_count(), before_rows)

            status, adult_ok = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(participantName="Cap Adult Two", email="adult2@example.com"),
            )
            self.assertEqual(status, 201, adult_ok)

            status, needs = admin.call(
                "POST",
                "/api/students",
                {"name": "Cap Thirteenth", "age": 6, "belt": "white", "stripes": 0},
            )
            self.assertEqual(status, 409, needs)
            self.assertTrue(needs["needsConfirm"])
            status, absent = admin.call("GET", "/api/bootstrap")
            self.assertFalse(any(row["name"] == "Cap Thirteenth" for row in absent["students"]))
            status, forced = admin.call(
                "POST",
                "/api/students",
                {"name": "Cap Thirteenth", "age": 6, "belt": "white", "stripes": 0, "confirmOverCap": True},
            )
            self.assertEqual(status, 201, forced)
            created.append(forced["id"])
            self.assertGreater(forced["kidsEnrollment"]["enrolled"], forced["kidsEnrollment"]["cap"])

            status, teacher_add = teacher.call(
                "POST",
                "/api/students",
                {"name": "Cap Teacher", "age": 6, "belt": "white", "stripes": 0},
            )
            self.assertEqual(status, 403, teacher_add)

            status, moved = admin.call(
                "PATCH",
                f"/api/students/{teen['id']}",
                {"name": "Cap Teen", "age": 8, "belt": "white", "stripes": 0},
            )
            self.assertEqual(status, 409, moved)
            self.assertTrue(moved["needsConfirm"])
            status, moved_ok = admin.call(
                "PATCH",
                f"/api/students/{teen['id']}",
                {"name": "Cap Teen", "age": 8, "belt": "white", "stripes": 0, "confirmOverCap": True},
            )
            self.assertEqual(status, 200, moved_ok)

            status, blocked_import = admin.call(
                "POST",
                "/api/import",
                {"roster": [{"id": "s-capimport", "name": "Cap Import", "age": 6, "belt": "white", "stripes": 0}]},
            )
            self.assertEqual(status, 409, blocked_import)
            self.assertTrue(blocked_import["needsConfirm"])
            status, missing_import = admin.call("GET", "/api/bootstrap")
            self.assertFalse(any(row["id"] == "s-capimport" for row in missing_import["students"]))
            status, forced_import = admin.call(
                "POST",
                "/api/import",
                {
                    "roster": [{"id": "s-capimport", "name": "Cap Import", "age": 6, "belt": "white", "stripes": 0}],
                    "confirmOverCap": True,
                },
            )
            self.assertEqual(status, 200, forced_import)
            created.append("s-capimport")

            status, before_delete = guest.call("GET", "/api/public/kids-enrollment")
            status, gone = admin.call("DELETE", f"/api/students/{matched['id']}")
            self.assertEqual(status, 200, gone)
            # Both linked forms count again and the roster row is gone, so the total rises by one.
            self.assertEqual(gone["kidsEnrollment"]["enrolled"], before_delete["enrolled"] + 1)

            current = gone["kidsEnrollment"]["enrolled"]
            status, opened = admin.call("PUT", "/api/kids-cap", {"cap": min(200, current + 1)})
            self.assertEqual(status, 200, opened)
            self.assertEqual(opened["spotsOpen"], 1)
            self.api._waiver_posts = []
            results = []

            def post_one(name, email):
                client = self.client()
                code, payload = client.call(
                    "POST",
                    "/api/public/waivers",
                    self.waiver_body(
                        kind="kids",
                        participantName=name,
                        email=email,
                        dob=f"{year - 5}-03-03",
                        parentName="Pat Parent",
                    ),
                )
                results.append((code, name, payload))

            first = threading.Thread(target=post_one, args=("Cap Race A", "race-a@example.com"))
            second = threading.Thread(target=post_one, args=("Cap Race B", "race-b@example.com"))
            first.start()
            second.start()
            first.join(20)
            second.join(20)
            codes = sorted(item[0] for item in results)
            self.assertEqual(codes, [201, 409], results)
            status, after = guest.call("GET", "/api/public/kids-enrollment")
            self.assertEqual(after["enrolled"], current + 1, after)
            self.assertTrue(after["full"])
            self.assertLessEqual(after["enrolled"], after["cap"])
        finally:
            self.api.cfg["waiver_submissions_enabled"] = None
            self.api._waiver_posts = []
            admin.call("PUT", "/api/kids-cap", {"cap": 12})
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")
            conn = connect(self.api.cfg["db_path"])
            conn.execute("DELETE FROM waivers WHERE participant_name LIKE 'Cap %' OR participant_name LIKE 'cap %'")
            conn.execute("DELETE FROM students WHERE name LIKE 'Cap %'")
            conn.execute("DELETE FROM settings WHERE key = 'kids_cap'")
            conn.commit()
            conn.close()


    def _waitlist_count(self):
        conn = connect(self.api.cfg["db_path"])
        try:
            return conn.execute("SELECT COUNT(*) AS n FROM waitlist").fetchone()["n"]
        finally:
            conn.close()

    def test_waitlist_is_admin_only_and_first_come(self):
        self.api._waitlist_posts = []
        self.api.cfg["waitlist_enabled"] = None
        guest = self.client()
        teacher = self.client()
        teacher.login("alex", "correct-horse")
        admin = self.client()
        admin.login("dakota", "correct-horse")
        created = []

        def entry(**overrides):
            body = {
                "parentName": "Pat Parent",
                "email": "wait@example.com",
                "phone": "5035550100",
                "childName": "Casey",
                "age": 5,
                "ageGroup": "mite",
                "confirmAgeGroup": True,
                "note": "",
            }
            body.update(overrides)
            return body

        try:
            status, closed = guest.call("POST", "/api/public/waitlist", entry())
            self.assertEqual(status, 403, closed)
            self.assertEqual(closed["error"], "The waitlist is not open.")
            self.assertEqual(self._waitlist_count(), 0)

            status, denied = teacher.call("GET", "/api/waitlist")
            self.assertEqual(status, 403, denied)
            self.assertEqual(denied["error"], "An admin manages the waitlist.")
            status, denied_csv = teacher.call("GET", "/api/waitlist.csv", raw=True)
            self.assertEqual(status, 403, denied_csv)
            status, denied_post = teacher.call("POST", "/api/waitlist/q-nope/contacted", {})
            self.assertEqual(status, 403, denied_post)
            status, denied_del = teacher.call("DELETE", "/api/waitlist/q-nope")
            self.assertEqual(status, 403, denied_del)

            status, snap = guest.call("GET", "/api/public/kids-enrollment")
            self.assertFalse(snap["waitlistEnabled"])
            self.assertNotIn("waitlistActive", snap)
            self.assertNotIn("Casey", json.dumps(snap))

            self.api.cfg["waitlist_enabled"] = True
            self.api._waitlist_posts = []
            status, before = guest.call("GET", "/api/public/kids-enrollment")
            self.assertTrue(before["waitlistEnabled"])
            if before["full"]:
                admin.call("PUT", "/api/kids-cap", {"cap": min(200, before["enrolled"] + 1)})
            status, open_spot = guest.call("POST", "/api/public/waitlist", entry(childName="Open Spot"))
            self.assertEqual(status, 409, open_spot)
            self.assertEqual(open_spot["error"], "A spot is open right now. Use the enrollment form.")
            self.assertEqual(self._waitlist_count(), 0)

            status, boot = admin.call("GET", "/api/bootstrap")
            enrolled = boot["kidsEnrollment"]["enrolled"]
            if enrolled < 1:
                status, kid = admin.call(
                    "POST",
                    "/api/students",
                    {"name": "Wait Fill", "age": 6, "belt": "white", "stripes": 0},
                )
                self.assertEqual(status, 201, kid)
                created.append(kid["id"])
                enrolled = kid["kidsEnrollment"]["enrolled"]
            status, full = admin.call("PUT", "/api/kids-cap", {"cap": enrolled})
            self.assertTrue(full["full"], full)
            self.assertIn("waitlistActive", full)

            self.api.cfg["waitlist_enabled"] = False
            status, still_closed = guest.call("POST", "/api/public/waitlist", entry(childName="Closed"))
            self.assertEqual(status, 403, still_closed)
            self.assertEqual(self._waitlist_count(), 0)
            self.api.cfg["waitlist_enabled"] = True
            self.api._waitlist_posts = []

            from datetime import date

            year = date.today().year
            status, missing = guest.call("POST", "/api/public/waitlist", {"email": "wait@example.com"})
            self.assertEqual(status, 400, missing)
            status, too_young = guest.call("POST", "/api/public/waitlist", entry(childName="Tiny", age=2, ageGroup="mite"))
            self.assertEqual(status, 400, too_young)
            self.assertIn("3", too_young["error"])
            status, mismatch = guest.call("POST", "/api/public/waitlist", entry(childName="Mismatch", age=5, ageGroup="upper"))
            self.assertEqual(status, 400, mismatch)
            self.assertIn("age group", mismatch["error"])
            status, dob_mismatch = guest.call(
                "POST",
                "/api/public/waitlist",
                entry(childName="Dob", age=8, ageGroup="upper", dob=f"{year - 5}-03-03"),
            )
            self.assertEqual(status, 400, dob_mismatch)
            self.assertIn("do not match", dob_mismatch["error"])
            self.assertEqual(self._waitlist_count(), 0)
            bare = entry(childName="Skip")
            bare.pop("confirmAgeGroup")
            status, unconfirmed = guest.call("POST", "/api/public/waitlist", bare)
            self.assertEqual(status, 400, unconfirmed)
            self.assertIn("Confirm", unconfirmed["error"])
            self.assertEqual(self._waitlist_count(), 0)

            status, first = guest.call(
                "POST",
                "/api/public/waitlist",
                entry(childName="Ada", email="ada@example.com", note="After school"),
            )
            self.assertEqual(status, 201, first)
            self.assertEqual(first["position"], 1)
            status, second = guest.call(
                "POST",
                "/api/public/waitlist",
                entry(childName="Bea", email="bea@example.com", age=8, ageGroup="upper"),
            )
            self.assertEqual(status, 201, second)
            self.assertEqual(second["position"], 1)
            self.assertEqual(second["ageGroup"], "upper")
            status, third = guest.call(
                "POST",
                "/api/public/waitlist",
                entry(childName="Cam", email="cam@example.com", age=4, ageGroup="mite"),
            )
            self.assertEqual(status, 201, third)
            self.assertEqual(third["position"], 2)
            self.assertEqual(third["ageGroup"], "mite")
            status, duplicate = guest.call(
                "POST",
                "/api/public/waitlist",
                entry(childName="  ada ", email="Ada@Example.com"),
            )
            self.assertEqual(status, 409, duplicate)
            self.assertEqual(duplicate["error"], "This child is already on the waitlist.")

            status, listed = admin.call("GET", "/api/waitlist")
            self.assertEqual(status, 200, listed)
            self.assertEqual([row["childName"] for row in listed["entries"]], ["Ada", "Cam", "Bea"])
            self.assertEqual([row["position"] for row in listed["entries"]], [1, 2, 1])
            self.assertEqual([row["childName"] for row in listed["byJoined"]], ["Ada", "Bea", "Cam"])
            self.assertEqual([row["position"] for row in listed["byJoined"]], [1, 1, 2])
            self.assertEqual([group["ageGroup"] for group in listed["groups"]], ["mite", "upper"])
            self.assertEqual([row["childName"] for row in listed["groups"][0]["entries"]], ["Ada", "Cam"])
            self.assertEqual([row["childName"] for row in listed["groups"][1]["entries"]], ["Bea"])
            self.assertEqual(listed["entries"][0]["note"], "After school")
            self.assertEqual(listed["entries"][0]["ageGroup"], "mite")
            self.assertFalse(listed["spotOpen"])

            ada_id = listed["groups"][0]["entries"][0]["id"]
            cam_id = listed["groups"][0]["entries"][1]["id"]
            bea_id = listed["groups"][1]["entries"][0]["id"]
            status, contacted = admin.call("POST", f"/api/waitlist/{ada_id}/contacted", {})
            self.assertEqual(status, 200, contacted)
            self.assertEqual(contacted["entries"][0]["status"], "contacted")
            self.assertEqual(contacted["entries"][0]["position"], 1)
            status, again = admin.call("POST", f"/api/waitlist/{ada_id}/contacted", {})
            self.assertEqual(status, 200, again)
            self.assertEqual(len(again["entries"]), 3)

            status, csv_body = admin.call("GET", "/api/waitlist.csv", raw=True)
            self.assertEqual(status, 200)
            csv_text = csv_body.decode()
            self.assertIn("Ada", csv_text)
            self.assertIn("Bea", csv_text)
            self.assertIn("Cam", csv_text)
            self.assertIn("3–6 Mighty Mites", csv_text)
            self.assertIn("7–10 Pee Wees", csv_text)
            self.assertTrue(csv_text.startswith("position,joined,status,"))
            self.assertIn(",age_group,", csv_text.splitlines()[0])
            joined_lines = [line for line in csv_text.splitlines() if line]
            self.assertEqual([line.split(",")[6] for line in joined_lines[1:]], ["Ada", "Bea", "Cam"])
            self.assertEqual([line.split(",")[0] for line in joined_lines[1:]], ["1", "1", "2"])
            status, mite_csv = admin.call("GET", "/api/waitlist.csv?group=mite", raw=True)
            self.assertEqual(status, 200)
            mite_lines = [line for line in mite_csv.decode().splitlines() if line]
            self.assertEqual([line.split(",")[6] for line in mite_lines[1:]], ["Ada", "Cam"])
            self.assertEqual([line.split(",")[0] for line in mite_lines[1:]], ["1", "2"])
            self.assertNotIn("Bea", mite_csv.decode())
            status, upper_csv = admin.call("GET", "/api/waitlist.csv?group=upper", raw=True)
            self.assertEqual(status, 200)
            upper_lines = [line for line in upper_csv.decode().splitlines() if line]
            self.assertEqual([line.split(",")[6] for line in upper_lines[1:]], ["Bea"])
            self.assertEqual(upper_lines[1].split(",")[0], "1")
            self.assertIn("7–10 Pee Wees", upper_csv.decode())
            status, bad_csv = admin.call("GET", "/api/waitlist.csv?group=nope", raw=True)
            self.assertEqual(status, 400, bad_csv)

            status, wider = admin.call("PUT", "/api/kids-cap", {"cap": min(200, enrolled + 1)})
            self.assertEqual(status, 200, wider)
            self.assertTrue(wider["waitlistSpotOpen"], wider)
            self.assertEqual(wider["waitlistActive"], 3)
            self.assertEqual(wider["waitlistNext"]["mite"]["childName"], "Ada")
            self.assertEqual(wider["waitlistNext"]["upper"]["childName"], "Bea")
            status, admin_boot = admin.call("GET", "/api/bootstrap")
            self.assertEqual(admin_boot["kidsEnrollment"]["waitlistNext"]["mite"]["childName"], "Ada")
            self.assertEqual(admin_boot["kidsEnrollment"]["waitlistNext"]["upper"]["parentName"], "Pat Parent")
            status, staff = teacher.call("GET", "/api/bootstrap")
            self.assertTrue(staff["kidsEnrollment"]["waitlistSpotOpen"])
            self.assertNotIn("waitlistNext", staff["kidsEnrollment"])
            self.assertNotIn("ada@example.com", json.dumps(staff))

            status, enrolled_row = admin.call("POST", f"/api/waitlist/{ada_id}/enrolled", {})
            self.assertEqual(status, 200, enrolled_row)
            self.assertEqual([row["childName"] for row in enrolled_row["groups"][0]["entries"]], ["Cam"])
            self.assertEqual(enrolled_row["groups"][0]["entries"][0]["position"], 1)
            self.assertEqual(enrolled_row["groups"][1]["entries"][0]["childName"], "Bea")
            self.assertEqual(enrolled_row["groups"][1]["entries"][0]["position"], 1)
            self.assertEqual(enrolled_row["waitlistNext"]["mite"]["childName"], "Cam")
            status, stale = admin.call("POST", f"/api/waitlist/{ada_id}/contacted", {})
            self.assertEqual(status, 400, stale)
            self.assertIn("already off", stale["error"])

            status, removed = admin.call("DELETE", f"/api/waitlist/{bea_id}")
            self.assertEqual(status, 200, removed)
            self.assertEqual([row["childName"] for row in removed["entries"]], ["Cam"])
            status, cleared = admin.call("DELETE", f"/api/waitlist/{cam_id}")
            self.assertEqual(status, 200, cleared)
            self.assertEqual(cleared["entries"], [])
            self.assertFalse(cleared["spotOpen"])

            status, backup = admin.call("GET", "/api/export")
            self.assertEqual(status, 200, backup)
            names = {row["childName"] for row in backup["waitlist"]}
            self.assertEqual(names, {"Ada", "Bea", "Cam"})
            self.assertTrue(any(row["status"] == "enrolled" for row in backup["waitlist"]))
            self.assertTrue(any(row["status"] == "removed" for row in backup["waitlist"]))

            status, tight = admin.call("PUT", "/api/kids-cap", {"cap": enrolled})
            self.assertTrue(tight["full"], tight)
            self.api._waitlist_posts = []
            status, rejoined = guest.call("POST", "/api/public/waitlist", entry(childName="Ada", email="ada@example.com"))
            self.assertEqual(status, 201, rejoined)
        finally:
            self.api.cfg["waitlist_enabled"] = None
            self.api.cfg["waiver_submissions_enabled"] = None
            self.api._waitlist_posts = []
            admin.call("PUT", "/api/kids-cap", {"cap": 12})
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")
            conn = connect(self.api.cfg["db_path"])
            conn.execute("DELETE FROM waitlist")
            conn.execute("DELETE FROM students WHERE name = 'Wait Fill'")
            conn.execute("DELETE FROM settings WHERE key = 'kids_cap'")
            conn.commit()
            conn.close()


    def test_adult_tracker_reuses_one_checkin_card(self):
        self.api.cfg["waiver_submissions_enabled"] = True
        admin = self.client()
        admin.login("dakota", "correct-horse")
        teacher = self.client()
        teacher.login("alex", "correct-horse")
        guest = self.client()
        created = []

        def students():
            status, body = admin.call("GET", "/api/bootstrap")
            self.assertEqual(status, 200, body)
            return body

        def named(name):
            return [row for row in students()["students"] if row["name"] == name]

        try:
            status, hidden = guest.call("GET", "/api/bootstrap")
            self.assertEqual(status, 401, hidden)
            status, blocked = guest.call("POST", "/api/adult-progress", {"studentId": "s-nope"})
            self.assertIn(blocked.get("error") if isinstance(blocked, dict) else "", ("Log in first.", "The page needs to be reloaded before saving."))
            self.assertNotEqual(status, 200)
            status, blocked_attend = guest.call("POST", "/api/adult-attendance", {"studentId": "s-nope"})
            self.assertNotEqual(status, 200, blocked_attend)

            before = students()["kidsEnrollment"]["enrolled"]
            status, kid = admin.call(
                "POST",
                "/api/students",
                {"name": "Kid Card One", "age": 7, "belt": "white", "stripes": 0, "dob": "2019-04-04"},
            )
            self.assertEqual(status, 201, kid)
            created.append(kid["id"])
            self.assertEqual(kid["program"], "kids")
            self.assertRegex(kid["id"], r"^s-[0-9a-f]{8}$")
            self.assertGreaterEqual(len(kid["parentToken"]), 20)
            self.assertNotEqual(kid["parentToken"], kid["id"])
            self.assertFalse(kid["pinSet"])
            self.assertNotIn("card_pin_hash", kid)

            status, lookalike = admin.call(
                "POST",
                "/api/students",
                {"name": "Same Person", "age": 12, "belt": "white", "stripes": 0, "dob": "2014-08-08"},
            )
            self.assertEqual(status, 201, lookalike)
            created.append(lookalike["id"])
            self.assertEqual(lookalike["program"], "kids")

            status, adult = admin.call(
                "POST",
                "/api/students",
                {
                    "program": "adult",
                    "name": "Adult Pat",
                    "age": 30,
                    "belt": "white",
                    "stripes": 0,
                    "dob": "1996-03-03",
                },
            )
            self.assertEqual(status, 201, adult)
            created.append(adult["id"])
            self.assertEqual(adult["program"], "adult")
            self.assertGreaterEqual(len(adult["parentToken"]), 20)
            self.assertRegex(adult["id"], r"^s-[0-9a-f]{8}$")
            self.assertFalse(adult["pinSet"])
            after = students()
            self.assertEqual(after["kidsEnrollment"]["enrolled"], before + 1)
            self.assertEqual(len(after["adultCurriculum"]["levels"][0]["classes"]), 23)
            self.assertIn("levels", after["adultCurriculum"])

            status, wrong = teacher.call(
                "POST",
                "/api/adult-progress",
                {
                    "studentId": kid["id"],
                    "levelId": "white-to-blue",
                    "classNumber": 1,
                    "techniqueIndex": 0,
                    "checked": True,
                },
            )
            self.assertEqual(status, 404, wrong)
            level = after["adultCurriculum"]["levels"][0]
            class_one = level["classes"][0]
            for index, _name in enumerate(class_one["techniques"]):
                status, saved = teacher.call(
                    "POST",
                    "/api/adult-progress",
                    {
                        "studentId": adult["id"],
                        "levelId": level["id"],
                        "classNumber": 1,
                        "techniqueIndex": index,
                        "checked": True,
                    },
                )
                self.assertEqual(status, 200, saved)
            status, lowered = teacher.call(
                "POST",
                "/api/adult-progress",
                {
                    "studentId": adult["id"],
                    "levelId": level["id"],
                    "classNumber": 1,
                    "techniqueIndex": 0,
                    "stage": "rolling",
                },
            )
            self.assertEqual(status, 200, lowered)
            self.assertEqual(lowered["adultChecks"][adult["id"]][level["id"]]["1"]["0"], "rolling")
            status, low_card = guest.call(
                "POST",
                "/api/public/parent",
                {"token": adult["parentToken"], "month": 3, "day": 3},
            )
            self.assertEqual(status, 200, low_card)
            self.assertEqual(low_card["progress"]["classesDone"], 0)
            status, restored = teacher.call(
                "POST",
                "/api/adult-progress",
                {
                    "studentId": adult["id"],
                    "levelId": level["id"],
                    "classNumber": 1,
                    "techniqueIndex": 0,
                    "stage": "own",
                },
            )
            self.assertEqual(status, 200, restored)
            self.assertEqual(restored["adultChecks"][adult["id"]][level["id"]]["1"]["0"], "mastered")
            status, partial = teacher.call(
                "POST",
                "/api/adult-progress",
                {
                    "studentId": adult["id"],
                    "levelId": level["id"],
                    "classNumber": 2,
                    "techniqueIndex": 0,
                    "stage": "drilled",
                },
            )
            self.assertEqual(status, 200, partial)
            self.assertEqual(partial["adultChecks"][adult["id"]][level["id"]]["2"]["0"], "drilled")
            status, here = teacher.call(
                "POST",
                "/api/adult-attendance",
                {"date": "2026-10-27", "studentId": adult["id"]},
            )
            self.assertEqual(status, 200, here)
            status, again = teacher.call(
                "POST",
                "/api/adult-attendance",
                {"date": "2026-10-27", "studentId": adult["id"]},
            )
            self.assertEqual(status, 200, again)
            attended = next(row["attended"] for row in again["adultAttendance"] if row["date"] == "2026-10-27")
            self.assertEqual(attended.count(adult["id"]), 1)

            status, opened = guest.call(
                "POST",
                "/api/public/parent",
                {"token": adult["parentToken"], "month": 3, "day": 3},
            )
            self.assertEqual(status, 200, opened)
            self.assertEqual(opened["progress"]["classesDone"], 1)
            self.assertEqual(opened["progress"]["classesTotal"], 23)
            self.assertNotIn("card_pin_hash", opened)
            self.assertNotIn("2468", json.dumps(opened))
            status, kid_card = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": kid["parentToken"], "month": 4, "day": 4},
            )
            self.assertEqual(status, 200, kid_card)
            self.assertNotIn("classesTotal", kid_card["progress"])

            status, kid_on_adult = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    participantName="Adult Pat",
                    email="adult-card-kidtoken@example.com",
                    dob="1996-03-03",
                    parentToken=kid["parentToken"],
                    birthMonth=4,
                    birthDay=4,
                ),
            )
            self.assertEqual(status, 400, kid_on_adult)
            self.assertEqual(kid_on_adult["error"], "Those details don't match.")
            status, adult_on_kids = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    kind="kids",
                    participantName="Kid Card One",
                    email="adult-card-adulttoken@example.com",
                    dob="2019-04-04",
                    parentName="Pat Parent",
                    parentToken=adult["parentToken"],
                    birthMonth=3,
                    birthDay=3,
                ),
            )
            self.assertEqual(status, 400, adult_on_kids)
            self.assertFalse(named("Adult Pat")[0]["waiver"]["signed"])

            status, linked = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    participantName="Adult Pat",
                    email="adult-card-pat@example.com",
                    dob="1996-03-03",
                    pin="2468",
                    parentToken=adult["parentToken"],
                    birthMonth=3,
                    birthDay=3,
                ),
            )
            self.assertEqual(status, 201, linked)
            status, detail = admin.call("GET", "/api/waivers/" + linked["id"])
            self.assertEqual(detail["rosterStudentId"], adult["id"])
            self.assertNotIn("pin", detail["payload"])
            self.assertNotIn("2468", json.dumps(detail["payload"]))
            signed = named("Adult Pat")
            self.assertEqual(len(signed), 1)
            self.assertTrue(signed[0]["pinSet"])
            self.assertTrue(signed[0]["waiver"]["signed"])
            self.assertNotIn("card_pin_hash", signed[0])

            status, month_only = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": adult["parentToken"], "month": 3, "day": 3},
            )
            status, wrong_pin = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": adult["parentToken"], "month": 3, "day": 3, "pin": "0000"},
            )
            self.assertEqual(status, 400, month_only)
            self.assertEqual(wrong_pin["error"], month_only["error"])
            self.assertEqual(month_only["error"], "Those details don't match.")
            status, with_pin = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": adult["parentToken"], "month": 1, "day": 1, "pin": "2468"},
            )
            self.assertEqual(status, 200, with_pin)
            self.assertEqual(with_pin["progress"]["classesDone"], 1)
            self.assertEqual(with_pin["progress"]["classesTotal"], 23)
            self.assertEqual(
                set(with_pin),
                {
                    "firstName",
                    "ageGroup",
                    "belt",
                    "beltLabel",
                    "stripes",
                    "stripesLabel",
                    "signForm",
                    "progress",
                    "waiver",
                },
            )
            self.assertNotIn("2468", json.dumps(with_pin))

            status, collided = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    participantName="Same Person",
                    email="adult-card-same@example.com",
                    dob="2014-08-08",
                    pin="1357",
                    parentName="Pat Parent",
                    parentTypedName="Pat Parent",
                    parentPrintName="Pat Parent",
                    parentSignature=PNG,
                ),
            )
            self.assertEqual(status, 201, collided)
            waiting = named("Same Person")
            self.assertEqual(len(waiting), 1)
            self.assertEqual(waiting[0]["program"], "kids")
            self.assertFalse(waiting[0]["waiver"]["signed"])
            status, review = admin.call("GET", "/api/enrollment-review")
            same_form = next(row for row in review["adults"] if row["id"] == collided["id"])
            self.assertFalse(same_form["linked"])
            status, added_same = admin.call("POST", f"/api/waivers/{collided['id']}/add", {})
            self.assertEqual(status, 201, added_same)
            created.append(added_same["id"])
            rows = named("Same Person")
            self.assertEqual(len(rows), 2)
            kids_row = next(row for row in rows if row["program"] == "kids")
            adult_row = next(row for row in rows if row["program"] == "adult")
            self.assertEqual(adult_row["id"], added_same["id"])
            self.assertFalse(kids_row["waiver"]["signed"])
            self.assertTrue(adult_row["waiver"]["signed"])
            self.assertTrue(adult_row["pinSet"])
            self.assertGreaterEqual(len(adult_row["parentToken"]), 20)
            self.assertEqual(students()["kidsEnrollment"]["enrolled"], before + 1)

            status, teen = guest.call(
                "POST",
                "/api/public/waivers",
                self.waiver_body(
                    participantName="Teen Adult",
                    email="adult-card-teen@example.com",
                    dob="2011-07-07",
                    pin="1357",
                    parentName="Pat Parent",
                    parentTypedName="Pat Parent",
                    parentPrintName="Pat Parent",
                    parentSignature=PNG,
                ),
            )
            self.assertEqual(status, 201, teen)
            self.assertEqual(named("Teen Adult"), [])
            status, added_teen = admin.call("POST", f"/api/waivers/{teen['id']}/add", {})
            self.assertEqual(status, 201, added_teen)
            teen_row = named("Teen Adult")[0]
            created.append(teen_row["id"])
            self.assertEqual(teen_row["program"], "adult")
            self.assertTrue(teen_row["pinSet"])
            self.assertGreaterEqual(len(teen_row["parentToken"]), 20)
            status, teen_month = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": teen_row["parentToken"], "month": 7, "day": 7},
            )
            self.assertEqual(status, 400, teen_month)
            self.assertEqual(teen_month["error"], "Those details don't match.")
            status, teen_pin = self.client().call(
                "POST",
                "/api/public/parent",
                {"token": teen_row["parentToken"], "pin": "1357"},
            )
            self.assertEqual(status, 200, teen_pin)
            self.assertEqual(teen_pin["signForm"], "adult")
            self.assertNotIn("1357", json.dumps(teen_pin))
            self.assertEqual(students()["kidsEnrollment"]["enrolled"], before + 1)
        finally:
            self.api.cfg["waiver_submissions_enabled"] = None
            self.api._waiver_posts = []
            self.api._parent_fails = []
            self.api._parent_grants = {}
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")
            conn = connect(self.api.cfg["db_path"])
            conn.execute("DELETE FROM waivers WHERE email LIKE 'adult-card-%'")
            conn.execute("DELETE FROM adult_classes WHERE date = '2026-10-27'")
            conn.execute("DELETE FROM students WHERE name IN ('Kid Card One', 'Same Person', 'Adult Pat', 'Teen Adult')")
            conn.commit()
            conn.close()

    def test_old_stages_map_onto_the_confirmed_ladder(self):
        folder = tempfile.TemporaryDirectory()
        path = os.path.join(folder.name, "old.db")
        conn = connect(path)
        conn.execute(
            """
            CREATE TABLE adult_progress (
              student_id TEXT NOT NULL,
              level_id TEXT NOT NULL,
              class_number INTEGER NOT NULL,
              technique_index INTEGER NOT NULL,
              checked_at TEXT NOT NULL,
              PRIMARY KEY (student_id, level_id, class_number, technique_index)
            )
            """
        )
        conn.execute(
            """
            INSERT INTO adult_progress (student_id, level_id, class_number, technique_index, checked_at)
            VALUES ('s-old', 'white-to-blue', 3, 1, '2026-01-01')
            """
        )
        conn.commit()
        migrate(conn)
        stage = conn.execute("SELECT stage FROM adult_progress WHERE student_id = 's-old'").fetchone()["stage"]
        self.assertEqual(stage, "mastered")
        conn.execute("INSERT INTO levels (student_id, tech_id, level) VALUES ('s-old', 'ls-a', 'introduced')")
        conn.execute("INSERT INTO levels (student_id, tech_id, level) VALUES ('s-old', 'ls-b', 'practicing')")
        conn.execute("INSERT INTO levels (student_id, tech_id, level) VALUES ('s-old', 'ls-c', 'help')")
        conn.execute("INSERT INTO levels (student_id, tech_id, level) VALUES ('s-old', 'ls-d', 'own')")
        conn.commit()
        migrate(conn)
        got = {
            row["tech_id"]: row["level"]
            for row in conn.execute("SELECT tech_id, level FROM levels WHERE student_id = 's-old'")
        }
        self.assertEqual(
            got,
            {"ls-a": "introduced", "ls-b": "drilled", "ls-c": "rolling", "ls-d": "mastered"},
        )
        conn.close()
        folder.cleanup()

    def test_staff_member_link_migration_does_not_guess(self):
        path = os.path.join(self.tmp.name, "pre-link.db")
        conn = connect(path)
        conn.execute(
            """
            CREATE TABLE users (
              id TEXT PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE students (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              age INTEGER NOT NULL,
              belt TEXT NOT NULL,
              stripes INTEGER NOT NULL,
              created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
            ("u-dakota", "dakota", "hash-dakota", "admin", "2026-01-01T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
            ("u-alex", "alex", "hash-alex", "teacher", "2026-01-01T00:00:00Z"),
        )
        conn.execute(
            "INSERT INTO students (id, name, age, belt, stripes, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            ("s-named", "Dakota", 30, "blue", 2, "2026-01-01T00:00:00Z"),
        )
        conn.commit()
        migrate(conn)
        roles = {row["username"]: row["role"] for row in conn.execute("SELECT username, role, password_hash FROM users")}
        hashes = {row["username"]: row["password_hash"] for row in conn.execute("SELECT username, password_hash FROM users")}
        self.assertEqual(roles["dakota"], "admin")
        self.assertEqual(roles["alex"], "teacher")
        self.assertEqual(hashes["dakota"], "hash-dakota")
        self.assertEqual(conn.execute("SELECT name FROM students WHERE id = 's-named'").fetchone()["name"], "Dakota")
        self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM staff_member_links").fetchone()["n"], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM change_log").fetchone()["n"], 0)
        migrate(conn)
        self.assertEqual(conn.execute("SELECT role FROM users WHERE username = 'dakota'").fetchone()["role"], "admin")
        self.assertEqual(conn.execute("SELECT role FROM users WHERE username = 'alex'").fetchone()["role"], "teacher")
        self.assertEqual(conn.execute("SELECT name, belt, stripes FROM students WHERE id = 's-named'").fetchone()["name"], "Dakota")
        self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM staff_member_links").fetchone()["n"], 0)
        self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM change_log").fetchone()["n"], 0)
        conn.close()

    def test_rank_attendance_self_edit_and_change_log(self):
        admin = self.client()
        status, me = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200, me)
        dakota_id = me["user"]["id"]
        teacher = self.client()
        status, alex = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200, alex)
        alex_id = alex["user"]["id"]
        guest = self.client()
        second = self.client()
        created = []
        second_id = ""
        held_admins = []
        today = date.fromisoformat(today_pacific())
        past = (today - timedelta(days=20)).isoformat()
        qr_day = (today - timedelta(days=6)).isoformat()
        future = (today + timedelta(days=4)).isoformat()

        def user_secrets(username):
            conn = connect(self.api.cfg["db_path"])
            try:
                row = conn.execute(
                    "SELECT id, username, password_hash, role FROM users WHERE username = ?",
                    (username,),
                ).fetchone()
                return dict(row) if row else None
            finally:
                conn.close()

        def log_count(action="", student_id=""):
            conn = connect(self.api.cfg["db_path"])
            try:
                clauses = []
                params = []
                if action:
                    clauses.append("action = ?")
                    params.append(action)
                if student_id:
                    clauses.append("student_id = ?")
                    params.append(student_id)
                sql = "SELECT COUNT(*) AS n FROM change_log"
                if clauses:
                    sql += " WHERE " + " AND ".join(clauses)
                return conn.execute(sql, params).fetchone()["n"]
            finally:
                conn.close()

        try:
            status, hidden = guest.call("POST", "/api/students/s-missing/rank", {"belt": "blue", "stripes": 1})
            self.assertIn(status, (401, 403), hidden)
            self.assertNotEqual(status, 200)

            status, adult = admin.call(
                "POST",
                "/api/students",
                {"program": "adult", "name": "Rank Adult", "age": 30, "belt": "white", "stripes": 0, "dob": "1990-01-15"},
            )
            self.assertEqual(status, 201, adult)
            created.append(adult["id"])
            self.assertIsNone(adult.get("staffLink"))
            status, mate = admin.call(
                "POST",
                "/api/students",
                {"program": "adult", "name": "Rank Mate", "age": 28, "belt": "white", "stripes": 1, "dob": "1998-04-04"},
            )
            self.assertEqual(status, 201, mate)
            created.append(mate["id"])
            status, kid = admin.call(
                "POST",
                "/api/students",
                {
                    "name": "Rank Kid",
                    "age": 8,
                    "belt": "white",
                    "stripes": 0,
                    "dob": "2018-02-02",
                    "confirmOverCap": True,
                },
            )
            self.assertEqual(status, 201, kid)
            created.append(kid["id"])

            status, ranked = teacher.call("POST", f"/api/students/{adult['id']}/rank", {"belt": "blue", "stripes": 3})
            self.assertEqual(status, 200, ranked)
            self.assertEqual(ranked["belt"], "blue")
            self.assertEqual(ranked["stripes"], 3)
            status, grey = teacher.call("POST", f"/api/students/{adult['id']}/rank", {"belt": "grey"})
            self.assertEqual(status, 400, grey)
            self.assertEqual(grey["error"], "Adult belts are white, blue, purple, brown, or black.")
            status, too_many = teacher.call("POST", f"/api/students/{adult['id']}/rank", {"stripes": 9})
            self.assertEqual(status, 400, too_many)
            self.assertEqual(too_many["error"], "Stripes are 0 through 4.")
            status, kid_belt = teacher.call("POST", f"/api/students/{kid['id']}/rank", {"belt": "blue", "stripes": 1})
            self.assertEqual(status, 400, kid_belt)
            self.assertEqual(kid_belt["error"], "That belt is not on the kids list.")
            status, kid_stripes = teacher.call("POST", f"/api/students/{kid['id']}/rank", {"stripes": 2})
            self.assertEqual(status, 200, kid_stripes)
            self.assertEqual(kid_stripes["belt"], "white")
            self.assertEqual(kid_stripes["stripes"], 2)
            status, boot = admin.call("GET", "/api/bootstrap")
            self.assertEqual(status, 200, boot)
            fresh = next(row for row in boot["students"] if row["id"] == adult["id"])
            self.assertEqual(fresh["belt"], "blue")
            self.assertEqual(fresh["stripes"], 3)
            level = boot["adultCurriculum"]["levels"][0]

            status, denied = teacher.call("PUT", f"/api/users/{alex_id}/member", {"studentId": mate["id"]})
            self.assertEqual(status, 403, denied)
            self.assertEqual(denied["error"], "An admin links staff to members.")
            status, guest_link = guest.call("PUT", f"/api/users/{alex_id}/member", {"studentId": mate["id"]})
            self.assertIn(status, (401, 403), guest_link)

            before_alex = user_secrets("alex")
            status, linked_alex = admin.call("PUT", f"/api/users/{alex_id}/member", {"studentId": mate["id"]})
            self.assertEqual(status, 200, linked_alex)
            self.assertEqual(linked_alex["memberStudentId"], mate["id"])
            self.assertEqual(linked_alex["memberName"], "Rank Mate")
            self.assertEqual(linked_alex["role"], "teacher")
            self.assertEqual(linked_alex["username"], "alex")
            after_alex = user_secrets("alex")
            self.assertEqual(after_alex["password_hash"], before_alex["password_hash"])
            self.assertEqual(after_alex["role"], "teacher")
            self.assertEqual(after_alex["username"], "alex")

            status, made = admin.call(
                "POST",
                "/api/users",
                {"username": "linkadmin", "password": "long-enough-2", "role": "admin"},
            )
            self.assertEqual(status, 201, made)
            second_id = made["id"]
            status, second_login = second.login("linkadmin", "long-enough-2")
            self.assertEqual(status, 200, second_login)
            status, users = admin.call("GET", "/api/users")
            self.assertEqual(status, 200, users)
            self.assertFalse(users["soleAdmin"])

            before_dakota = user_secrets("dakota")
            status, own = admin.call("PUT", f"/api/users/{dakota_id}/member", {"studentId": adult["id"]})
            self.assertEqual(status, 403, own)
            self.assertEqual(own["error"], "Another admin has to link your own login.")
            status, own_unlink = admin.call("DELETE", f"/api/users/{dakota_id}/member")
            self.assertEqual(status, 403, own_unlink)
            self.assertEqual(own_unlink["error"], "Another admin has to link your own login.")
            status, linked = second.call("PUT", f"/api/users/{dakota_id}/member", {"studentId": adult["id"]})
            self.assertEqual(status, 200, linked)
            self.assertEqual(linked["memberStudentId"], adult["id"])
            self.assertEqual(linked["username"], "dakota")
            self.assertEqual(linked["role"], "admin")
            after_dakota = user_secrets("dakota")
            self.assertEqual(after_dakota["password_hash"], before_dakota["password_hash"])
            self.assertEqual(after_dakota["role"], "admin")
            link_logs = log_count("staff_link", adult["id"])
            status, again_link = second.call("PUT", f"/api/users/{dakota_id}/member", {"studentId": adult["id"]})
            self.assertEqual(status, 200, again_link)
            self.assertEqual(log_count("staff_link", adult["id"]), link_logs)

            status, extra = admin.call(
                "POST",
                "/api/users",
                {"username": "linkmate", "password": "long-enough-3", "role": "teacher"},
            )
            self.assertEqual(status, 201, extra)
            status, clash_member = second.call("PUT", f"/api/users/{extra['id']}/member", {"studentId": adult["id"]})
            self.assertEqual(status, 400, clash_member)
            self.assertEqual(clash_member["error"], "That member is already linked to a staff login. Unlink it first.")
            status, clash_login = second.call("PUT", f"/api/users/{dakota_id}/member", {"studentId": mate["id"]})
            self.assertEqual(status, 400, clash_login)
            self.assertEqual(clash_login["error"], "That login is already linked to a member. Unlink it first.")
            status, kid_link = second.call("PUT", f"/api/users/{extra['id']}/member", {"studentId": kid["id"]})
            self.assertEqual(status, 400, kid_link)
            self.assertEqual(kid_link["error"], "Link a staff login to an adult roster student.")

            status, self_rank = admin.call("POST", f"/api/students/{adult['id']}/rank", {"belt": "purple", "stripes": 1})
            self.assertEqual(status, 403, self_rank)
            self.assertEqual(self_rank["error"], "Ask another staff member to update your record.")
            status, self_attend = admin.call(
                "POST",
                f"/api/students/{adult['id']}/attendance",
                {"date": past, "present": True},
            )
            self.assertEqual(status, 403, self_attend)
            self.assertEqual(self_attend["error"], "Ask another staff member to update your record.")
            status, self_stage = admin.call(
                "POST",
                "/api/adult-progress",
                {
                    "studentId": adult["id"],
                    "levelId": level["id"],
                    "classNumber": 1,
                    "techniqueIndex": 0,
                    "stage": "drilled",
                },
            )
            self.assertEqual(status, 403, self_stage)
            self.assertEqual(self_stage["error"], "Ask another staff member to update your record.")
            status, teacher_self = teacher.call("POST", f"/api/students/{mate['id']}/rank", {"stripes": 4})
            self.assertEqual(status, 403, teacher_self)
            self.assertEqual(teacher_self["error"], "Ask another staff member to update your record.")

            status, edited = teacher.call("POST", f"/api/students/{adult['id']}/rank", {"belt": "purple", "stripes": 1})
            self.assertEqual(status, 200, edited)
            self.assertEqual(edited["belt"], "purple")
            self.assertEqual(edited["stripes"], 1)
            self.assertEqual(edited["staffLink"]["userId"], dakota_id)
            status, stage = admin.call(
                "POST",
                "/api/adult-progress",
                {
                    "studentId": mate["id"],
                    "levelId": level["id"],
                    "classNumber": 1,
                    "techniqueIndex": 0,
                    "stage": "drilled",
                },
            )
            self.assertEqual(status, 200, stage)
            stage_logs = log_count("stage", mate["id"])
            self.assertGreaterEqual(stage_logs, 1)
            status, stage_again = admin.call(
                "POST",
                "/api/adult-progress",
                {
                    "studentId": mate["id"],
                    "levelId": level["id"],
                    "classNumber": 1,
                    "techniqueIndex": 0,
                    "stage": "drilled",
                },
            )
            self.assertEqual(status, 200, stage_again)
            self.assertEqual(log_count("stage", mate["id"]), stage_logs)

            status, card_before = guest.call(
                "POST",
                "/api/public/parent",
                {"token": mate["parentToken"], "month": 4, "day": 4},
            )
            self.assertEqual(status, 200, card_before)
            self.assertNotIn("staffLink", card_before)
            self.assertNotIn("alex", json.dumps(card_before).lower())
            before_classes = card_before["progress"]["classes"]
            add_logs = log_count("attendance_add", mate["id"])
            status, added = admin.call(
                "POST",
                f"/api/students/{mate['id']}/attendance",
                {"date": past, "present": True},
            )
            self.assertEqual(status, 200, added)
            self.assertIn(past, added["dates"])
            self.assertEqual(log_count("attendance_add", mate["id"]), add_logs + 1)
            status, added_again = admin.call(
                "POST",
                f"/api/students/{mate['id']}/attendance",
                {"date": past, "present": True},
            )
            self.assertEqual(status, 200, added_again)
            self.assertEqual(log_count("attendance_add", mate["id"]), add_logs + 1)
            status, card_after = guest.call(
                "POST",
                "/api/public/parent",
                {"token": mate["parentToken"], "month": 4, "day": 4},
            )
            self.assertEqual(card_after["progress"]["classes"], before_classes + 1)
            self.assertIn(past, card_after["progress"]["recentAttendance"])
            status, not_yet = admin.call(
                "POST",
                f"/api/students/{mate['id']}/attendance",
                {"date": future, "present": True},
            )
            self.assertEqual(status, 400, not_yet)
            self.assertEqual(not_yet["error"], "Choose a class date that is today or earlier.")
            status, removed = admin.call(
                "POST",
                f"/api/students/{mate['id']}/attendance",
                {"date": past, "present": False},
            )
            self.assertEqual(status, 200, removed)
            self.assertNotIn(past, removed["dates"])
            self.assertGreaterEqual(log_count("attendance_remove", mate["id"]), 1)
            status, card_back = guest.call(
                "POST",
                "/api/public/parent",
                {"token": mate["parentToken"], "month": 4, "day": 4},
            )
            self.assertEqual(card_back["progress"]["classes"], before_classes)

            qr_logs = log_count("attendance_add", mate["id"])
            status, scanned = teacher.call(
                "POST",
                "/api/adult-attendance",
                {"date": qr_day, "studentId": mate["id"]},
            )
            self.assertEqual(status, 200, scanned)
            attended = next(row["attended"] for row in scanned["adultAttendance"] if row["date"] == qr_day)
            self.assertIn(mate["id"], attended)
            self.assertEqual(log_count("attendance_add", mate["id"]), qr_logs)

            status, kid_added = teacher.call(
                "POST",
                f"/api/students/{kid['id']}/attendance",
                {"date": past, "present": True},
            )
            self.assertEqual(status, 200, kid_added)
            self.assertIn(past, kid_added["dates"])
            saved_class = next(row for row in kid_added["classes"] if row["date"] == past and kid["id"] in row["attended"])
            self.assertTrue(saved_class["taught"])
            self.assertEqual(saved_class["ageGroup"], "upper")
            status, kid_card = guest.call(
                "POST",
                "/api/public/parent",
                {"token": kid["parentToken"], "month": 2, "day": 2},
            )
            self.assertEqual(status, 200, kid_card)
            self.assertGreaterEqual(kid_card["progress"]["classes"], 1)
            status, kid_removed = teacher.call(
                "POST",
                f"/api/students/{kid['id']}/attendance",
                {"date": past, "present": False},
            )
            self.assertEqual(status, 200, kid_removed)
            self.assertNotIn(past, kid_removed["dates"])
            self.assertTrue(all(kid["id"] not in row["attended"] for row in kid_removed["classes"]))

            status, adult_card = guest.call(
                "POST",
                "/api/public/parent",
                {"token": adult["parentToken"], "month": 1, "day": 15},
            )
            self.assertEqual(status, 200, adult_card)
            dumped = json.dumps(adult_card)
            self.assertNotIn("staffLink", adult_card)
            self.assertNotIn("dakota", dumped.lower())
            self.assertNotIn("staff", dumped.lower())

            status, teacher_log = teacher.call("GET", "/api/change-log")
            self.assertEqual(status, 403, teacher_log)
            self.assertEqual(teacher_log["error"], "An admin reads the change log.")
            status, guest_log = guest.call("GET", "/api/change-log")
            self.assertEqual(status, 401, guest_log)
            self.assertEqual(guest_log["error"], "Log in first.")
            rows_before = log_count()
            status, blocked_write = admin.call("POST", "/api/change-log", {"action": "belt"})
            self.assertEqual(status, 404, blocked_write)
            status, blocked_delete = admin.call("DELETE", "/api/change-log")
            self.assertEqual(status, 404, blocked_delete)
            self.assertEqual(log_count(), rows_before)

            status, log = admin.call("GET", "/api/change-log")
            self.assertEqual(status, 200, log)
            entries = log["entries"]
            self.assertGreaterEqual(len(entries), 4)
            ids = [entry["id"] for entry in entries]
            self.assertEqual(ids, sorted(ids, reverse=True))
            self.assertTrue(entries[0]["at"].endswith("Z"))
            self.assertIn("PT", entries[0]["atPt"])
            actions = {entry["action"] for entry in entries if entry["studentId"] in (adult["id"], mate["id"], kid["id"])}
            self.assertTrue({"belt", "stripes", "attendance_add", "attendance_remove", "stage", "staff_link"} <= actions)
            belt_row = next(entry for entry in entries if entry["action"] == "belt" and entry["studentId"] == adult["id"] and entry["after"]["belt"] == "purple")
            self.assertEqual(belt_row["before"]["belt"], "blue")
            self.assertEqual(belt_row["actorId"], alex_id)
            status, filtered = admin.call("GET", f"/api/change-log?studentId={adult['id']}")
            self.assertEqual(status, 200, filtered)
            self.assertTrue(filtered["entries"])
            self.assertTrue(all(entry["studentId"] == adult["id"] for entry in filtered["entries"]))
            status, by_actor = admin.call("GET", f"/api/change-log?actorId={alex_id}")
            self.assertEqual(status, 200, by_actor)
            self.assertTrue(by_actor["entries"])
            self.assertTrue(all(entry["actorId"] == alex_id for entry in by_actor["entries"]))

            status, unlinked_mate = admin.call("DELETE", f"/api/users/{alex_id}/member")
            self.assertEqual(status, 200, unlinked_mate)
            self.assertEqual(unlinked_mate["memberStudentId"], "")
            status, unlinked_dakota = second.call("DELETE", f"/api/users/{dakota_id}/member")
            self.assertEqual(status, 200, unlinked_dakota)
            self.assertEqual(unlinked_dakota["memberStudentId"], "")
            status, gone = admin.call("DELETE", f"/api/users/{second_id}")
            self.assertEqual(status, 200, gone)
            second_id = ""

            conn = connect(self.api.cfg["db_path"])
            try:
                extra = conn.execute(
                    "SELECT id, role FROM users WHERE role = 'admin' AND username != 'dakota'"
                ).fetchall()
                held_admins.extend((row["id"], row["role"]) for row in extra)
                if extra:
                    conn.execute("UPDATE users SET role = 'teacher' WHERE role = 'admin' AND username != 'dakota'")
                    conn.commit()
            finally:
                conn.close()
            status, users = admin.call("GET", "/api/users")
            self.assertEqual(status, 200, users)
            self.assertTrue(users["soleAdmin"])
            status, sole = admin.call("PUT", f"/api/users/{dakota_id}/member", {"studentId": adult["id"]})
            self.assertEqual(status, 200, sole)
            self.assertEqual(sole["memberStudentId"], adult["id"])
            status, sole_log = admin.call("GET", f"/api/change-log?studentId={adult['id']}&actorId={dakota_id}")
            self.assertEqual(status, 200, sole_log)
            sole_row = next(entry for entry in sole_log["entries"] if entry["action"] == "staff_link" and entry["after"].get("soleAdmin") is True)
            self.assertEqual(sole_row["actorId"], dakota_id)
            self.assertEqual(sole_row["studentName"], "Rank Adult")
            self.assertTrue(sole_row["at"].endswith("Z"))
            self.assertIn("PT", sole_row["atPt"])
            status, still_blocked = admin.call("POST", f"/api/students/{adult['id']}/rank", {"stripes": 0})
            self.assertEqual(status, 403, still_blocked)
            self.assertEqual(still_blocked["error"], "Ask another staff member to update your record.")
            status, sole_off = admin.call("DELETE", f"/api/users/{dakota_id}/member")
            self.assertEqual(status, 200, sole_off)
            self.assertEqual(sole_off["memberStudentId"], "")
        finally:
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")
            if second_id:
                admin.call("DELETE", f"/api/users/{second_id}")
            conn = connect(self.api.cfg["db_path"])
            try:
                if dakota_id:
                    conn.execute("DELETE FROM staff_member_links WHERE user_id = ?", (dakota_id,))
                if alex_id:
                    conn.execute("DELETE FROM staff_member_links WHERE user_id = ?", (alex_id,))
                if created:
                    marks = ",".join("?" for _ in created)
                    conn.execute(f"DELETE FROM staff_member_links WHERE student_id IN ({marks})", created)
                    conn.execute(f"DELETE FROM students WHERE id IN ({marks})", created)
                    conn.execute(f"DELETE FROM levels WHERE student_id IN ({marks})", created)
                    conn.execute(f"DELETE FROM notes WHERE student_id IN ({marks})", created)
                    conn.execute(f"DELETE FROM adult_progress WHERE student_id IN ({marks})", created)
                conn.execute("DELETE FROM users WHERE username IN ('linkadmin', 'linkmate')")
                conn.execute("DELETE FROM staff WHERE name IN ('linkadmin', 'linkmate')")
                conn.execute(
                    "DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)"
                )
                for uid, role in held_admins:
                    conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, uid))
                for table, column in (("classes", "attended"), ("adult_classes", "attended")):
                    rows = conn.execute(f"SELECT id, {column} FROM {table} WHERE date IN (?, ?)", (past, qr_day)).fetchall()
                    for row in rows:
                        attended = json.loads(row[column] or "[]")
                        kept = [item for item in attended if item not in created]
                        if kept != attended:
                            conn.execute(
                                f"UPDATE {table} SET {column} = ? WHERE id = ?",
                                (json.dumps(kept), row["id"]),
                            )
                conn.commit()
            finally:
                conn.close()


    def test_rename_kid_keeps_record_and_logs(self):
        admin = self.client()
        status, me = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200, me)
        teacher = self.client()
        status, alex = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200, alex)
        alex_id = alex["user"]["id"]
        guest = self.client()
        status, csrf = guest.call("GET", "/api/auth/csrf")
        self.assertEqual(status, 200, csrf)
        past = (date.fromisoformat(today_pacific()) - timedelta(days=3)).isoformat()
        kid_id = ""
        adult_id = ""
        try:
            status, kid = admin.call(
                "POST",
                "/api/students",
                {
                    "name": "Rename Kid",
                    "age": 8,
                    "belt": "white",
                    "stripes": 1,
                    "dob": "2018-03-09",
                    "confirmOverCap": True,
                },
            )
            self.assertEqual(status, 201, kid)
            kid_id = kid["id"]
            token = kid["parentToken"]
            status, adult = admin.call(
                "POST",
                "/api/students",
                {"program": "adult", "name": "Rename Adult", "age": 30, "belt": "white", "stripes": 0, "dob": "1990-01-15"},
            )
            self.assertEqual(status, 201, adult)
            adult_id = adult["id"]
            status, stripes = teacher.call("POST", f"/api/students/{kid_id}/rank", {"stripes": 2})
            self.assertEqual(status, 200, stripes)
            self.assertEqual(stripes["stripes"], 2)
            status, attended = teacher.call(
                "POST",
                f"/api/students/{kid_id}/attendance",
                {"date": past, "present": True},
            )
            self.assertEqual(status, 200, attended)
            self.assertIn(past, attended["dates"])
            conn = connect(self.api.cfg["db_path"])
            try:
                conn.execute(
                    """
                    INSERT INTO waivers (
                      id, kind, submitted_at, signed_on, participant_name, signer_name,
                      dob, email, phone, payload_json, signature_png, parent_signature_png,
                      added_to_roster, roster_student_id
                    ) VALUES (?, 'kids', ?, '2026-01-15', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                    """,
                    (
                        "w-rename-kid",
                        iso(utcnow()),
                        "Rename Kid",
                        "Parent Signer",
                        "2018-03-09",
                        "rename@example.com",
                        "555-0100",
                        json.dumps({
                            "injuries": "EXAMPLE-NOTE",
                            "emergencyName": "Emergency Pat",
                            "emergencyPhone": "555-0199",
                        }),
                        PNG,
                        PNG,
                        kid_id,
                    ),
                )
                conn.execute(
                    "INSERT INTO levels (student_id, tech_id, level) VALUES (?, 'ls-upa', 'drilled')",
                    (kid_id,),
                )
                conn.commit()
            finally:
                conn.close()

            status, hidden = guest.call("POST", f"/api/students/{kid_id}/name", {"name": "Nope"})
            self.assertEqual(status, 403, hidden)
            self.assertEqual(hidden["error"], "The page needs to be reloaded before saving.")
            status, missing = teacher.call("POST", "/api/students/s-missing/name", {"name": "Nope"})
            self.assertEqual(status, 404, missing)
            self.assertEqual(missing["error"], "That student is not on the roster.")
            status, blank = teacher.call("POST", f"/api/students/{kid_id}/name", {"name": "   "})
            self.assertEqual(status, 400, blank)
            self.assertEqual(blank["error"], "Add the student's name.")
            status, grown = teacher.call("POST", f"/api/students/{adult_id}/name", {"name": "Other Adult"})
            self.assertEqual(status, 400, grown)
            self.assertEqual(grown["error"], "That name edit is for a kids student.")
            status, patched = teacher.call("PATCH", f"/api/students/{kid_id}", {"name": "Patched", "age": 8})
            self.assertEqual(status, 403, patched)
            self.assertEqual(patched["error"], "An admin edits the roster.")

            conn = connect(self.api.cfg["db_path"])
            try:
                conn.execute(
                    "INSERT INTO staff_member_links (user_id, student_id) VALUES (?, ?)",
                    (alex_id, kid_id),
                )
                conn.commit()
            finally:
                conn.close()
            status, own = teacher.call("POST", f"/api/students/{kid_id}/name", {"name": "Own Kid"})
            self.assertEqual(status, 403, own)
            self.assertEqual(own["error"], "Ask another staff member to update your record.")
            conn = connect(self.api.cfg["db_path"])
            try:
                conn.execute("DELETE FROM staff_member_links WHERE student_id = ?", (kid_id,))
                conn.commit()
                rename_logs = conn.execute(
                    "SELECT COUNT(*) AS n FROM change_log WHERE student_id = ? AND action = 'rename'",
                    (kid_id,),
                ).fetchone()["n"]
            finally:
                conn.close()

            status, same = teacher.call("POST", f"/api/students/{kid_id}/name", {"name": "  Rename Kid  "})
            self.assertEqual(status, 200, same)
            self.assertEqual(same["name"], "Rename Kid")
            self.assertEqual(same["id"], kid_id)
            conn = connect(self.api.cfg["db_path"])
            try:
                self.assertEqual(
                    conn.execute(
                        "SELECT COUNT(*) AS n FROM change_log WHERE student_id = ? AND action = 'rename'",
                        (kid_id,),
                    ).fetchone()["n"],
                    rename_logs,
                )
            finally:
                conn.close()

            wanted = ("  " + ("Bright " * 12)).strip()[:40]
            status, renamed = teacher.call("POST", f"/api/students/{kid_id}/name", {"name": "  " + ("Bright " * 12)})
            self.assertEqual(status, 200, renamed)
            self.assertEqual(renamed["name"], wanted)
            self.assertEqual(renamed["id"], kid_id)
            self.assertEqual(renamed["age"], 8)
            self.assertEqual(renamed["belt"], "white")
            self.assertEqual(renamed["stripes"], 2)
            self.assertEqual(renamed["parentToken"], token)
            self.assertEqual(renamed["dob"], "2018-03-09")
            self.assertEqual(renamed["waiver"]["waiverId"], "w-rename-kid")
            self.assertTrue(renamed["waiver"]["signed"])
            self.assertIsNone(renamed["staffLink"])

            status, detail = teacher.call("GET", "/api/waivers/w-rename-kid")
            self.assertEqual(status, 200, detail)
            self.assertEqual(detail["participantName"], "Rename Kid")
            self.assertEqual(detail["signerName"], "Parent Signer")
            self.assertEqual(detail["payload"]["injuries"], "EXAMPLE-NOTE")
            self.assertEqual(detail["rosterStudentId"], kid_id)

            status, boot = teacher.call("GET", "/api/bootstrap")
            self.assertEqual(status, 200, boot)
            fresh = next(row for row in boot["students"] if row["id"] == kid_id)
            self.assertEqual(fresh["name"], wanted)
            self.assertEqual(fresh["stripes"], 2)
            self.assertEqual(boot["levels"][kid_id]["ls-upa"], "drilled")
            self.assertTrue(any(past == row["date"] and kid_id in row["attended"] for row in boot["classes"]))

            status, log = admin.call("GET", f"/api/change-log?studentId={kid_id}")
            self.assertEqual(status, 200, log)
            renames = [row for row in log["entries"] if row["action"] == "rename"]
            self.assertEqual(len(renames), 1)
            self.assertEqual(renames[0]["before"], {"name": "Rename Kid"})
            self.assertEqual(renames[0]["after"], {"name": wanted})
            self.assertEqual(renames[0]["actorId"], alex_id)
            self.assertEqual(renames[0]["studentId"], kid_id)
            self.assertEqual(renames[0]["studentName"], wanted)
            self.assertTrue(str(renames[0]["atPt"]).endswith("PT"))
            status, denied = teacher.call("GET", "/api/change-log")
            self.assertEqual(status, 403, denied)
            self.assertEqual(denied["error"], "An admin reads the change log.")

            parent = self.client()
            status, profile = parent.call(
                "POST",
                "/api/public/parent",
                {"token": token, "month": 3, "day": 9},
            )
            self.assertEqual(status, 200, profile)
            self.assertEqual(profile["firstName"], wanted.split()[0])
            self.assertEqual(profile["stripes"], 2)
            self.assertNotIn("EXAMPLE-NOTE", json.dumps(profile))
            self.assertNotIn("staffLink", profile)
            self.assertNotIn("parentToken", profile)
        finally:
            if kid_id:
                admin.call("DELETE", f"/api/students/{kid_id}")
            if adult_id:
                admin.call("DELETE", f"/api/students/{adult_id}")
            conn = connect(self.api.cfg["db_path"])
            try:
                conn.execute("DELETE FROM waivers WHERE id = 'w-rename-kid'")
                if kid_id:
                    conn.execute("DELETE FROM levels WHERE student_id = ?", (kid_id,))
                    conn.execute("DELETE FROM staff_member_links WHERE student_id = ?", (kid_id,))
                    conn.execute("DELETE FROM change_log WHERE student_id = ?", (kid_id,))
                    conn.execute("DELETE FROM classes WHERE attended = ?", (json.dumps([kid_id]),))
                conn.commit()
            finally:
                conn.close()

    def test_checkin_undo_writes_the_change_log(self):
        admin = self.client()
        status, _me = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200)
        teacher = self.client()
        status, alex = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200, alex)
        guest = self.client()
        past = (date.fromisoformat(today_pacific()) - timedelta(days=2)).isoformat()
        kid_id = ""
        adult_id = ""
        try:
            status, kid = admin.call(
                "POST",
                "/api/students",
                {"name": "Station Kid", "age": 8, "belt": "white", "stripes": 1, "dob": "2018-04-04", "confirmOverCap": True},
            )
            self.assertEqual(status, 201, kid)
            kid_id = kid["id"]
            status, adult = admin.call(
                "POST",
                "/api/students",
                {"program": "adult", "name": "Station Adult", "age": 30, "belt": "blue", "stripes": 2, "dob": "1992-05-05"},
            )
            self.assertEqual(status, 201, adult)
            adult_id = adult["id"]
            status, hidden = guest.call("POST", f"/api/students/{kid_id}/attendance", {"date": past, "present": True})
            self.assertEqual(status, 403, hidden)
            status, added = teacher.call(
                "POST",
                f"/api/students/{kid_id}/attendance",
                {"date": past, "present": True},
            )
            self.assertEqual(status, 200, added)
            self.assertIn(past, added["dates"])
            status, adult_in = teacher.call("POST", "/api/adult-attendance", {"date": past, "studentId": adult_id})
            self.assertEqual(status, 200, adult_in)
            self.assertTrue(any(row["date"] == past and adult_id in row["attended"] for row in adult_in["adultAttendance"]))
            status, again = teacher.call("POST", "/api/adult-attendance", {"date": past, "studentId": adult_id})
            self.assertEqual(status, 200, again)
            status, removed = teacher.call(
                "POST",
                f"/api/students/{kid_id}/attendance",
                {"date": past, "present": False},
            )
            self.assertEqual(status, 200, removed)
            self.assertNotIn(past, removed["dates"])
            status, log = admin.call("GET", f"/api/change-log?studentId={kid_id}")
            self.assertEqual(status, 200, log)
            actions = [row["action"] for row in log["entries"]]
            self.assertIn("attendance_add", actions)
            self.assertIn("attendance_remove", actions)
            undo = next(row for row in log["entries"] if row["action"] == "attendance_remove")
            self.assertEqual(undo["before"]["date"], past)
            self.assertEqual(undo["after"]["present"], False)
            self.assertEqual(undo["actorId"], alex["user"]["id"])
            status, denied = teacher.call("GET", "/api/change-log")
            self.assertEqual(status, 403, denied)
        finally:
            if kid_id:
                admin.call("DELETE", f"/api/students/{kid_id}")
            if adult_id:
                admin.call("DELETE", f"/api/students/{adult_id}")
            conn = connect(self.api.cfg["db_path"])
            try:
                if kid_id:
                    conn.execute("DELETE FROM change_log WHERE student_id = ?", (kid_id,))
                conn.execute("DELETE FROM classes WHERE date = ?", (past,))
                if adult_id:
                    conn.execute("DELETE FROM change_log WHERE student_id = ?", (adult_id,))
                    rows = conn.execute("SELECT id, attended FROM adult_classes WHERE date = ?", (past,)).fetchall()
                    for row in rows:
                        attended = json.loads(row["attended"] or "[]")
                        kept = [item for item in attended if item != adult_id]
                        conn.execute("UPDATE adult_classes SET attended = ? WHERE id = ?", (json.dumps(kept), row["id"]))
                conn.commit()
            finally:
                conn.close()


    def test_review_skip_off_script_and_change_log(self):
        admin = self.client()
        status, me = admin.login("dakota", "correct-horse")
        self.assertEqual(status, 200, me)
        teacher = self.client()
        status, alex = teacher.login("alex", "correct-horse")
        self.assertEqual(status, 200, alex)
        alex_id = alex["user"]["id"]
        status, kid = admin.call(
            "POST",
            "/api/students",
            {"name": "Review Kid", "age": 6, "belt": "white", "stripes": 0},
        )
        self.assertEqual(status, 201, kid)
        status, adult = admin.call(
            "POST",
            "/api/students",
            {"name": "Linked Coach", "age": 30, "belt": "blue", "stripes": 0, "program": "adult"},
        )
        self.assertEqual(status, 201, adult)
        created = [kid["id"], adult["id"]]
        class_ids = []
        try:
            status, linked = admin.call("PUT", f"/api/users/{alex_id}/member", {"studentId": adult["id"]})
            self.assertEqual(status, 200, linked)
            status, blocked = teacher.call(
                "PUT",
                "/api/levels",
                {"studentId": adult["id"], "techId": "ls-upa", "level": "introduced"},
            )
            self.assertEqual(status, 403, blocked)
            self.assertIn("another staff member", blocked["error"].lower())

            tech = {"id": "ls-upa", "name": "Upa", "position": "Guard", "theme": "guard"}
            status, missing = teacher.call(
                "PUT",
                "/api/classes",
                {
                    "date": "2026-10-13",
                    "ageGroup": "mite",
                    "theme": "guard",
                    "themeLabel": "Guard",
                    "techniques": [{**tech, "skipped": True, "skipReason": "other", "skipNote": ""}],
                    "attended": [kid["id"]],
                    "taught": True,
                },
            )
            self.assertEqual(status, 400, missing)
            self.assertIn("note", missing["error"].lower())

            status, saved = teacher.call(
                "PUT",
                "/api/classes",
                {
                    "date": "2026-10-13",
                    "ageGroup": "mite",
                    "theme": "guard",
                    "themeLabel": "Guard",
                    "techniques": [
                        {**tech, "skipped": True, "skipReason": "time"},
                        {
                            "id": "off-shrimp",
                            "name": "Shrimp",
                            "position": "",
                            "theme": "",
                            "offScript": True,
                            "note": "They asked",
                        },
                    ],
                    "attended": [kid["id"]],
                    "taught": True,
                    "game": "",
                },
            )
            self.assertEqual(status, 200, saved)
            class_ids.append(saved["id"])
            skipped = next(item for item in saved["techniques"] if item["id"] == "ls-upa")
            self.assertTrue(skipped["skipped"])
            self.assertEqual(skipped["skipReason"], "time")
            self.assertNotIn("skipNote", skipped)
            off = next(item for item in saved["techniques"] if item.get("offScript"))
            self.assertEqual(off["name"], "Shrimp")
            self.assertEqual(off["note"], "They asked")

            status, bad = teacher.call(
                "PUT",
                "/api/classes",
                {
                    "date": "2026-10-14",
                    "ageGroup": "mite",
                    "techniques": [{**tech, "skipped": True, "skipReason": "nope"}],
                    "attended": [],
                    "taught": True,
                },
            )
            self.assertEqual(status, 200, bad)
            class_ids.append(bad["id"])
            plain = bad["techniques"][0]
            self.assertNotIn("skipped", plain)

            status, level = teacher.call(
                "PUT",
                "/api/levels",
                {"studentId": kid["id"], "techId": "ls-upa", "level": "introduced"},
            )
            self.assertEqual(status, 200, level)

            status, again = teacher.call(
                "PUT",
                "/api/classes",
                {
                    "date": "2026-10-13",
                    "ageGroup": "mite",
                    "theme": "guard",
                    "themeLabel": "Guard",
                    "techniques": saved["techniques"],
                    "attended": [kid["id"]],
                    "taught": True,
                },
            )
            self.assertEqual(status, 200, again)

            status, log = admin.call("GET", "/api/change-log")
            self.assertEqual(status, 200, log)
            reviews = [entry for entry in log["entries"] if entry["action"] == "class_review"]
            self.assertEqual(len(reviews), 1)
            self.assertEqual(reviews[0]["studentId"], "")
            self.assertIn("Ran out of time", json.dumps(reviews[0]["after"]))
            self.assertIn("Shrimp", json.dumps(reviews[0]["after"]))
            self.assertIn("Mighty Mites", reviews[0]["studentName"])

            status, boot = teacher.call("GET", "/api/bootstrap")
            self.assertEqual(status, 200, boot)
            row = next(entry for entry in boot["classes"] if entry["date"] == "2026-10-13")
            self.assertTrue(any(item.get("skipped") and item["id"] == "ls-upa" for item in row["techniques"]))
            self.assertEqual(boot["levels"][kid["id"]]["ls-upa"], "introduced")

            status, cleared = teacher.call(
                "PUT",
                "/api/classes",
                {
                    "date": "2026-10-13",
                    "ageGroup": "mite",
                    "theme": "guard",
                    "themeLabel": "Guard",
                    "techniques": [tech],
                    "attended": [kid["id"]],
                    "taught": True,
                },
            )
            self.assertEqual(status, 200, cleared)
            self.assertNotIn("skipped", cleared["techniques"][0])
            self.assertFalse(any(item.get("offScript") for item in cleared["techniques"]))
            status, log_again = admin.call("GET", "/api/change-log")
            undone = [
                entry
                for entry in log_again["entries"]
                if entry["action"] == "class_review" and entry["after"].get("date") == "2026-10-13"
            ]
            self.assertGreaterEqual(len(undone), 1)
            self.assertEqual(undone[0]["after"]["skipped"], [])
            self.assertEqual(undone[0]["after"]["offScript"], [])
        finally:
            admin.call("DELETE", f"/api/users/{alex_id}/member")
            for class_id in class_ids:
                admin.call("DELETE", f"/api/classes/{class_id}")
            for sid in created:
                admin.call("DELETE", f"/api/students/{sid}")
            conn = connect(self.api.cfg["db_path"])
            try:
                conn.execute("DELETE FROM change_log WHERE action = 'class_review'")
                conn.execute("DELETE FROM change_log WHERE student_id = ?", (adult["id"],))
                conn.execute("DELETE FROM change_log WHERE student_id = ?", (kid["id"],))
                conn.commit()
            finally:
                conn.close()


class DemoIsolationTest(unittest.TestCase):
    def test_demo_cookie_is_not_the_production_cookie(self):
        obj = Api.__new__(Api)
        obj.cfg = {"cookie_name": "bjj_demo_session", "cookie_path": "/demo", "secure": True}
        baked = obj.cookie("token-value", 60)
        self.assertIn("bjj_demo_session=token-value", baked)
        self.assertIn("Path=/demo", baked)
        self.assertNotIn("Path=/", baked.replace("Path=/demo", ""))
        obj.cfg = {"cookie_name": "bad name", "cookie_path": "https://evil.example", "secure": False}
        fallback = obj.cookie("token-value", 60)
        self.assertTrue(fallback.startswith("bjj_session=token-value"))
        self.assertIn("Path=/", fallback)

    def test_demo_flags_come_from_env_not_the_committed_file(self):
        saved = {
            "BJJ_WAIVER_SUBMISSIONS": os.environ.get("BJJ_WAIVER_SUBMISSIONS"),
            "BJJ_WAITLIST": os.environ.get("BJJ_WAITLIST"),
        }
        try:
            os.environ["BJJ_WAIVER_SUBMISSIONS"] = "1"
            os.environ["BJJ_WAITLIST"] = "1"
            cfg = config_from_env()
            self.assertTrue(cfg["waiver_submissions_enabled"])
            self.assertTrue(cfg["waitlist_enabled"])
            os.environ.pop("BJJ_WAIVER_SUBMISSIONS")
            os.environ.pop("BJJ_WAITLIST")
            cfg = config_from_env()
            self.assertIsNone(cfg["waiver_submissions_enabled"])
            self.assertIsNone(cfg["waitlist_enabled"])
        finally:
            for key, value in saved.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        with open(os.path.join(os.path.dirname(__file__), "..", "waiver-config.json"), encoding="utf-8") as handle:
            raw = json.load(handle)
        self.assertTrue(raw["waiverSubmissionsEnabled"])
        self.assertFalse(raw["waitlistEnabled"])

    def test_demo_seed_is_fake_and_refuses_production(self):
        from server.demoseed import DemoSeedError, seed_demo

        passwords = {"dakota": "dakota-test-pass", "pierre": "pierre-test-pass"}
        with self.assertRaises(DemoSeedError):
            seed_demo("/tmp/data.db", passwords)
        with self.assertRaises(DemoSeedError):
            seed_demo("/var/lib/bjj-planner/data.db", passwords)
        with self.assertRaises(DemoSeedError):
            seed_demo("/tmp/bjj-demo-short.db", {"dakota": "short", "pierre": "pierre-test-pass"})

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = os.path.join(tmp.name, "demo.db")
        prod = os.path.join(tmp.name, "data.db")
        prod_conn = connect(prod)
        try:
            migrate(prod_conn)
            prod_conn.execute(
                """
                INSERT INTO users (id, username, password_hash, role, created_at, must_change_password)
                VALUES ('prod-coach', 'coach', ?, 'admin', ?, 0)
                """,
                (hash_password("prod-not-demo"), iso(utcnow())),
            )
            prod_conn.commit()
        finally:
            prod_conn.close()
        os.environ["BJJ_SQLITE_JOURNAL"] = "MEMORY"
        try:
            seed_demo(path, passwords)
            seed_demo(path, passwords)
            extra = connect(path)
            try:
                extra.execute(
                    """
                    INSERT INTO users (id, username, password_hash, role, created_at, must_change_password)
                    VALUES ('demo-user-preview', 'preview', ?, 'teacher', ?, 0)
                    """,
                    (hash_password("other-demo-account"), iso(utcnow())),
                )
                extra.commit()
            finally:
                extra.close()
            seed_demo(path, passwords)
        finally:
            os.environ.pop("BJJ_SQLITE_JOURNAL", None)
        conn = connect(path)
        try:
            names = [row["name"] for row in conn.execute("SELECT name FROM students ORDER BY name")]
            self.assertEqual(len(names), 14)
            self.assertTrue(all(name.startswith("EXAMPLE ") for name in names))
            capped = conn.execute("SELECT COUNT(*) AS n FROM students WHERE age BETWEEN 3 AND 10").fetchone()["n"]
            self.assertEqual(capped, 11)
            adults = conn.execute(
                "SELECT id, program, card_pin_hash FROM students WHERE program = 'adult' ORDER BY id"
            ).fetchall()
            self.assertEqual([row["id"] for row in adults], ["demo-quinn", "demo-uma"])
            self.assertTrue(adults[0]["card_pin_hash"])
            self.assertNotIn("2468", adults[0]["card_pin_hash"])
            self.assertTrue(check_password("2468", adults[0]["card_pin_hash"]))
            self.assertEqual(adults[1]["card_pin_hash"], "")
            quinn_form = conn.execute(
                "SELECT payload_json FROM waivers WHERE id = 'demo-waiver-quinn'"
            ).fetchone()
            self.assertIn("EXAMPLE-ADULT-SECRET", quinn_form["payload_json"])
            self.assertNotIn("2468", quinn_form["payload_json"])
            done = conn.execute(
                "SELECT COUNT(DISTINCT class_number) AS n FROM adult_progress WHERE student_id = 'demo-quinn'"
            ).fetchone()["n"]
            self.assertEqual(done, 14)
            emails = [row["email"] for row in conn.execute("SELECT email FROM waivers")]
            emails += [row["email"] for row in conn.execute("SELECT email FROM waitlist")]
            self.assertTrue(emails)
            self.assertTrue(all(email.endswith("@example.com") for email in emails))
            users = {row["username"]: row["role"] for row in conn.execute("SELECT username, role FROM users")}
            self.assertEqual(users, {"dakota": "admin", "pierre": "admin"})
            hashes = {row["username"]: row["password_hash"] for row in conn.execute("SELECT username, password_hash FROM users")}
            self.assertTrue(check_password("dakota-test-pass", hashes["dakota"]))
            self.assertTrue(check_password("pierre-test-pass", hashes["pierre"]))
            self.assertFalse(check_password("dakota-test-pass", hashes["pierre"]))
            self.assertTrue(all(secret not in item for item in hashes.values() for secret in passwords.values()))
            marker = conn.execute("SELECT value FROM settings WHERE key = 'demo_seed'").fetchone()
            self.assertEqual(marker["value"], "1")
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM waitlist").fetchone()["n"], 3)
            tokens = [row["parent_token"] for row in conn.execute("SELECT id, parent_token FROM students")]
            self.assertEqual(len(tokens), 14)
            self.assertEqual(len(set(tokens)), 14)
            self.assertTrue(all(len(token) >= 20 and token != "1" for token in tokens))
            milo = conn.execute(
                "SELECT roster_student_id, payload_json FROM waivers WHERE id = 'demo-waiver-milo'"
            ).fetchone()
            self.assertEqual(milo["roster_student_id"], "demo-milo")
            self.assertIn("EXAMPLE-MEDICAL-NOTE", milo["payload_json"])
            self.assertIsNone(conn.execute("SELECT 1 FROM waivers WHERE roster_student_id = 'demo-tess'").fetchone())
        finally:
            conn.close()
        prod_conn = connect(prod)
        try:
            prod_users = {row["username"]: row["role"] for row in prod_conn.execute("SELECT username, role FROM users")}
            self.assertEqual(prod_users, {"coach": "admin"})
            self.assertNotIn("dakota", prod_users)
            self.assertNotIn("pierre", prod_users)
        finally:
            prod_conn.close()

    def test_publish_tree_prefixes_demo_and_leaves_source_closed(self):
        import importlib.util

        spec = importlib.util.spec_from_file_location(
            "prefix_tree",
            os.path.join(os.path.dirname(__file__), "..", "deploy", "demo", "prefix_tree.py"),
        )
        prefix_tree = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(prefix_tree)
        root = os.path.join(os.path.dirname(__file__), "..")
        with open(os.path.join(root, "waiver-config.json"), encoding="utf-8") as handle:
            before = handle.read()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        published = prefix_tree.publish(root, tmp.name, "/demo")

        def slurp(path):
            with open(path, encoding="utf-8") as handle:
                return handle.read()

        self.assertEqual(slurp(os.path.join(root, "waiver-config.json")), before)
        flags = json.loads(slurp(os.path.join(published, "waiver-config.json")))
        self.assertTrue(flags["waiverSubmissionsEnabled"])
        self.assertTrue(flags["waitlistEnabled"])
        self.assertIn("I consent on behalf of my minor child.", flags["copy"]["kids"]["hygiene"])
        home = slurp(os.path.join(published, "index.html"))
        self.assertIn('name="bjj-base" content="/demo"', home)
        self.assertIn('href="/demo/kids/"', home)
        self.assertIn('location.replace("/demo/kids/#"', home)
        self.assertIn('fetch("/demo/adult-class.json"', home)
        self.assertNotIn('fetch("/adult-class.json"', home)
        self.assertNotIn('href="/kids/"', home)
        app_js = slurp(os.path.join(published, "js", "app.js"))
        self.assertIn('link.href = "/demo/app/waitlist/"', app_js)
        self.assertNotIn('link.href = "/app/waitlist/"', app_js)
        crawl_spec = importlib.util.spec_from_file_location(
            "crawl_links",
            os.path.join(os.path.dirname(__file__), "..", "deploy", "demo", "crawl_links.py"),
        )
        crawl_links = importlib.util.module_from_spec(crawl_spec)
        crawl_spec.loader.exec_module(crawl_links)
        self.assertEqual(crawl_links.self_check(), [])
        self.assertEqual(crawl_links.mirror_problems(published), [])
        self.assertEqual(crawl_links.crawl(published), [])
        self.assertIn('content="https://bjj.bettrbook.com/demo/"', home)
        kids = slurp(os.path.join(published, "kids", "index.html"))
        self.assertIn('src="/demo/img/gi/', kids)
        self.assertNotIn('src="/img/gi/', kids)
        self.assertIn("/demo/img/gi/01-ibjjf-approved-600.jpg", kids)
        manifest = json.loads(slurp(os.path.join(published, "manifest.webmanifest")))
        self.assertEqual(manifest["name"], "Grace BJJ")
        self.assertEqual(manifest["start_url"], "/demo/")
        self.assertEqual(manifest["scope"], "/demo/")
        self.assertEqual(manifest["id"], "/demo/")
        self.assertTrue(manifest["icons"][0]["src"].startswith("/demo/icons/"))
        kids_manifest = json.loads(slurp(os.path.join(published, "kids", "manifest.webmanifest")))
        self.assertEqual(kids_manifest["name"], "Grace BJJ Kids")
        self.assertEqual(kids_manifest["short_name"], "Grace BJJ Kids")
        self.assertEqual(kids_manifest["start_url"], "/demo/kids/")
        self.assertEqual(kids_manifest["scope"], "/demo/kids/")
        self.assertEqual(kids_manifest["id"], "/demo/kids/")
        staff_manifest = json.loads(slurp(os.path.join(published, "app", "manifest.webmanifest")))
        self.assertEqual(staff_manifest["name"], "Grace BJJ Staff")
        self.assertEqual(staff_manifest["start_url"], "/demo/app/")
        self.assertEqual(staff_manifest["id"], "/demo/app/")
        self.assertNotIn("affiliationCo", home)
        self.assertIn('id="adultCoInstructor"', home)
        source_home = slurp(os.path.join(root, "index.html"))
        self.assertIn('name="bjj-base" content=""', source_home)
        self.assertIn('href="/kids/"', source_home)
        with self.assertRaises(SystemExit):
            prefix_tree.publish(root, "/srv/bjj-planner", "/demo")

def _handler(api):
    from http.server import BaseHTTPRequestHandler

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            api.handle(self)

        def do_POST(self):
            api.handle(self)

        def do_PUT(self):
            api.handle(self)

        def do_PATCH(self):
            api.handle(self)

        def do_DELETE(self):
            api.handle(self)

        def log_message(self, fmt, *args):
            return

    return Handler


if __name__ == "__main__":
    unittest.main()
