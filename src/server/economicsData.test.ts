import test from "node:test";
import assert from "node:assert/strict";

import {
  filterUpcomingReleaseDates,
  parseFredCalendar,
  parseFredReleaseDetail,
  parseFredReleaseSchedule,
} from "./economicsData";

test("parseFredCalendar keeps only tracked macro events and normalizes their metadata", () => {
  const html = `
    <table>
      <tbody>
        <tr class="odd">
          <td text-align="left" colspan="2"><span style="font-weight: bold;">Wednesday March 18, 2026</span></td>
        </tr>
        <tr>
          <td nowrap style="width:5%; text-align:right">7:30 am</td>
          <td text-align="left"><a href="/release?rid=10">Consumer Price Index</a></td>
        </tr>
        <tr>
          <td nowrap style="width:5%; text-align:right">1:00 pm</td>
          <td text-align="left"><a href="/release?rid=326">Summary of Economic Projections</a></td>
        </tr>
        <tr>
          <td nowrap style="width:5%; text-align:right">N/A</td>
          <td text-align="left"><a href="/release?rid=209">ICE BofA Indices</a></td>
        </tr>
        <tr class="odd">
          <td text-align="left" colspan="2"><span style="font-weight: bold;">Thursday April 09, 2026</span></td>
        </tr>
        <tr>
          <td nowrap style="width:5%; text-align:right">7:30 am</td>
          <td text-align="left"><a href="/release?rid=53">Gross Domestic Product</a></td>
        </tr>
      </tbody>
    </table>
  `;

  assert.deepEqual(parseFredCalendar(html), [
    {
      id: "10:2026-03-18:7:30 AM CT",
      releaseId: 10,
      title: "Consumer Price Index",
      category: "inflation",
      importance: "high",
      date: "2026-03-18",
      timeCt: "7:30 AM CT",
      releaseUrl: "",
      status: { provider: "Limuria Intelligence", freshness: "schedule", asOf: null, delayLabel: "Scheduled release calendar", isFallback: false },
    },
    {
      id: "326:2026-03-18:1:00 PM CT",
      releaseId: 326,
      title: "Summary of Economic Projections",
      category: "policy",
      importance: "high",
      date: "2026-03-18",
      timeCt: "1:00 PM CT",
      releaseUrl: "",
      status: { provider: "Limuria Intelligence", freshness: "schedule", asOf: null, delayLabel: "Scheduled release calendar", isFallback: false },
    },
    {
      id: "53:2026-04-09:7:30 AM CT",
      releaseId: 53,
      title: "Gross Domestic Product",
      category: "growth",
      importance: "high",
      date: "2026-04-09",
      timeCt: "7:30 AM CT",
      releaseUrl: "",
      status: { provider: "Limuria Intelligence", freshness: "schedule", asOf: null, delayLabel: "Scheduled release calendar", isFallback: false },
    },
  ]);
});

test("parseFredReleaseDetail extracts official source links and top tables", () => {
  const html = `
    <html>
      <head><title>Gross Domestic Product | FRED | St. Louis Fed</title></head>
      <body>
        <nav id="site-breadcrumbs">
          <a class="breadcrumb_link" href="/sources">Sources</a>
          <a class="breadcrumb_link" href="/source?soid=18">U.S. Bureau of Economic Analysis</a>
        </nav>
        <div id="page-title"><h1>Gross Domestic Product</h1></div>
        <div class="release-sidebar-link-box">
          <ul>
            <li><a href="/releases/calendar?rid=53&amp;y=2026">Release Calendar</a></li>
            <li><a href="https://www.bea.gov/data/gdp/gross-domestic-product" target="_blank" rel="nofollow">Release Website</a></li>
          </ul>
        </div>
        <li style="padding-right:5px; padding-left:15px">
          <a aria-describedby="13690-avail-records" href="/release/tables?rid=53&eid=13690">Section 1 - Domestic Product and Income</a>&nbsp;
          <span id="13690-avail-records" aria-label="2,820 records">(2,820)</span>
        </li>
        <li style="padding-right:5px; padding-left:15px">
          <a aria-describedby="4081-avail-records" href="/release/tables?rid=53&eid=4081">Section 2 - Personal Income and Outlays</a>&nbsp;
          <span id="4081-avail-records" aria-label="1,475 records">(1,475)</span>
        </li>
      </body>
    </html>
  `;

  assert.deepEqual(parseFredReleaseDetail(html, 53), {
    releaseId: 53,
    title: "Gross Domestic Product",
    category: "growth",
    importance: "high",
    sourceName: "Limuria Intelligence Research",
    sourceUrl: null,
    releaseCalendarUrl: "",
    releaseWebsiteUrl: null,
    tables: [],
    status: { provider: "Limuria Intelligence", freshness: "schedule", asOf: null, delayLabel: "Scheduled release detail", isFallback: false },
  });
});

test("parseFredReleaseSchedule returns upcoming dates for a specific release", () => {
  const html = `
    <table>
      <tbody>
        <tr class="odd"><td colspan="2"><span style="font-weight: bold;">Thursday April 09, 2026</span></td></tr>
        <tr><td nowrap style="width:5%; text-align:right">7:30 am</td><td text-align="left"><a href="/release?rid=53">Gross Domestic Product</a></td></tr>
        <tr class="odd"><td colspan="2"><span style="font-weight: bold;">Thursday April 30, 2026</span></td></tr>
        <tr><td nowrap style="width:5%; text-align:right">7:30 am</td><td text-align="left"><a href="/release?rid=53">Gross Domestic Product</a></td></tr>
      </tbody>
    </table>
  `;

  assert.deepEqual(parseFredReleaseSchedule(html, 53), [
    { date: "2026-04-09", timeCt: "7:30 AM CT" },
    { date: "2026-04-30", timeCt: "7:30 AM CT" },
  ]);
});

test("filterUpcomingReleaseDates removes past releases and duplicate schedule rows", () => {
  const schedule = [
    { date: "2026-01-14", timeCt: "7:30 AM CT" },
    { date: "2026-03-18", timeCt: "7:30 AM CT" },
    { date: "2026-03-18", timeCt: "7:30 AM CT" },
    { date: "2026-04-09", timeCt: "7:30 AM CT" },
  ];

  assert.deepEqual(filterUpcomingReleaseDates(schedule, new Date("2026-03-17T12:00:00.000Z")), [
    { date: "2026-03-18", timeCt: "7:30 AM CT" },
    { date: "2026-04-09", timeCt: "7:30 AM CT" },
  ]);
});
