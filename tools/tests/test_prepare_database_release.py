import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("database_release", Path(__file__).resolve().parents[1] / "prepare-database-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class DatabaseReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.database = self.root / "working.db"
        with sqlite3.connect(self.database) as db:
            for name in release.REQUIRED_TABLES:
                db.execute(f'CREATE TABLE "{name}" (id INTEGER)')
            db.execute("INSERT INTO apps VALUES (42)")
            db.execute("INSERT INTO review_histogram VALUES (42)")
        self.headers = self.root / "headers.txt"
        self.write_headers()
        self.output = self.root / "release"

    def write_headers(self, size=None):
        length = self.database.stat().st_size if size is None else size
        self.headers.write_text(f'HTTP/1.1 302 Found\nContent-Length: 0\n\nHTTP/2 200\nContent-Length: {length}\nLast-Modified: Sat, 31 Oct 2026 10:18:06 GMT\nETag: "snapshot"\n\n')

    def prepare(self):
        return release.prepare(self.database, self.headers, self.output, "data-2026-10", "https://example.invalid/working.db")

    def test_archive_preserves_database_and_checksums_verify(self):
        original = self.database.read_bytes()
        metadata = self.prepare()
        self.assertEqual(gzip.decompress((self.output / "steam-tags-working.db.gz").read_bytes()), original)
        self.assertEqual(metadata["database"]["sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(metadata["database"]["tableRows"]["review_histogram"], 1)
        self.assertEqual(metadata["source"]["lastModified"], "2026-10-31T10:18:06+00:00")
        self.assertEqual(json.loads((self.output / "metadata.json").read_text()), metadata)
        for line in (self.output / "SHA256SUMS").read_text().splitlines():
            checksum, filename = line.split("  ")
            self.assertEqual(checksum, hashlib.sha256((self.output / filename).read_bytes()).hexdigest())
        self.assertIn("1 apps", (self.output / "release-notes.md").read_text())

    def test_rejects_truncated_download(self):
        self.write_headers(size=self.database.stat().st_size + 100)
        with self.assertRaisesRegex(ValueError, "Content-Length"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_rejects_html_and_corrupt_sqlite(self):
        for content in [b"<html>Unavailable</html>", b"SQLite format 3\x00" + b"broken" * 100]:
            with self.subTest(content=content[:16]):
                self.database.write_bytes(content)
                self.write_headers()
                with self.assertRaises((ValueError, sqlite3.DatabaseError)):
                    self.prepare()
                self.assertFalse(self.output.exists())

    def test_rejects_browser_export_without_history(self):
        with sqlite3.connect(self.database) as db:
            db.execute("DROP TABLE review_histogram")
        self.write_headers()
        with self.assertRaisesRegex(ValueError, "missing tables: review_histogram"):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_rejects_empty_catalog(self):
        with sqlite3.connect(self.database) as db:
            db.execute("DELETE FROM apps")
        with self.assertRaisesRegex(ValueError, "no apps"):
            self.prepare()

    def test_rejects_http_error(self):
        self.headers.write_text("HTTP/2 503\nContent-Length: 0\n\n")
        with self.assertRaisesRegex(ValueError, "HTTP 200"):
            self.prepare()

    def test_enforces_release_asset_limit(self):
        with patch.object(release, "ASSET_LIMIT", 1):
            with self.assertRaisesRegex(ValueError, "asset limit"):
                self.prepare()
        self.assertFalse((self.output / "metadata.json").exists())


if __name__ == "__main__":
    unittest.main()
