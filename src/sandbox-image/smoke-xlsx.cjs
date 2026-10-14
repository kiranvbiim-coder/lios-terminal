'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('/opt/lios/node_modules/xlsx');
const filename = path.join(os.tmpdir(), `lios-smoke-${process.pid}.xlsx`);
try {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['key', 'value'], ['known-cell', 'LIOS_OFFLINE_XLSX_SMOKE']]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Smoke');
  XLSX.writeFile(workbook, filename, { bookType: 'xlsx' });
  const parsed = XLSX.readFile(filename, { cellDates: false });
  if (parsed.Sheets.Smoke.B2?.v !== 'LIOS_OFFLINE_XLSX_SMOKE') throw new Error('Known XLSX cell did not round-trip.');
} finally {
  try { fs.unlinkSync(filename); } catch {}
}
