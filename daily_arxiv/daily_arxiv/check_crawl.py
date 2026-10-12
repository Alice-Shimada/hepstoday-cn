"""Validate the final feed, not whether an item ever failed during the crawl."""
import ast
import json
from pathlib import Path
import re
import sys


# Match Scrapy log records, not error-looking text inside a paper's abstract.
RECORD = re.compile(
    r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \[([^\]]+)\] "
    r"(DEBUG|INFO|WARNING|ERROR|CRITICAL): (.*)$", re.MULTILINE
)


def validate(log_path, feed_path):
    log = Path(log_path).read_text(encoding="utf-8")
    saved = set()
    for line in Path(feed_path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        paper = json.loads(line)
        if not isinstance(paper, dict) or not all(
            paper.get(key) for key in ("id", "title", "authors", "categories", "summary")
        ):
            raise ValueError("Incomplete paper metadata in the exported feed")
        saved.add(paper["id"])

    expected, failed = set(), set()
    finished = False
    for logger, level, message in RECORD.findall(log):
        if logger == "arxiv" and level == "INFO" and message.startswith("Found paper "):
            expected.add(message.split()[2])
        if logger == "scrapy.core.engine" and message == "Spider closed (finished)":
            finished = True
        if level not in ("ERROR", "CRITICAL"):
            continue
        # Only a recognized item error can be superseded by a complete export.
        if logger == "scrapy.core.scraper" and level == "ERROR" and message.startswith("Error processing "):
            item = ast.literal_eval(message[len("Error processing "):])
            failed.add(item["id"])
        else:
            raise ValueError(f"Crawler error: {logger}: {message}")

    if not finished:
        raise ValueError("The spider did not finish normally")
    missing = (expected | failed) - saved
    if missing:
        raise ValueError("Missing paper IDs: " + ", ".join(sorted(missing)))
    if failed:
        print("::warning::Recovered item errors; verified in final feed: " + ", ".join(sorted(failed)))
    print(f"Crawl validated: {len(saved)} unique papers; no discovered IDs missing.")


if __name__ == "__main__":
    try:
        validate(*sys.argv[1:])
    except (OSError, ValueError, TypeError, KeyError, SyntaxError) as error:
        print(f"::error::{error}; keeping previously published data unchanged.")
        sys.exit(1)
