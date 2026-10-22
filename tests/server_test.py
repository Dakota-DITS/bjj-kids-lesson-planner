"""Attendance API checks. Uses a temporary database and a local HTTP server."""

import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from server.httpapp import Api, config_from_env, hash_password
from server.db import (
    age_group_for_age,
    connect,
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
        self.csrf = ""

    def call(self, method, path, body=None, csrf=None, raw=False):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        token = self.csrf if csrf is None else csrf
        if method != "GET" and token:
            req.add_header("X-CSRF-Token", token)
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
        set_cookie = headers.get("Set-Cookie") or ""
        if "bjj_session=" in set_cookie:
            self.cookie = set_cookie.split(";", 1)[0]

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
        self.assertEqual(boot["levels"][sid]["ls-americana"], "practicing")
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
        self.assertEqual(again["levels"][sam["id"]]["ls-mount-base"], "own")
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
        self.assertEqual(age_group_for_age(5), "mite")
        self.assertEqual(age_group_for_age(7), "mite")
        self.assertEqual(age_group_for_age(8), "upper")
        self.assertEqual(age_group_for_age(14), "upper")
        self.assertEqual(age_group_for_age(3), "")
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
                ("ComboCleo", 11, 1),
                ("ComboDee", 14, 2),
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
            self.assertEqual(body["settings"]["ages"], "4–7 Mighty Mites")
            self.assertEqual(body["lesson"]["items"][0]["ages"], ["mite", "upper"])
            folded = conn.execute(
                "SELECT age_group, plan_json FROM lesson_plans WHERE id='lp-upper'"
            ).fetchone()
            self.assertEqual(folded["age_group"], "upper")
            folded_body = json.loads(folded["plan_json"])
            self.assertEqual(folded_body["settings"]["ageGroup"], "upper")
            self.assertEqual(folded_body["settings"]["ages"], "8–10")
            migrate(conn)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM age_group_flags").fetchone()["n"], 1)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM classes").fetchone()["n"], 4)
            self.assertEqual(conn.execute("SELECT COUNT(*) AS n FROM lesson_plans").fetchone()["n"], 2)
            again = json.loads(
                conn.execute("SELECT plan_json FROM lesson_plans WHERE id='lp-ecd22b41'").fetchone()["plan_json"]
            )
            self.assertEqual(again["settings"]["ages"], "4–7 Mighty Mites")
            self.assertEqual(
                conn.execute("SELECT age_group FROM classes WHERE id='k-pw'").fetchone()["age_group"],
                "peewee",
            )
        finally:
            conn.close()
            os.remove(path)


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
