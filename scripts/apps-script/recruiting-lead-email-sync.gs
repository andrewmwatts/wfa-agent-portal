/**
 * Recruiting lead email -> portal sync (Google Apps Script).
 *
 * Runs inside kristina@wattsfamilyagency.com. Every minute it looks for Quility's
 * "New Lead Allocation" emails whose Lead Type is "Recruiting Lead", parses the
 * lead, and sends it to POST /api/leads-ingest (action upsert_recruiting_lead),
 * which creates the lead for SFG0049415 unless that phone/requisition already exists.
 *
 * Setup (once)
 *   1. script.google.com > New project, signed in as kristina@wattsfamilyagency.com.
 *      Paste this file over Code.gs.
 *   2. Project Settings > Script properties > add WFA_INGEST_SECRET (same value as the
 *      Vercel env var of that name). Optional: WFA_INGEST_URL to override the default.
 *   3. Run syncRecruitingLeads once from the editor and approve the Gmail / external
 *      request permissions.
 *   4. Triggers > Add trigger > syncRecruitingLeads > Time-driven > Every minute.
 *
 * Gmail labels this script creates: wfa-recruiting-synced (done, including
 * "already in the portal"), wfa-recruiting-skipped (not a recruiting lead),
 * wfa-recruiting-error (could not parse; also logged to parse_errors).
 * A failed request (portal down) is left unlabeled and retried the next minute.
 */

var DEFAULT_URL = 'https://agents.wattsfamilyagency.com/api/leads-ingest'
var QUERY = 'from:leads@quility.com subject:"New Lead Allocation" newer_than:7d ' +
  '-label:wfa-recruiting-synced -label:wfa-recruiting-skipped -label:wfa-recruiting-error'
var TZ = 'America/Los_Angeles'

function syncRecruitingLeads() {
  var props = PropertiesService.getScriptProperties()
  var secret = props.getProperty('WFA_INGEST_SECRET')
  if (!secret) throw new Error('Set the WFA_INGEST_SECRET script property')
  var url = props.getProperty('WFA_INGEST_URL') || DEFAULT_URL

  var lock = LockService.getScriptLock()
  if (!lock.tryLock(30000)) return
  try {
    var synced = label_('wfa-recruiting-synced')
    var skipped = label_('wfa-recruiting-skipped')
    var failed = label_('wfa-recruiting-error')

    GmailApp.search(QUERY, 0, 50).forEach(function (thread) {
      var recruiting = 0
      var problem = '' // '' | 'error' | 'retry'
      thread.getMessages().forEach(function (msg) {
        var html = msg.getBody()
        if (!/^recruiting/i.test(labelValues_(html)['Lead Type'] || '')) return
        recruiting++
        var row = parseAllocationEmail_(html, msg.getDate())
        if (!row) {
          post_(url, secret, { action: 'insert_error', error: {
            sender: msg.getFrom(), subject: msg.getSubject(),
            reason: 'recruiting lead email: could not parse', body_snippet: msg.getPlainBody().slice(0, 500) } })
          if (problem !== 'retry') problem = 'error'
          return
        }
        var res = post_(url, secret, { action: 'upsert_recruiting_lead', row: row })
        var code = res.getResponseCode()
        if (code >= 200 && code < 300) return
        console.error('upsert_recruiting_lead ' + code + ': ' + res.getContentText().slice(0, 300))
        problem = code === 400 && problem !== 'retry' ? 'error' : 'retry'
      })
      if (problem === 'retry') return
      thread.addLabel(problem === 'error' ? failed : recruiting ? synced : skipped)
    })
  } finally {
    lock.releaseLock()
  }
}

function label_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name)
}

function post_(url, secret, payload) {
  return UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-WFA-Secret': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  })
}

function stripTags_(s) {
  return String(s).replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim()
}

/**
 * The allocation email is an HTML table of label / value cell pairs
 * (Lead Type | Recruiting, Lead Name | ..., Email | ..., Title1 | <question>, Answer1 | ...).
 * Returns { label: value }. Plain text is no use here: the email has no text/plain part,
 * and the text Gmail derives from it runs the cells together.
 */
function labelValues_(html) {
  var out = {}
  var re = /<td[^>]*>((?:(?!<\/?td)[\s\S])*)<\/td>\s*<td[^>]*>((?:(?!<\/?td)[\s\S])*)<\/td>/gi
  var m
  while ((m = re.exec(html))) {
    var k = stripTags_(m[1])
    if (k && !(k in out)) out[k] = stripTags_(m[2])
  }
  return out
}

/**
 * Returns the `row` object upsert_recruiting_lead expects, or null if name/contact are missing.
 * The requisition is in the greeting: "You have a new lead for order #ACRN-00006593."
 */
function parseAllocationEmail_(html, date) {
  var f = labelValues_(html)
  var answerTo = function (pattern) {
    for (var i = 1; f['Title' + i] !== undefined; i++) if (pattern.test(f['Title' + i])) return f['Answer' + i] || ''
    return ''
  }
  var licensing = f['Licensing'] || ''
  var order = stripTags_(html).match(/order\s+#\s*(ACRN-\d+)/i)

  var row = {
    status: 'New Recruit',
    name: f['Lead Name'] || '',
    email: f['Email'] || '',
    phone: f['Phone'] || '',
    state: ((f['Address'] || '').match(/,\s*([A-Z]{2})\s+\d{5}/) || [])[1] || '',
    apply_date: Utilities.formatDate(date, TZ, 'yyyy-MM-dd'),
    requisition: order ? order[1] : '',
    licensed: licensing ? (/^unlicensed/i.test(licensing) ? 'No' : 'Yes') : '',
    willing: answerTo(/willing/i),
    commission_ok: answerTo(/1099|commission/i),
    resume_url: f['Resumelink'] || '',
  }
  return row.name && (row.phone || row.email) ? row : null
}
