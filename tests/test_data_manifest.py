"""Regression tests for the manifest shell blocks actually used by Actions.

Run with: python3 -m unittest discover -s tests -v
Only the standard library and the workflow's existing Bash/find/sort tools
are required. Fixtures and temporary manifests stay outside the checkout.
"""

import os
from pathlib import Path
import subprocess
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = (
    ROOT / ".github/workflows/run.yml",
    ROOT / ".github/workflows/maintain-data-index.yml",
)


def manifest_script(workflow):
    """Extract the real inline block, avoiding a duplicated test implementation."""
    lines = workflow.read_text(encoding="utf-8").splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == 'manifest="$(mktemp)"')
    end = next(
        i for i in range(start, len(lines))
        if lines[i].strip().startswith('echo "Manifest contains ')
    )
    return "set -euo pipefail\nmkdir -p assets\n" + textwrap.dedent(
        "\n".join(lines[start:end + 1])
    ) + "\n"


class DataManifestTests(unittest.TestCase):
    def run_manifest(self, workflow, root):
        env = dict(os.environ, TMPDIR=str(root))
        return subprocess.run(
            ["bash", "-c", manifest_script(workflow)],
            cwd=root, env=env, text=True, capture_output=True, timeout=10,
        )

    def test_history_and_new_files_are_sorted_and_filtered(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                data = root / "data"
                data.mkdir()
                expected = [
                    "2026-10-05_AI_enhanced_English.jsonl",
                    "2026-10-02_AI_enhanced_English.jsonl",
                    "2026-09-30_AI_enhanced_English.jsonl",
                ]
                for name in reversed(expected):
                    (data / name).write_text("{}\n", encoding="utf-8")
                (data / "2026-10-05.jsonl").write_text("{}\n", encoding="utf-8")
                (data / "2026-10-05.md").write_text("# Papers\n", encoding="utf-8")
                nested = data / "nested"
                nested.mkdir()
                (nested / "2026-10-06_AI_enhanced_English.jsonl").touch()
                (data / "2026-10-07_AI_enhanced_English.jsonl").mkdir()
                result = self.run_manifest(workflow, root)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(
                    (root / "assets/file-list.txt").read_text().splitlines(), expected
                )

    def test_chinese_english_and_mixed_language_manifests(self):
        for languages in (("Chinese",), ("English",), ("Chinese", "English")):
            for workflow in WORKFLOWS:
                with self.subTest(languages=languages, workflow=workflow.name), tempfile.TemporaryDirectory() as tmp:
                    root = Path(tmp)
                    (root / "data").mkdir()
                    (root / "assets").mkdir()
                    expected = sorted(
                        (
                            f"{date}_AI_enhanced_{language}.jsonl"
                            for date in ("2026-10-02", "2026-10-05")
                            for language in languages
                        ),
                        reverse=True,
                    )
                    for name in expected:
                        (root / "data" / name).write_text("{}\n", encoding="utf-8")
                    (root / "data/2026-10-05.jsonl").write_text("{}\n", encoding="utf-8")
                    (root / "assets/file-list.txt").write_text("2026-10-05.jsonl\n")
                    result = self.run_manifest(workflow, root)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(
                        (root / "assets/file-list.txt").read_text().splitlines(), expected
                    )

    def test_partial_daily_manifest_is_replaced_by_complete_history(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "data").mkdir()
                (root / "assets").mkdir()
                names = [
                    "2026-10-05_AI_enhanced_English.jsonl",
                    "2026-10-02_AI_enhanced_English.jsonl",
                ]
                for name in names:
                    (root / "data" / name).touch()
                manifest = root / "assets/file-list.txt"
                manifest.write_text("2026-10-05.jsonl\n" + names[0] + "\n")
                result = self.run_manifest(workflow, root)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(manifest.read_text().splitlines(), names)

    def test_rerun_is_idempotent(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "data").mkdir()
                (root / "data/2026-10-05_AI_enhanced_English.jsonl").touch()
                result = self.run_manifest(workflow, root)
                self.assertEqual(result.returncode, 0, result.stderr)
                expected = (root / "assets/file-list.txt").read_bytes()
                result = self.run_manifest(workflow, root)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual((root / "assets/file-list.txt").read_bytes(), expected)

    def test_empty_data_fails_without_replacing_existing_manifest(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "data").mkdir()
                (root / "assets").mkdir()
                manifest = root / "assets/file-list.txt"
                manifest.write_text("existing-history\n")
                result = self.run_manifest(workflow, root)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(manifest.read_text(), "existing-history\n")

    def test_find_failure_does_not_replace_existing_manifest(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / "assets").mkdir()
                manifest = root / "assets/file-list.txt"
                manifest.write_text("existing-history\n")
                result = self.run_manifest(workflow, root)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(manifest.read_text(), "existing-history\n")

    def test_publication_rebuilds_after_restore_and_before_staging(self):
        workflow = WORKFLOWS[0].read_text(encoding="utf-8")
        checkout = workflow.index("git checkout data")
        restore = workflow.index("cp -r /tmp/data_files/data/* data/")
        rebuild = workflow.index('manifest="$(mktemp)"')
        stage = workflow.index("git add assets/file-list.txt")
        commit = workflow.index('git commit -m "update: $today arXiv papers"')
        self.assertLess(checkout, restore)
        self.assertLess(restore, rebuild)
        self.assertLess(rebuild, stage)
        self.assertLess(stage, commit)
        self.assertNotIn("cp /tmp/data_files/assets/file-list.txt", workflow)
        self.assertNotIn("ls data/*.jsonl", workflow)

    def test_manifest_blocks_have_valid_bash_syntax(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow.name):
                result = subprocess.run(
                    ["bash", "-n"], input=manifest_script(workflow),
                    text=True, capture_output=True, timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
