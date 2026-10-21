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
from server.db import connect, iso, migrate, new_id, utcnow

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
