"""Exercise Scrapy's retry policy and the publication gate without network I/O."""
from contextlib import redirect_stdout
import io
import json
import logging
from pathlib import Path
import runpy
import tempfile
import unittest

from scrapy import Request, Spider
from scrapy.core.downloader import Slot
from scrapy.crawler import Crawler
from scrapy.downloadermiddlewares.retry import RetryMiddleware
from scrapy.http import Response
from scrapy.settings import Settings
from scrapy.statscollectors import MemoryStatsCollector

ROOT = Path(__file__).resolve().parents[1]
validate = runpy.run_path(str(ROOT / "daily_arxiv/daily_arxiv/check_crawl.py"))["validate"]


class CrawlRequestTests(unittest.TestCase):
    def setUp(self):
        values = runpy.run_path(str(ROOT / "daily_arxiv/daily_arxiv/settings.py"))
        self.settings = Settings({key: value for key, value in values.items() if key.isupper()})
        self.crawler = Crawler(Spider, self.settings)
        self.crawler.stats = MemoryStatsCollector(self.crawler)
        self.spider = Spider.from_crawler(self.crawler, name="arxiv")
        self.retry = RetryMiddleware.from_crawler(self.crawler)

    def responses(self, url, statuses):
        request = Request(url)
        with self.assertLogs("scrapy.downloadermiddlewares.retry", level="DEBUG") as captured:
            for status in statuses:
                response = Response(url, status=status, request=request)
                result = self.retry.process_response(request, response, self.spider)
                if isinstance(result, Request):
                    request = result
                else:
                    break
        formatter = logging.Formatter(
            "%(asctime)s [%(name)s] %(levelname)s: %(message)s", "%Y-%m-%d %H:%M:%S"
        )
        return result, "\n".join(formatter.format(record) for record in captured.records)

    def validate_feed(self, log):
        # A complete feed must not conceal exhausted robots/listing retries.
        log += (
            "\n2026-10-28 18:25:00 [arxiv] INFO: Found paper 2610.00001 with categories {'hep-th'}"
            "\n2026-10-28 18:25:01 [scrapy.core.engine] INFO: Spider closed (finished)\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            log_path, feed_path = Path(tmp) / "crawl.log", Path(tmp) / "feed.jsonl"
            log_path.write_text(log, encoding="utf-8")
            feed_path.write_text(json.dumps({
                "id": "2610.00001", "title": "Title", "authors": ["Author"],
                "categories": ["hep-th"], "summary": "Abstract",
            }) + "\n", encoding="utf-8")
            with redirect_stdout(io.StringIO()):
                validate(log_path, feed_path)

    def test_robots_rules_remain_enabled(self):
        self.assertTrue(self.settings.getbool("ROBOTSTXT_OBEY"))

    def test_download_slot_respects_arxiv_crawl_delay(self):
        self.assertEqual(self.settings.getint("CONCURRENT_REQUESTS_PER_DOMAIN"), 1)
        self.assertEqual(self.settings.getfloat("DOWNLOAD_DELAY"), 15)
        self.assertFalse(self.settings.getbool("RANDOMIZE_DOWNLOAD_DELAY"))
        slot = Slot(
            self.settings.getint("CONCURRENT_REQUESTS_PER_DOMAIN"),
            self.settings.getfloat("DOWNLOAD_DELAY"),
            self.settings.getbool("RANDOMIZE_DOWNLOAD_DELAY"),
        )
        self.assertEqual(slot.download_delay(), 15)

    def test_robots_recovers_after_three_503_responses(self):
        result, log = self.responses("https://arxiv.org/robots.txt", [503, 503, 503, 200])
        self.assertEqual(result.status, 200)
        self.assertEqual(self.crawler.stats.get_value("retry/count"), 3)
        self.assertIsNone(self.crawler.stats.get_value("retry/max_reached"))
        self.validate_feed(log)

    def test_exhausted_robots_retries_still_block_publication(self):
        result, log = self.responses("https://arxiv.org/robots.txt", [503] * 5)
        self.assertEqual(result.status, 503)
        self.assertEqual(self.crawler.stats.get_value("retry/count"), 4)
        self.assertEqual(self.crawler.stats.get_value("retry/max_reached"), 1)
        with self.assertRaisesRegex(ValueError, r"Gave up retrying.*robots\.txt"):
            self.validate_feed(log)

    def test_exhausted_listing_retries_still_block_publication(self):
        result, log = self.responses("https://arxiv.org/list/hep-th/new", [503] * 5)
        self.assertEqual(result.status, 503)
        self.assertEqual(self.crawler.stats.get_value("retry/count"), 4)
        self.assertEqual(self.crawler.stats.get_value("retry/max_reached"), 1)
        with self.assertRaisesRegex(ValueError, "Gave up retrying.*list/hep-th/new"):
            self.validate_feed(log)


if __name__ == "__main__":
    unittest.main()
