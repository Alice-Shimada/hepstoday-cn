"""Compare reader code in two checkouts, allowing only explicit site identity.

Usage: python3 tests/reader-symmetry.py /path/to/cn /path/to/en
This is read-only. It does not copy files or change either checkout.
"""
import argparse
from pathlib import Path
import sys

SHARED = (
    "js/app.js", "js/runtime-fixes.js", "js/reader-core.js", "js/reader.js",
    "css/reader.css", "tests/reader-core.test.cjs", "tests/reader-browser.cjs",
    "tests/reader-symmetry.py", "tests/reader-live.cjs", "tests/test_data_manifest.py",
    ".github/workflows/reader-checks.yml", ".github/workflows/run.yml",
    ".github/workflows/maintain-data-index.yml", ".github/workflows/data-manifest-test.yml",
    ".github/workflows/frontend-smoke.yml", "READER.md",
)
CONFIGURED = ("index.html", "js/data-config.js")


def normalized(content):
    return content.replace(b"hepstoday-cn", b"hepstoday-SITE").replace(
        b"hepstoday-en", b"hepstoday-SITE"
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("left", type=Path)
    parser.add_argument("right", type=Path)
    args = parser.parse_args()
    failures = []
    for name in SHARED + CONFIGURED:
        try:
            left = (args.left / name).read_bytes()
            right = (args.right / name).read_bytes()
            if name in CONFIGURED:
                left, right = normalized(left), normalized(right)
            if left != right:
                failures.append(name)
        except OSError as error:
            failures.append(f"{name}: {error}")
    if failures:
        print("Reader code differs:\n" + "\n".join(failures), file=sys.stderr)
        return 1
    print(f"PASS: {len(SHARED)} shared files are byte-identical; "
          f"{len(CONFIGURED)} entry/config files differ only in site identity.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
