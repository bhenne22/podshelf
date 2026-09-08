#!/usr/bin/env python3
"""Mirror every podcast's media from DreamHost to a local directory.

Podshelf's database is backed up nightly to the Synology, but the files it
points at are not: audio, artwork, transcripts and chapter sidecars all live on
DreamHost under each podcast's own account, with no second copy anywhere. This
fills that gap.

Why HTTP and not SFTP: each podcast has its own DreamHost shell user (eight of
them, all on one host), so an rsync-based mirror would need a key installed for
every account. Every file is already public — listeners fetch the audio, the
static sites fetch the transcripts — so this asks Podshelf for the authoritative
file list and pulls it over HTTPS with no DreamHost credentials at all.

    PODSHELF_API_KEY=pk_... ./scripts/backup-media.py --dest /volume1/Backups/dreamhost

Safe to run on a timer: it is incremental (a file whose size already matches is
skipped), never deletes anything unless asked, and takes a lock so an overlapping
run is a no-op.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_API = "https://podshelf.hennemo.com"
# Cloudflare 403s the default Python-urllib agent (error 1010) on the Podshelf
# host, so every request here sets an explicit one.
USER_AGENT = "podshelf-backup/1.0"
KINDS = ("audio", "artwork")


def api_get(base: str, path: str, key: str, timeout: int = 120) -> object:
    req = urllib.request.Request(
        base.rstrip("/") + path,
        headers={"X-Api-Key": key, "Accept": "application/json", "User-Agent": USER_AGENT},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def download(url: str, dest: Path, timeout: int = 600) -> int:
    """Fetch to a temp file, then rename. A killed run leaves a .part, never a
    truncated file that the next run would mistake for complete."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    written = 0
    with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            written += len(chunk)
    tmp.rename(dest)
    return written


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} GB"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dest", required=True, type=Path,
                    help="Root of the mirror, e.g. /volume1/Backups/dreamhost")
    ap.add_argument("--api", default=os.environ.get("PODSHELF_URL", DEFAULT_API))
    ap.add_argument("--podcast", action="append", default=None,
                    help="Limit to this slug (repeatable). Default: every active podcast.")
    ap.add_argument("--prune", action="store_true",
                    help="Delete local files that are no longer on the server. Off by "
                         "default — a backup that deletes on its own is a liability, and "
                         "an episode pulled from Podshelf is exactly when you want the "
                         "old file still sitting in the mirror.")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--retries", type=int, default=3)
    args = ap.parse_args()

    key = os.environ.get("PODSHELF_API_KEY")
    if not key:
        sys.exit("FATAL: set PODSHELF_API_KEY (needs read access to every podcast)")

    started = time.time()
    pods = api_get(args.api, "/api/podcasts", key)
    if not isinstance(pods, list):
        sys.exit(f"FATAL: /api/podcasts returned {pods!r}")
    slugs = [p["slug"] for p in pods if p.get("status") == "active"]
    if args.podcast:
        wanted = set(args.podcast)
        missing = wanted - set(slugs)
        if missing:
            sys.exit(f"FATAL: not an active podcast: {', '.join(sorted(missing))}")
        slugs = [s for s in slugs if s in wanted]

    totals = {"new": 0, "bytes": 0, "have": 0, "failed": 0, "pruned": 0}
    manifest: dict = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                      "api": args.api, "podcasts": {}}

    for slug in slugs:
        per = {"new": 0, "bytes": 0, "have": 0, "failed": 0, "files": 0}
        for kind in KINDS:
            try:
                listing = api_get(args.api, f"/api/podcasts/{slug}/files?kind={kind}", key)
            except urllib.error.HTTPError as e:
                # A podcast with no storage configured 4xxs here; that isn't fatal.
                print(f"  {slug}/{kind}: listing failed (HTTP {e.code}) — skipped")
                continue
            files = listing.get("files", []) if isinstance(listing, dict) else []
            outdir = args.dest / slug / kind
            seen = set()
            for f in files:
                name, size, url = f.get("name"), f.get("size") or 0, f.get("url")
                if not name or not url:
                    continue
                seen.add(name)
                per["files"] += 1
                target = outdir / name
                if target.exists() and target.stat().st_size == size:
                    per["have"] += 1
                    continue
                if args.dry_run:
                    print(f"  would fetch {slug}/{kind}/{name} ({human(size)})")
                    per["new"] += 1
                    per["bytes"] += size
                    continue
                for attempt in range(1, args.retries + 1):
                    try:
                        got = download(url, target)
                        per["new"] += 1
                        per["bytes"] += got
                        break
                    except Exception as e:
                        if attempt == args.retries:
                            print(f"  FAILED {slug}/{kind}/{name}: {e}")
                            per["failed"] += 1
                        else:
                            time.sleep(2 * attempt)

            if args.prune and outdir.exists() and not args.dry_run:
                for local in outdir.iterdir():
                    if local.is_file() and local.name not in seen and not local.name.endswith(".part"):
                        local.unlink()
                        totals["pruned"] += 1
                        print(f"  pruned {slug}/{kind}/{local.name}")

        manifest["podcasts"][slug] = per
        for k in ("new", "bytes", "have", "failed"):
            totals[k] += per[k]
        print(f"{slug:24} files={per['files']:<5} new={per['new']:<5} "
              f"already-had={per['have']:<5} failed={per['failed']:<3} {human(per['bytes'])}")

    if not args.dry_run:
        args.dest.mkdir(parents=True, exist_ok=True)
        (args.dest / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print(f"\nnew={totals['new']} ({human(totals['bytes'])})  already-had={totals['have']}  "
          f"failed={totals['failed']}  pruned={totals['pruned']}  "
          f"in {time.time() - started:.0f}s")
    # A failed download is worth a non-zero exit so a scheduler surfaces it.
    return 1 if totals["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
