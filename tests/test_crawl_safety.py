"""Small, offline regressions for metadata caching and the actual Actions gate."""
import importlib.util
import json
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]


class MetadataTests(unittest.TestCase):
    def setUp(self):
        self.api = SimpleNamespace(Client=Mock(), Search=Mock())
        spec = importlib.util.spec_from_file_location(
            "crawl_pipeline_test", ROOT / "daily_arxiv/daily_arxiv/pipelines.py"
        )
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"arxiv": self.api}):
            spec.loader.exec_module(module)
        self.pipeline = module.DailyArxivPipeline()
        paper = SimpleNamespace(authors=[SimpleNamespace(name="Author")],
                                title="Title", categories=["hep-th"],
                                comment=None, summary="Abstract")
        self.client = self.api.Client.return_value
        self.client.results.side_effect = lambda search: iter([paper])

    def test_conservative_client_settings(self):
        self.api.Client.assert_called_once_with(100, delay_seconds=10.0, num_retries=5)

    def test_cross_listed_paper_only_queries_once(self):
        first = self.pipeline.process_item({"id": "2610.00001"}, None)
        second = self.pipeline.process_item({"id": "2610.00001"}, None)
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        self.assertEqual(self.client.results.call_count, 1)
        second["title"] = "Changed downstream"
        self.assertEqual(self.pipeline.cache["2610.00001"]["title"], "Title")

    def test_different_papers_are_not_conflated(self):
        for paper_id in ("2610.00001", "2610.00002"):
            result = self.pipeline.process_item({"id": paper_id}, None)
            self.assertEqual(result["id"], paper_id)
        self.assertEqual(self.client.results.call_count, 2)

    def test_failed_request_propagates_and_is_not_cached(self):
        success = self.client.results.side_effect
        self.client.results.side_effect = RuntimeError("HTTP 429 after retries")
        with self.assertRaisesRegex(RuntimeError, "429"):
            self.pipeline.process_item({"id": "2610.00001"}, None)
        self.assertNotIn("2610.00001", self.pipeline.cache)
        self.client.results.side_effect = success
        self.pipeline.process_item({"id": "2610.00001"}, None)
        self.assertEqual(self.client.results.call_count, 2)


