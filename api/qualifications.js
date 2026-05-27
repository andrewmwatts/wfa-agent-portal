import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { google } from 'googleapis'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

const SHEET_ID  = '1fbkq51BkFOY07RY2pASi-lHCYfjEPzPUD5BvkZZxhTU'
const SHEET_TAB = 'Qualifications'

function parseAmt(str) {
  if (str == null || str === '') return null
  const n = parseFloat(str.toString().replace(/[$,]/g, ''))
  return isNaN(n) ? null : n
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    })
    const sheets = google.sheets({ version: 'v4', auth })

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_TAB}'`,
    })

    const rows = data.values
    if (!rows?.length) return res.status(200).json({ qualifications: {} })

    const headers = rows[0].map(h => h?.trim().toLowerCase() ?? '')

    // Column indices — flexible matching
    const idxLevel    = headers.findIndex(h => ['qualification', 'level', 'qual'].includes(h))
    const idxRegular  = headers.findIndex(h => ['regular', 'apv', 'monthly apv'].includes(h))
    const idxSlingshot = headers.findIndex(h => h === 'slingshot')
    const idxWriters  = headers.findIndex(h => h === 'writers')

    // Build level → { regular, slingshot, writers } map
    const qualifications = {}
    for (const row of rows.slice(1)) {
      const level = idxLevel !== -1 ? row[idxLevel]?.trim() : null
      if (!level) continue

      qualifications[level] = {
        regular:   parseAmt(idxRegular   !== -1 ? row[idxRegular]   : null),
        slingshot: parseAmt(idxSlingshot !== -1 ? row[idxSlingshot] : null),
        writers:   parseAmt(idxWriters   !== -1 ? row[idxWriters]   : null),
      }
    }

    return res.status(200).json({ qualifications })
  } catch (err) {
    console.error('[qualifications]', err)
    return res.status(500).json({ error: 'Failed to read qualifications data' })
  }
}
