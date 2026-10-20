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
