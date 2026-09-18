import * as XLSX from 'xlsx'
import Papa from 'papaparse'
import { parseSnapshotSheets } from '../../shared/snapshotFile'

// A workbook is a zip (.xlsx) or an OLE container (.xls); anything else is delimited text.
function isWorkbook(head) {
  return (head[0] === 0x50 && head[1] === 0x4b) || (head[0] === 0xd0 && head[1] === 0xcf)
}

/**
 * Reads a Snapshot upload and works out which export it is from its content, not
 * its extension — the same uploader takes the Snapshot workbook (.xlsx) and a
 * Placed Policies export (.csv, or a sheet).
 *
 * @returns {Promise<{ format, agents?, policies?, meta } | { error: string }>}
 */
export async function readSnapshotFile(file) {
  const buf  = await file.arrayBuffer()
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))

  let sheets
  if (isWorkbook(head)) {
    const wb = XLSX.read(buf, { type: 'array', cellDates: false })
    sheets = wb.SheetNames.map(name => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }),
    }))
  } else {
    // Text stays text: policy numbers keep their leading zeros and "Aug-26" is
    // never reinterpreted as a date the way a spreadsheet import would.
    const text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '')
    sheets = [{ name: file.name, rows: Papa.parse(text, { skipEmptyLines: 'greedy' }).data }]
  }
  return parseSnapshotSheets(sheets)
}
