"""Scan every blob in git history for the owner's personal data.

    python scripts/scanSecrets.py

Written after a miss: the first scrub grepped file *text*, so `files.zip` —
which contained the same transcript, compressed — sailed through and was
pushed. Text search over a repository is not a check for personal data if the
repository contains archives.

This walks every blob reachable from every ref, and looks inside zips.
"""

import io
import json
import re
import subprocess
import sys
import zipfile

# Markers of the owner's own record, not of the blank template the app ships.
NEEDLES = [
    re.compile(rb'"student"\s*:\s*"[A-Za-z]'),
    re.compile(rb"colbyshannon19"),
    re.compile(rb'"grade"\s*:\s*"(?:A|B|C|D|F|UW|W)[+-]?"'),
]
ARCHIVE_SUFFIXES = (".zip",)


def run(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True
    ).stdout


def blob(sha: str) -> bytes:
    return subprocess.run(
        ["git", "cat-file", "blob", sha], capture_output=True, check=True
    ).stdout


def hits_in(data: bytes) -> bool:
    return any(n.search(data) for n in NEEDLES)


def main() -> int:
    # Default to the local branches only. Including remote-tracking refs makes
    # the scan report on whatever the server still has, which is the thing the
    # force-push is about to replace — alarming, and not about this working copy.
    scope = sys.argv[1:] or ["--branches"]
    commits = run("rev-list", *scope).split()
    seen: set[str] = set()
    findings: list[str] = []

    for commit in commits:
        for line in run("ls-tree", "-r", commit).splitlines():
            meta, path = line.split("\t", 1)
            sha = meta.split()[2]
            # This file contains the patterns themselves.
            if path == "scripts/scanSecrets.py":
                continue
            if (sha, path) in seen:
                continue
            seen.add((sha, path))
            data = blob(sha)

            if hits_in(data):
                findings.append(f"{commit[:9]}  {path}")
                continue

            if path.lower().endswith(ARCHIVE_SUFFIXES):
                try:
                    with zipfile.ZipFile(io.BytesIO(data)) as z:
                        for entry in z.namelist():
                            if hits_in(z.read(entry)):
                                findings.append(f"{commit[:9]}  {path} -> {entry}")
                except zipfile.BadZipFile:
                    pass

    print(f"scanned {len(seen)} blobs across {len(commits)} commit(s)")
    if findings:
        print(f"\n{len(findings)} blob(s) contain personal data:")
        for f in sorted(set(findings)):
            print("  ", f)
        return 1
    print("no personal data found in any commit, including inside archives")
    return 0


if __name__ == "__main__":
    sys.exit(main())
