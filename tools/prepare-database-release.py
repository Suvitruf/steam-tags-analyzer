"""Validate and package a downloaded SQLite snapshot for a GitHub Release."""

import argparse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import gzip
import hashlib
import json
from pathlib import Path
import re
import sqlite3


REQUIRED_TABLES = {
    "apps", "tags", "app_tags", "app_metrics", "review_histogram",
    "histogram_state", "histogram_sources", "collection_state",
    "detail_observations", "tag_snapshots",
}
ASSET_LIMIT = 2 * 1024 ** 3


def sha256(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare(database, headers_file, output, tag, source_url):
    if not re.fullmatch(r"data-\d{4}-(0[1-9]|1[0-2])", tag):
        raise ValueError("Expected a monthly release tag: data-YYYY-MM")
    database = database.resolve(strict=True)
    # curl can record proxy, redirect and retry headers; use the final response.
    lines = headers_file.read_text().strip().split("\n\n")[-1].splitlines()
    if not lines or len(lines[0].split()) < 2 or lines[0].split()[1] != "200":
        raise ValueError("The database download did not return HTTP 200")
    headers = {}
    for line in lines[1:]:
        key, separator, value = line.partition(":")
        if separator:
            headers[key.lower()] = value.strip()
    size = database.stat().st_size
    if "content-length" in headers and size != int(headers["content-length"]):
        raise ValueError("Downloaded size does not match Content-Length")
    with database.open("rb") as stream:
        if stream.read(16) != b"SQLite format 3\x00":
            raise ValueError("The download is not a SQLite database")

    connection = sqlite3.connect(database.as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise ValueError("SQLite integrity check failed")
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}
        missing = REQUIRED_TABLES - tables
        if missing:
            raise ValueError("Full working database is missing tables: " + ", ".join(sorted(missing)))
        counts = {}
        for table in sorted(tables):
            quoted = table.replace('"', '""')
            counts[table] = connection.execute(f'SELECT COUNT(*) FROM "{quoted}"').fetchone()[0]
        if not counts["apps"]:
            raise ValueError("The database has no apps")
        user_version = connection.execute("PRAGMA user_version").fetchone()[0]
    finally:
        connection.close()

    output.mkdir(parents=True, exist_ok=False)
    archive = output / "steam-tags-working.db.gz"
    database_hash = hashlib.sha256()
    with database.open("rb") as source, archive.open("wb") as target:
        with gzip.GzipFile(filename="", mode="wb", fileobj=target, compresslevel=6, mtime=0) as compressed:
            while chunk := source.read(1024 * 1024):
                database_hash.update(chunk)
                compressed.write(chunk)
    if archive.stat().st_size >= ASSET_LIMIT:
        raise ValueError("The compressed database exceeds GitHub's release asset limit (< 2 GiB)")

    modified = headers.get("last-modified")
    if modified:
        modified = parsedate_to_datetime(modified).astimezone(timezone.utc).isoformat()
    metadata = {
        "metadataVersion": 1,
        "releaseTag": tag,
        "packagedAt": datetime.now(timezone.utc).isoformat(),
        "source": {"url": source_url, "lastModified": modified, "etag": headers.get("etag")},
        "database": {
            "filename": "steam-tags-working.db", "bytes": size,
            "sha256": database_hash.hexdigest(), "sqliteUserVersion": user_version,
            "tableRows": counts,
        },
        "archive": {"filename": archive.name, "bytes": archive.stat().st_size, "sha256": sha256(archive)},
    }
    metadata_file = output / "metadata.json"
    metadata_file.write_text(json.dumps(metadata, indent=2) + "\n")
    (output / "SHA256SUMS").write_text("".join(f"{sha256(file)}  {file.name}\n" for file in [archive, metadata_file]))
    (output / "release-notes.md").write_text(
        f"Monthly full Steam database snapshot: `{tag}`.\n\n"
        f"Packaged at {metadata['packagedAt']}; CDN object last modified: {modified or 'not provided'}. Collection dates vary by record.\n\n"
        f"Source: [full working SQLite database]({source_url}). Includes review histories, detail observations, tag snapshots and collection state.\n\n"
        f"The snapshot contains {counts['apps']:,} apps. `metadata.json` lists table counts, SQLite user_version, source metadata and checksums for the compressed and uncompressed database.\n\n"
        "Download `steam-tags-working.db.gz`, `metadata.json` and `SHA256SUMS` into the same directory, then verify and unpack:\n\n"
        "```sh\nsha256sum --check SHA256SUMS\ngunzip --keep steam-tags-working.db.gz\n```\n\n"
        "Steam data and model artifacts retain their respective terms; the repository's MIT license applies to its client source code.\n"
    )
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--headers", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--source-url", required=True)
    args = parser.parse_args()
    metadata = prepare(args.database, args.headers, args.output, args.tag, args.source_url)
    print(f"Packaged {metadata['database']['tableRows']['apps']:,} apps into {metadata['archive']['bytes']:,} bytes")


if __name__ == "__main__":
    main()
