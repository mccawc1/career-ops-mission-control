#!/usr/bin/env python3
"""Spell-check resumes, cover letters, form answers and anything else before it goes out.

    python3 spellcheck.py FILE [FILE ...]     # .yml .md .txt .pdf .docx, or "-" for stdin
    python3 spellcheck.py --text "some words"

Uses aspell (American English). Names, brands and tech words that are spelled
right go in spell-ok.txt next to this file, one per line. Prints each unknown
word with where it appears; exit code 1 if any were found. A word in the
output is not always wrong: read it, then fix it or add it to spell-ok.txt.
"""
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OK = HERE / "spell-ok.txt"


def text_of(arg):
    if arg == "-":
        return sys.stdin.read()
    p = Path(arg)
    if p.suffix.lower() == ".pdf":
        return subprocess.run(["pdftotext", "-layout", str(p), "-"], capture_output=True, text=True).stdout
    if p.suffix.lower() == ".docx":
        import zipfile
        xml = zipfile.ZipFile(p).read("word/document.xml").decode("utf8", "ignore")
        return re.sub(r"<[^>]+>", " ", xml)
    return p.read_text(errors="ignore")


def check(name, text):
    ok = {w.strip().lower() for w in OK.read_text().splitlines() if w.strip()} if OK.exists() else set()
    clean = re.sub(r"https?://\S+|\S+@\S+|`[^`]*`", " ", text)
    out = subprocess.run(["aspell", "list", "--lang=en_US", "--ignore-case"], input=clean,
                         capture_output=True, text=True).stdout.split()
    bad = sorted({w for w in out if w.lower() not in ok and not re.fullmatch(r"[A-Z0-9]{2,}s?", w)})
    for w in bad:
        m = re.search(r".{0,40}\b" + re.escape(w) + r"\b.{0,40}", clean)
        print(f"{name}: {w}   ...{m.group(0).strip() if m else ''}...")
    return bad


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    found = []
    if args[0] == "--text":
        found += check("text", " ".join(args[1:]))
    else:
        for a in args:
            found += check(Path(a).name, text_of(a))
    if not found:
        print("No spelling problems found.")
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
