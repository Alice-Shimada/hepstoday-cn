"""Small, offline regressions for metadata caching and the actual Actions gate."""
import importlib.util
import os
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
    def run_gate(self, log, crawl_exit=0):
        workflow = (ROOT / ".github/workflows/run.yml").read_text(encoding="utf-8")
        start = workflow.index("        set -o pipefail\n")
        end = workflow.index("        # 检查爬取是否成功", start)
        script = textwrap.dedent(workflow[start:end])
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cli = root / "scrapy"
            cli.write_text('#!/bin/sh\nprintf "%s\\n" "$CRAWL_LOG"\nexit "$CRAWL_EXIT"\n')
            cli.chmod(0o755)
            published = root / "published.txt"
            published.write_text("previous complete data")
            env = dict(os.environ, PATH=tmp + os.pathsep + os.environ["PATH"],
                       RUNNER_TEMP=tmp, today="2026-10-06",
                       CRAWL_LOG=log, CRAWL_EXIT=str(crawl_exit))
            result = subprocess.run(
                ["bash", "-e", "-c", script + 'printf "new data" > published.txt\n'],
                cwd=tmp, env=env, text=True, capture_output=True, timeout=10,
            )
            return result, published.read_text()

    def test_success_can_continue(self):
        result, published = self.run_gate("2026-10-06 [scrapy.core.engine] INFO: Spider closed (finished)")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(published, "new data")

    def test_item_error_with_zero_exit_cannot_publish(self):
        result, published = self.run_gate("2026-10-06 [scrapy.core.scraper] ERROR: Error processing HTTP 429")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("::error::", result.stdout)
        self.assertEqual(published, "previous complete data")

    def test_critical_error_cannot_publish(self):
        result, published = self.run_gate("2026-10-06 [scrapy] CRITICAL: Crawl failed")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(published, "previous complete data")

    def test_nonzero_cli_exit_is_not_hidden_by_tee(self):
        result, published = self.run_gate("Process failed", crawl_exit=7)
        self.assertEqual(result.returncode, 7)
        self.assertEqual(published, "previous complete data")

    def test_recovered_retry_is_not_a_fatal_error(self):
        result, published = self.run_gate("2026-10-06 [arxiv] DEBUG: Got error (try 0): HTTP 429\n2026-10-06 [arxiv] INFO: Got first page: 1 of 1 total results")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(published, "new data")


if __name__ == "__main__":
    unittest.main()
