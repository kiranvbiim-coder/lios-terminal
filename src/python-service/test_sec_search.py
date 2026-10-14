import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sec_search import FilingSearchRequest, search_filings


class FakeSearch:
    def __init__(self, rows, total, next_page=None):
        self.results = rows
        self.total = total
        self._next_page = next_page

    def __iter__(self):
        return iter(self.results)

    def __len__(self):
        return len(self.results)

    def next(self):
        return self._next_page


class SecSearchTests(unittest.TestCase):
    def test_offset_uses_next_pages_and_provider_total(self):
        first = [SimpleNamespace(company="A", cik="1", form="10-K", filed="2026-03-01", accession_number="0001-01", score=1.0)]
        second = [SimpleNamespace(company="B", cik="2", form="10-Q", filed="2026-02-01", accession_number="0002-01", score=2.0)]
        with patch("sec_search.edgar.search_filings", return_value=FakeSearch(first, 2, FakeSearch(second, 2))):
            response = search_filings(FilingSearchRequest(query="risk", limit=1, offset=1))
        self.assertEqual(response.results[0].company, "B")
        self.assertEqual(response.totalCount, 2)
        self.assertEqual(response.returnedCount, 1)
        self.assertFalse(response.hasMore)

    def test_dates_are_forwarded(self):
        with patch("sec_search.edgar.search_filings", return_value=FakeSearch([], 0)) as search:
            search_filings(FilingSearchRequest(query="risk", **{"from": "2026-01-01", "to": "2026-02-01"}))
        self.assertEqual(search.call_args.kwargs["start_date"], "2026-01-01")
        self.assertEqual(search.call_args.kwargs["end_date"], "2026-02-01")


if __name__ == "__main__":
    unittest.main()
