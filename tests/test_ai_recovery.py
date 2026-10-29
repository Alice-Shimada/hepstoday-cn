"""Recover model JSON without losing the paper or hiding failed AI fields."""
from contextlib import chdir, redirect_stderr
import io
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from langchain_core.exceptions import OutputParserException

ROOT = Path(__file__).resolve().parents[1]


class AIRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with chdir(ROOT / "ai"), patch.object(sys, "path", [str(ROOT / "ai"), *sys.path]):
            cls.process = staticmethod(runpy.run_path(str(ROOT / "ai/enhance.py"))["process_single_item"])

    def setUp(self):
        self.paper = {"id": "2610.30325", "title": "Spin correlations", "summary": "A physics abstract."}
        self.fields = {key: key + " text" for key in ("tldr", "motivation", "method", "result", "conclusion")}

    def call(self, chain):
        stderr = io.StringIO()
        with patch("requests.sessions.Session.request", side_effect=AssertionError("Unexpected network access")), redirect_stderr(stderr):
            result = self.process(chain, dict(self.paper), "English")
        self.assertEqual({key: result[key] for key in self.paper}, self.paper)
        return result, stderr.getvalue()

    def parser_failure(self, arguments):
        chain = Mock()
        chain.invoke.side_effect = OutputParserException(
            "Function Structure arguments:\n" + arguments + "\nare not valid JSON. Received JSONDecodeError."
        )
        return chain

    def test_valid_structured_output_is_unchanged(self):
        chain = Mock()
        chain.invoke.return_value = SimpleNamespace(model_dump=lambda: dict(self.fields))
        result, stderr = self.call(chain)
        self.assertEqual(result["AI"], self.fields)
        self.assertNotIn("::warning::", stderr)

    def test_unescaped_newline_and_latex_are_recovered(self):
        arguments = ('{"tldr":"A tau-pair study",'
                     '"motivation":"First line\nSecond line",'
                     '"method":"Use $\\tau$ spin correlations",'
                     '"result":"A spin matrix",'
                     '"conclusion":"Polarization is included"}')
        result, stderr = self.call(self.parser_failure(arguments))
        self.assertEqual(result["AI"], {
            "tldr": "A tau-pair study", "motivation": "First line\nSecond line",
            "method": r"Use $\tau$ spin correlations", "result": "A spin matrix",
            "conclusion": "Polarization is included",
        })
        self.assertNotIn("::warning::", stderr)

    def test_unrecoverable_json_warns_and_keeps_original_paper(self):
        result, stderr = self.call(self.parser_failure('{"tldr":'))
        self.assertEqual(result["AI"]["tldr"], "Summary generation failed")
        self.assertIn("::warning::", stderr)
        self.assertIn(self.paper["id"], stderr)
        for key in self.fields:
            self.assertIn(key, stderr)

    def test_missing_ai_field_warns_without_discarding_good_fields(self):
        fields = dict(self.fields)
        del fields["result"]
        chain = Mock()
        chain.invoke.return_value = SimpleNamespace(model_dump=lambda: fields)
        result, stderr = self.call(chain)
        self.assertEqual(result["AI"]["tldr"], self.fields["tldr"])
        self.assertEqual(result["AI"]["result"], "Result analysis unavailable")
        self.assertIn("::warning::", stderr)
        self.assertIn("result", stderr)
        self.assertIn(self.paper["id"], stderr)


if __name__ == "__main__":
    unittest.main()
