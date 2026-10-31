/**
 * Recruiting lead email -> portal sync (Google Apps Script).
 *
 * Runs inside kristina@wattsfamilyagency.com. Every minute it looks for two kinds of email:
 *   - Appcast "NEW APPLICATION" (no-reply@app-cast.com): one per application, the first
 *     to arrive. Name, phone, email, state, licensing answers; the resume is an attachment.
 *   - Quility "New Lead Allocation" (leads@quility.com), Lead Type Recruiting: arrives later.
 *     Adds the ACRN order number and the resume link.
 * Each is parsed and sent to POST /api/leads-ingest (action upsert_recruiting_lead), which
 * creates the lead for SFG0049415, or, if that phone is already a lead, only fills in the
 * ACRN number and resume link it was missing.
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
 *
 * Appcast puts every applicant for the same posting in one Gmail thread (same subject), so
 * a thread can gain messages after it was labeled. A message in an already-labeled thread
 * is picked up because the unlabeled new message still matches the search; messages older
 * than the search window are ignored, and re-sending one that was already handled is harmless.
 */

var DEFAULT_URL = 'https://agents.wattsfamilyagency.com/api/leads-ingest'
var WINDOW_DAYS = 7
var QUERY = '((from:leads@quility.com subject:"New Lead Allocation") OR ' +
  '(from:no-reply@app-cast.com subject:"NEW APPLICATION")) newer_than:' + WINDOW_DAYS + 'd ' +
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
    var cutoff = new Date(Date.now() - WINDOW_DAYS * 86400000)

    GmailApp.search(QUERY, 0, 50).forEach(function (thread) {
      var messages = thread.getMessages()
      var recruiting = 0
      var problem = '' // '' | 'error' | 'retry'
      messages.forEach(function (msg) {
        if (msg.getDate() < cutoff) return
        var html = msg.getBody()
        var appcast = /app-cast\.com/i.test(msg.getFrom())
        if (!appcast && !/^recruiting/i.test(labelValues_(html)['Lead Type'] || '')) return
        recruiting++
        var row = appcast ? parseAppcastEmail_(html, msg.getDate()) : parseAllocationEmail_(html, msg.getDate())
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
      // A message that arrived while we worked would be labeled unseen; leave the thread for the next run.
      if (GmailApp.getThreadById(thread.getId()).getMessageCount() !== messages.length) return
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
 * Quility allocation emails are an HTML table of label / value cell pairs
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

/**
 * Appcast application emails:
 *   <h2>Life Insurance Sales Agent In Vancouver, WA (req # 1234)</h2>
 *   <li>Name: <b>Marco Rodriguez</b></li> ... Phone, Email ...
 *   <li>Are you currently licensed to sell life insurance?: <b> No</b></li> ... five questions
 * "req # 1234" is the job posting, shared by every applicant to it, so it is NOT sent as the
 * requisition (the portal would treat different people as duplicates). The resume is an
 * attachment; the later Quility allocation email supplies a link.
 */
function parseAppcastEmail_(html, date) {
  var f = {}
  var re = /<li[^>]*>((?:(?!<\/?li)[\s\S])*?)<b>((?:(?!<\/?li)[\s\S])*?)<\/b>\s*<\/li>/gi
  var m
  while ((m = re.exec(html))) {
    var k = stripTags_(m[1]).replace(/:\s*$/, '')
    if (k && !(k in f)) f[k] = stripTags_(m[2])
  }
  var answerTo = function (pattern) {
    for (var q in f) if (pattern.test(q)) return f[q]
    return ''
  }
  var h2 = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)
  var job = h2 ? stripTags_(h2[1]).replace(/\s*\(req\s*#[^)]*\)\s*$/i, '') : ''

  var row = {
    status: 'New Recruit',
    name: f['Name'] || '',
    email: f['Email'] || '',
    phone: f['Phone'] || '',
    state: answerTo(/which u\.?s\.? state|reside/i),
    apply_date: Utilities.formatDate(date, TZ, 'yyyy-MM-dd'),
    job: job,
    licensed: answerTo(/currently licensed/i),
    willing: answerTo(/willing/i),
    commission_ok: answerTo(/1099|commission/i),
  }
  return row.name && (row.phone || row.email) ? row : null
}
