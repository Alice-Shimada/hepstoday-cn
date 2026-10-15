"""Listing metadata reaches the feed even when the API is unavailable."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scrapy.http import HtmlResponse

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


Spider = load('listing_spider', 'daily_arxiv/daily_arxiv/spiders/arxiv.py').ArxivSpider
Pipeline = load('listing_pipeline', 'daily_arxiv/daily_arxiv/pipelines.py').DailyArxivPipeline
validate = load('listing_gate', 'daily_arxiv/daily_arxiv/check_crawl.py').validate
FAILED_IDS = ('2610.14144', '2610.14211', '2610.14418', '2610.15332',
              '2610.18863', '2610.14354', '2610.15411')


def entry(index, paper_id, primary='hep-th', comments=True):
    return f'''<dt><a name="item{index}">[{index}]</a>
      <a title="Abstract" href="/abs/{paper_id}">{paper_id}</a></dt>
    <dd><div class="meta">
      <div class="list-title mathjax"><span class="descriptor">Title:</span>
        A $\\mathcal{{N}}=4$ &amp; <em>gravity</em> test</div>
      <div class="list-authors"><a>A. Author</a>, <a>ATLAS Collaboration</a></div>
      {('<div class="list-comments mathjax"><span class="descriptor">Comments:</span> 12 pages</div>' if comments else '')}
      <div class="list-subjects"><span class="descriptor">Subjects:</span>
        <span class="primary-subject">Theory ({primary})</span>; Physics (hep-ph)
      </div><p class="mathjax">An abstract with $x^2$ &lt; 1 and <em>inline</em> text.</p>
    </div></dd>'''


def response(entries):
    html = ('<div id="dlpage"><ul><li><a href="#item0">New</a></li>'
            '<li><a href="#item8">Cross-lists</a></li>'
            '<li><a href="#item10">Replacements</a></li></ul>'
            '<dl>' + entries + '</dl></div>')
    return HtmlResponse(url='https://arxiv.org/list/hep-th/new', body=html.encode(), encoding='utf-8')


class ListingMetadataTests(unittest.TestCase):
    def setUp(self):
        with patch.dict(os.environ, CATEGORIES='hep-th, hep-ph'):
            self.spider = Spider()

    def test_oct15_ids_export_without_api_and_pass_gate(self):
        page = response(''.join(entry(i, pid) for i, pid in enumerate(FAILED_IDS, 1)))
        with patch('requests.sessions.Session.request', side_effect=AssertionError('No API calls')):
            items = [Pipeline().process_item(item, self.spider) for item in self.spider.parse(page)]
        self.assertEqual({p['id'] for p in items}, set(FAILED_IDS))
        for paper in items:
            self.assertEqual(paper['title'], r'A $\mathcal{N}=4$ & gravity test')
            self.assertEqual(paper['authors'], ['A. Author', 'ATLAS Collaboration'])
            self.assertEqual(paper['categories'], ['hep-th', 'hep-ph'])
            self.assertEqual(paper['comment'], '12 pages')
            self.assertEqual(paper['summary'], 'An abstract with $x^2$ < 1 and inline text.')
            self.assertEqual(paper['pdf'], f"https://arxiv.org/pdf/{paper['id']}")
            self.assertEqual(paper['abs'], f"https://arxiv.org/abs/{paper['id']}")
        with tempfile.TemporaryDirectory() as tmp:
            log, feed = Path(tmp) / 'crawl.log', Path(tmp) / 'feed.jsonl'
            log.write_text(''.join(f"2026-10-15 00:00:00 [arxiv] INFO: Found paper {p} with categories {{'hep-th'}}\n" for p in FAILED_IDS)
                           + '2026-10-15 00:00:01 [scrapy.core.engine] INFO: Spider closed (finished)\n')
            feed.write_text(''.join(json.dumps(p) + '\n' for p in items))
            validate(log, feed)
            feed.write_text(''.join(json.dumps(p) + '\n' for p in items[1:]))
            with self.assertRaisesRegex(ValueError, FAILED_IDS[0]):
                validate(log, feed)

    def test_primary_filter_cross_lists_and_replacements_unchanged(self):
        page = response(entry(1, '2610.00001', comments=False)
                        + entry(8, '2610.00002', primary='hep-ph')
                        + entry(9, '2610.00003', primary='quant-ph')
                        + entry(10, '2610.00004'))
        items = list(self.spider.parse(page))
        self.assertEqual([p['id'] for p in items], ['2610.00001', '2610.00002'])
        self.assertIsNone(items[0]['comment'])
        self.assertEqual(items[1]['categories'][0], 'hep-ph')

    def test_missing_abstract_still_blocks_publication(self):
        page = response(entry(1, '2610.00001').replace('<p class="mathjax">', '<p>'))
        item, = self.spider.parse(page)
        with tempfile.TemporaryDirectory() as tmp:
            log, feed = Path(tmp) / 'crawl.log', Path(tmp) / 'feed.jsonl'
            log.write_text('2026-10-15 00:00:01 [scrapy.core.engine] INFO: Spider closed (finished)\n')
            feed.write_text(json.dumps(item))
            with self.assertRaisesRegex(ValueError, 'Incomplete paper metadata'):
                validate(log, feed)


if __name__ == '__main__':
    unittest.main()
