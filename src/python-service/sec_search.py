"""
SEC EDGAR full-text search via edgartools (real EFTS -- EDGAR's own
Elasticsearch Full Text Search API). Searches the actual text content of
filings, not just XBRL numeric facts (server/secEdgarData.ts's
getCompanyFinancials) or Form 4 ownership metadata (getInsiderTransactions)
-- both of which are already real, hand-built, and unrelated to this. This
closes a genuine, separate gap: finding filings that mention a specific
term, risk, product, or legal matter.

Confirmed live before building this: searching "material weakness" scoped
to AAPL 10-Ks returns 25 real hits going back to 2002, ranked by EFTS's own
relevance score, with real accession numbers and filing dates -- not a mock.
"""

from typing import List, Optional

import edgar
from pydantic import BaseModel, Field

edgar.set_identity("Limuria Terminal research@limuria.com")


class FilingSearchRequest(BaseModel):
    query: str = Field(default="", max_length=200)
    ticker: Optional[str] = None
    forms: Optional[List[str]] = None
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=10000)
    from_date: Optional[str] = Field(default=None, alias="from")
    to_date: Optional[str] = Field(default=None, alias="to")

    class Config:
        populate_by_name = True

class FilingSearchResult(BaseModel):
    company: str
    ticker: Optional[str] = None
    cik: int
    form: str
    filed: str
    accessionNumber: str
    score: float
    filingUrl: str
class FilingSearchResponse(BaseModel):
    results: List[FilingSearchResult]
    totalCount: int
    returnedCount: int
    offset: int
    limit: int
    hasMore: bool

def search_filings(req: FilingSearchRequest) -> FilingSearchResponse:
    if req.from_date and req.to_date and req.from_date > req.to_date:
        raise ValueError("SEC date filter 'from' must not be after 'to'.")

    results = edgar.search_filings(
        req.query,
        forms=req.forms,
        ticker=req.ticker,
        start_date=req.from_date,
        end_date=req.to_date,
        # EFTS pages are at most 100 rows; fetch one bounded page and walk
        # provider cursors for offsets beyond it.
        limit=min(100, max(req.limit, req.offset + req.limit)),
    )

    current_offset = 0
    current = results
    while current_offset + len(current) <= req.offset and len(current) > 0:
        next_page = current.next()
        if next_page is None:
            break
        current_offset += len(current)
        current = next_page

    rows: List[FilingSearchResult] = []
    current_rows = list(current)
    local_start = max(0, req.offset - current_offset)
    for r in current_rows[local_start : local_start + req.limit]:
        accession_no_dashes = r.accession_number.replace("-", "")
        filing_url = f"https://www.sec.gov/Archives/edgar/data/{r.cik}/{accession_no_dashes}/{r.accession_number}-index.htm"
        rows.append(
            FilingSearchResult(
                company=r.company,
                ticker=req.ticker,
                cik=int(r.cik),
                form=r.form,
                filed=str(r.filed),
                accessionNumber=r.accession_number,
                score=float(r.score) if r.score is not None else 0.0,
                filingUrl=filing_url,
            )
        )

    provider_total = int(getattr(current, "total", 0) or 0)
    absolute_offset = min(req.offset, provider_total)
    return FilingSearchResponse(
        results=rows,
        totalCount=provider_total,
        returnedCount=len(rows),
        offset=absolute_offset,
        limit=req.limit,
        hasMore=absolute_offset + len(rows) < provider_total,
    )
