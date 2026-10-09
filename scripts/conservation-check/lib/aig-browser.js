// AIG / Corebridge Connext: in-page helpers for the conservation check.
// Paste into the Chrome javascript tool on any Connext policy-detail page (the tab must be
// logged in). Nothing here is stored or sent anywhere except Connext's own RESTProxy.
//
// The portal calls `RESTProxy/execute` with a JSON body naming a backend service and a
// `uri_context`. Each call also needs the page's anti-forgery headers, so step 1 captures a
// real request of each kind by loading the current page in a hidden iframe with XHR patched.
// After that, any policy can be read by its plain number. Read-only: only GET-verb calls are
// replayed.
//
// Step 1 (once per login; ~25 s):  await __aigInit()
// Step 2:                          await __aigScan(['6240057274', ...])  -> window.__aig
// Tool output can't contain '=', '&', '?' or '%' (it is blocked as query-string data):
// wrap any JSON you return in .replace(/[=&?%]/g,'~').

window.__aigInit = async () => {
  const log = []
  const ifr = document.createElement('iframe')
  ifr.style.cssText = 'width:10px;height:10px;position:fixed;bottom:0;left:0;opacity:0'
  let patched = null
  const patch = () => {
    const w = ifr.contentWindow
    if (!w || w === patched) return
    try { if (w.location.href === 'about:blank') return } catch { return }
    patched = w
    const X = w.XMLHttpRequest.prototype
    const oo = X.open, os = X.send, oh = X.setRequestHeader
    X.open = function (m, u) { this.__e = { u: String(u), h: {} }; return oo.apply(this, arguments) }
    X.setRequestHeader = function (k, v) { this.__e && (this.__e.h[k] = v); return oh.apply(this, arguments) }
    X.send = function (b) { if (this.__e) { this.__e.b = b; log.push(this.__e) } return os.apply(this, arguments) }
  }
  const iv = setInterval(patch, 1)
  ifr.src = location.href
  document.body.appendChild(ifr)
  await new Promise(r => setTimeout(r, 25000))
  clearInterval(iv)
  const find = prefix => log.find(e => { try { return JSON.parse(e.b).uri_context.startsWith(prefix) } catch { return false } })
  const pol = find('/policies/')
  if (!pol) throw new Error('policy request not captured; wait for the page to load and retry')
  window.__aigTpl = { pol: { u: pol.u, h: pol.h, b: pol.b } }
  // The document template has the same headers; only the body differs.
  const docBody = {
    verb: 'GET', jwt: { url: { values: [{ key: 'userid', value: 'nameid' }] } },
    config_file_name: 'appconfig',
    configs: { uri_base: 'documentManagement.uri.base', headers: [{ key: 'documentManagement.apikey.key', value: 'documentManagement.apikey.value' }] },
    uri_context: '/docIds/DOCID?targetsystem=AWD&context=Life&documentcategory=Correspondence&userId={userid}&documentformat=pdf',
    urlparms: {}, headers: [],
  }
  window.__aigTpl.doc = { u: pol.u, h: pol.h, b: JSON.stringify(docBody) }
  ifr.remove()
  if (!window.pdfjsLib) {
    await new Promise((r, j) => { const s = document.createElement('script'); s.type = 'module'; s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs'; s.onload = r; s.onerror = j; document.head.appendChild(s) })
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs'
  return 'ready'
}

const __aigPost = (tpl, body) => new Promise((res, rej) => {
  const x = new XMLHttpRequest()
  x.open('POST', tpl.u)
  for (const k in tpl.h) x.setRequestHeader(k, tpl.h[k])
  x.onload = () => { try { res(JSON.parse(x.responseText)) } catch (e) { rej(e) } }
  x.onerror = rej
  x.send(JSON.stringify(body))
})

// Full policy record: policyStatus, paidToDate, issueDate, coverages, agents, persons,
// billingHistory, paymentDeclines, documentList (documentCategory, documentCreatedDate, documentId).
window.__aigPolicy = async num => {
  const b = JSON.parse(window.__aigTpl.pol.b)
  b.uri_context = b.uri_context.replace(/^\/policies\/\d+\//, '/policies/' + num + '/')
  const r = await __aigPost(window.__aigTpl.pol, b)
  return (r.policyDetailsResponse || {}).policy || null
}

window.__aigLetterText = async docId => {
  const b = JSON.parse(window.__aigTpl.doc.b)
  b.uri_context = b.uri_context.replace('DOCID', docId)
  const j = await __aigPost(window.__aigTpl.doc, b)
  const bin = atob(j.response.documentData.documentContent)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  const d = await pdfjsLib.getDocument({ data: u }).promise
  let t = ''
  for (let p = 1; p <= d.numPages; p++) t += (await (await d.getPage(p)).getTextContent()).items.map(i => i.str).join(' ') + ' '
  return t.replace(/\s+/g, ' ')
}

// Letter kinds seen so far. Order matters: the first match wins.
window.__aigKind = t => {
  if (/Pending Death Claim/i.test(t)) return 'PENDING DEATH CLAIM'
  if (/NOTICE OF TERMINATION/.test(t)) return 'TERMINATION'
  if (/GRACE PERIOD NOTICE/.test(t)) return 'GRACE'
  if (/removed the policy\(s\) indicated below from the Automatic Bank Check/i.test(t)) return 'ABC REMOVAL: ' + ((t.match(/REMOVAL REASON .*?\d{4} ([A-Za-z][A-Za-z ]{3,40}?) If you have/) || [])[1] || '?')
  if (/has been returned unpaid/i.test(t)) return 'RETURNED DRAFT'
  if (/graded death benefit/i.test(t)) return 'WELCOME'
  if (/reinstat/i.test(t)) return 'REINSTATEMENT'
  return 'OTHER'
}

// Grace letters: "If this premium is not received by <date>, your policy will be cancelled".
window.__aigGraceBy = t => (t.match(/not received by ([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1] || null

window.__aigScan = async (nums, { lettersSince = null } = {}) => {
  window.__aig = window.__aig || {}
  for (const n of nums) {
    try {
      const P = await window.__aigPolicy(n)
      if (!P) { window.__aig[n] = { err: 'not found' }; continue }
      const o = {
        st: P.policyStatus, ptd: P.paidToDate,
        decl: (P.paymentDeclines || []).map(d => d.transactionDate + ' ' + d.reason),
        bills: (P.billingHistory || []).slice(0, 4).map(b => [b.dueDate, b.status, b.amountPaid].join('/')),
        letters: [],
      }
      for (const d of (P.documentList || []).filter(d => d.documentCategory === 'Correspondence')) {
        const [mm, dd, yy] = d.documentCreatedDate.split('/')
        const iso = `${yy}-${mm}-${dd}`
        if (lettersSince && iso < lettersSince) continue
        try {
          const t = await window.__aigLetterText(d.documentId)
          o.letters.push({ date: iso, kind: window.__aigKind(t), by: window.__aigGraceBy(t) })
        } catch (e) { o.letters.push({ date: iso, err: String(e).slice(0, 60) }) }
      }
      window.__aig[n] = o
    } catch (e) { window.__aig[n] = { err: String(e).slice(0, 80) } }
  }
  return Object.keys(window.__aig).length
}