class WorkflowGateTests(unittest.TestCase):
    def run_gate(self, log, crawl_exit=0, ids=("2610.00001",), feed=None, finished=True):
        workflow = (ROOT / ".github/workflows/run.yml").read_text(encoding="utf-8")
        start = workflow.index("        set -o pipefail\n")
        end = workflow.index("        # 检查爬取是否成功", start)
        script = textwrap.dedent(workflow[start:end])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            work = root / "crawl"
            (work / "daily_arxiv").mkdir(parents=True)
            shutil.copyfile(ROOT / "daily_arxiv/daily_arxiv/check_crawl.py",
                            work / "daily_arxiv/check_crawl.py")
            (root / "python").symlink_to(sys.executable)
            cli = root / "scrapy"
            cli.write_text('#!/bin/sh\nprintf "%s\\n" "$CRAWL_LOG"\nexit "$CRAWL_EXIT"\n')
            cli.chmod(0o755)
            (root / "data").mkdir()
            if ids is not None:
                content = feed if feed is not None else "\n".join(json.dumps({
                    "id": paper_id, "title": "Title", "authors": ["Author"],
                    "categories": ["hep-th"], "summary": "Abstract",
                }) for paper_id in ids)
                (root / "data/2026-10-06.jsonl").write_text(content)
            if finished:
                log += "\n2026-10-12 12:40:00 [scrapy.core.engine] INFO: Spider closed (finished)"
            published = work / "published.txt"
            published.write_text("previous complete data")
            env = dict(os.environ, PATH=tmp + os.pathsep + os.environ["PATH"],
                       RUNNER_TEMP=tmp, today="2026-10-06",
                       CRAWL_LOG=log, CRAWL_EXIT=str(crawl_exit))
            result = subprocess.run(
                ["bash", "-e", "-c", script + 'printf "new data" > published.txt\n'],
                cwd=work, env=env, text=True, capture_output=True, timeout=10,
            )
            return result, published.read_text()

    def test_success_can_continue(self):
        result, published = self.run_gate("2026-10-12 12:39:00 [arxiv] INFO: Found paper 2610.00001 with categories {'hep-th'}")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(published, "new data")

    def test_item_error_with_zero_exit_cannot_publish(self):
        result, published = self.run_gate("2026-10-12 12:24:25 [scrapy.core.scraper] ERROR: Error processing {'id': '2610.12862'}")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("::error::", result.stdout)
        self.assertEqual(published, "previous complete data")

    def test_critical_error_cannot_publish(self):
        result, published = self.run_gate("2026-10-12 12:24:25 [scrapy] CRITICAL: Crawl failed")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(published, "previous complete data")

    def test_nonzero_cli_exit_is_not_hidden_by_tee(self):
        result, published = self.run_gate("Process failed", crawl_exit=7)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(published, "previous complete data")

    def test_recovered_retry_is_not_a_fatal_error(self):
        result, published = self.run_gate("2026-10-12 12:24:25 [arxiv] DEBUG: Got error (try 0): HTTP 429\n2026-10-12 12:25:00 [arxiv] INFO: Got first page: 1 of 1 total results")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(published, "new data")

    def test_oct12_item_error_recovered_in_final_feed_can_publish(self):
        log = ("2026-10-12 12:24:53 [scrapy.core.scraper] ERROR: Error processing "
               "{'id': '2610.13791', 'categories': ['hep-lat']}\n"
               "2026-10-12 12:37:51 [arxiv] INFO: Found paper 2610.13791 with categories {'hep-lat'}")
        result, published = self.run_gate(log, ids=("2610.13791",))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Recovered item errors", result.stdout)
        self.assertEqual(published, "new data")

    def test_successful_api_log_without_export_cannot_clear_item_error(self):
        log = ("2026-10-12 12:24:53 [scrapy.core.scraper] ERROR: Error processing {'id': '2610.13791'}\n"
               "2026-10-12 12:37:51 [arxiv] INFO: Got first page: 1 of 1 total results")
        result, published = self.run_gate(log)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Missing paper IDs: 2610.13791", result.stdout)
        self.assertEqual(published, "previous complete data")

    def test_duplicate_rows_do_not_hide_missing_discovered_id(self):
        log = "2026-10-12 12:25:43 [arxiv] INFO: Found paper 2610.12862 with categories {'hep-ex'}"
        result, published = self.run_gate(log, ids=("2610.00001", "2610.00001"))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("2610.12862", result.stdout)
        self.assertEqual(published, "previous complete data")

    def test_other_errors_are_not_ignored_even_with_complete_feed(self):
        for message in ("[scrapy.core.engine] ERROR: Error while closing spider",
                        "[scrapy.core.scraper] ERROR: Spider error processing <GET list>",
                        "[scrapy.extensions.feedexport] ERROR: Error storing jsonl feed"):
            with self.subTest(message=message):
                result, published = self.run_gate("2026-10-12 12:40:00 " + message)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(published, "previous complete data")

    def test_unrecognized_item_error_fails_closed(self):
        result, published = self.run_gate("2026-10-12 12:24:25 [scrapy.core.scraper] ERROR: Error processing unknown item")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(published, "previous complete data")

    def test_missing_malformed_and_incomplete_feeds_cannot_publish(self):
        for options in ({"ids": None}, {"feed": "{broken"}, {"feed": '{"id": "2610.00001"}'}):
            with self.subTest(options=options):
                result, published = self.run_gate("", **options)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(published, "previous complete data")

    def test_shutdown_without_errors_is_not_success(self):
        result, published = self.run_gate("2026-10-12 12:40:00 [scrapy.core.engine] INFO: Spider closed (shutdown)", finished=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(published, "previous complete data")

    def test_normally_finished_empty_batch_can_reach_dedup_check(self):
        result, published = self.run_gate("", ids=())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(published, "new data")


if __name__ == "__main__":
    unittest.main()
