# Reader tools

Both language sites use the same reader, loader, styling and tests. The existing
`DATA_CONFIG.repoName` selects Chinese or English labels. No accounts, tracking
service, new AI calls or changes to paper-generation jobs are needed.

## Using the reader

- **Matches first** retains nonmatching papers; **Matching only** hides them.
  Search covers IDs, titles, authors, categories, the original abstract and AI
  explanations. Space-separated terms use AND. Quote a phrase, prefix a term
  with `-` to exclude it, or use `title:`, `author:`, `id:` and `cat:`.
  Example: `"canonical differential equations" -cosmology`.
  Text search takes precedence over the existing interest tags; clearing it
  restores the previous interest selection.
- **Category** buttons and card tags are limited to `DATA_CONFIG.categories`,
  which matches the site's configured `CATEGORIES` (keep them aligned when
  changing the site's scope). Incoming cross-listed papers remain under their
  in-scope categories, with a quiet **Cross-listed · primary: …** note rather
  than extra category buttons. Full categories remain in details and `cat:`
  search; neither metadata nor papers are deleted. In-scope primary categories
  are not marked as incoming cross-lists.
- **Unread** means not explicitly marked read. Opening a paper does not mark it
  read. Read, read-later and saved are independent, reversible marks.
- **Read later / Saved** show snapshots saved across dates, not just the current
  batch. Search and category selection still apply to these views.
- **Copy view link** shares the dates, query, category, mode and interest tags.
  It deliberately omits the private reading-state filter. **Copy paper link**
  opens a specific paper/date regardless of the recipient's preferences.
  The language link preserves the paper or public filter state, not local marks.
- The local reading-list panel exports a JSON backup, merges an imported backup
  (newer record wins), or exports the current results as Markdown. Imported
  metadata is validated and displayed as text, never executed as markup.
- PDF previews load only when requested. The original abstract and arXiv links
  remain accessible; AI explanations are explicitly described as abstract-based.

Reading state uses `localStorage` under `heps.reader.v1`. It is private to the
browser origin, so CN, EN and different devices do not synchronize automatically.
Backups can transfer a list. Saved text is a snapshot in its original language.
Storage failures are visible and fall back to in-page state; export before closing.
Invalid imports leave existing data unchanged. Corrupt pre-existing storage is not
automatically overwritten; its original contents can be exported for recovery.

## Completeness and date semantics

The status bar reports which files in the **site's existing manifest** were loaded.
It is not a claim that every arXiv announcement has been independently checked.
File dates remain the site's historical data dates, not newly inferred arXiv
announcement or version dates. A date without a file is not labeled an arXiv
no-announcement day.

Partial loads list failed dates and retry only those dates. Malformed JSONL files
fail as a unit instead of silently dropping bad rows. Older asynchronous requests
cannot overwrite a newer date selection. Successful files have a bounded,
two-minute in-memory cache; errors are not cached. Range views deduplicate paper
IDs and retain cross-list categories. This release does not infer missing version
metadata or automatically backfill historical announcements.

## Maintenance and testing

```sh
node --test tests/reader-core.test.cjs
python3 -B -m unittest discover -s tests -v
node tests/reader-browser.cjs
python3 tests/reader-symmetry.py ../hepstoday-cn ../hepstoday-en
```

The browser test requires Node 22+ and Chrome (`CHROME_BIN` may override the
executable). It serves the real checkout using deterministic fixtures, blocks
external requests, and exercises desktop/mobile layouts, filtering, local lists,
links/history, failure/retry, malformed data, request races, HTML-safe rendering
and unavailable storage. It does not call arXiv or an AI service. Screenshots go
to a temporary directory or `HEPS_SCREENSHOTS`.

`Reader checks` runs these tests on relevant pushes and pull requests. After
updating both sites, manually dispatch it with `check_peer=true` to compare
shared code against the other repository. The comparison permits only repository
identity substitutions in `index.html` and `js/data-config.js`; shared reader
logic, loader, styles and tests must be byte-identical. Other pre-existing,
unmodified site-specific files are outside that check.
