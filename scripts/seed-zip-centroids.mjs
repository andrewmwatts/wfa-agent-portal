/**
 * Seeds the zip_centroids table from the US Census ZCTA Gazetteer file.
 *
 * The Census publishes this as a .zip archive, and Node has no built-in
 * archive reader, so download and extract it manually first:
 *
 *   1. https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip
 *   2. Unzip it — you'll get 2023_Gaz_zcta_national.txt (tab-delimited, ~33k rows)
 *   3. node scripts/seed-zip-centroids.mjs path/to/2023_Gaz_zcta_national.txt
 *
 * Columns used: GEOID (the ZCTA5 code), INTPTLAT, INTPTLONG.
 *
 * Note: ZCTAs are not a perfect 1:1 with USPS ZIP codes — PO-box-only and
 * some single-building ZIPs have no ZCTA and will be absent. Agents in those
 * ZIPs simply won't plot; the map surfaces the count of unmapped agents.
 *
 * Run against the same project your .env.local points at. Requires
 * SUPABASE_SERVICE_ROLE_KEY (writes bypass RLS).
 */
import { config as loadEnv } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/seed-zip-centroids.mjs <path-to-gazetteer.txt>')
  process.exit(1)
}

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key)

const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)
const header = lines[0].split('\t').map(h => h.trim().toUpperCase())
const iZip = header.indexOf('GEOID')
const iLat = header.indexOf('INTPTLAT')
const iLng = header.indexOf('INTPTLONG')

if (iZip < 0 || iLat < 0 || iLng < 0) {
  console.error('Unexpected header — need GEOID, INTPTLAT, INTPTLONG. Got:', header.join(', '))
  process.exit(1)
}

const rows = []
for (const line of lines.slice(1)) {
  const cols = line.split('\t')
  const zip = (cols[iZip] ?? '').trim()
  const lat = parseFloat(cols[iLat])
  const lng = parseFloat(cols[iLng])
  if (!/^\d{5}$/.test(zip) || isNaN(lat) || isNaN(lng)) continue
  rows.push({ zip, lat, lng })
}

console.log(`Parsed ${rows.length} ZCTA centroids from ${file}`)

let written = 0
const CHUNK = 1000
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK)
  const { error } = await supabase.from('zip_centroids').upsert(chunk, { onConflict: 'zip' })
  if (error) {
    console.error(`Chunk at ${i} failed:`, error.message)
    process.exit(1)
  }
  written += chunk.length
  process.stdout.write(`\rUpserted ${written}/${rows.length}`)
}

console.log(`\nDone — ${written} rows in zip_centroids.`)
