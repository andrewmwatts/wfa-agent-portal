/**
 * leadResume.js
 * Recruiting-lead resumes live in a private Supabase Storage bucket, one file per lead at
 * `<lead id>/resume.<ext>`. Nothing in the database points at it: the path is derived from
 * the lead id, and the lead's notes carry the original (Quility/Appcast) link, which is both
 * where the file is copied from and the signal that a resume exists.
 *
 * Callers pass a service-role Supabase client. Appcast links carry a token that may expire,
 * so the file is copied when the lead arrives (leads-ingest); the download endpoint also
 * copies on demand for a lead that has the link but no stored file yet.
 */

export const RESUME_BUCKET = 'lead-resumes'
const MAX_BYTES = 10 * 1024 * 1024
const EXT_BY_TYPE = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'application/rtf': 'rtf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
}

/** The link on the "Resume (ACRN-...): https://..." line of a lead's notes, or null. */
export function resumeUrlFromNotes(notes) {
  const m = String(notes ?? '').match(/^Resume[^\n:]*:\s*(https?:\/\/\S+)/mi)
  return m ? m[1] : null
}

async function ensureBucket(sb) {
  const { data } = await sb.storage.getBucket(RESUME_BUCKET)
  if (data) return
  const { error } = await sb.storage.createBucket(RESUME_BUCKET, { public: false, fileSizeLimit: MAX_BYTES })
  if (error && !/already exists/i.test(error.message)) throw error
}

/** Path of the stored resume for a lead, or null. */
export async function storedResumePath(sb, leadId) {
  const { data, error } = await sb.storage.from(RESUME_BUCKET).list(String(leadId), { limit: 5 })
  if (error || !data?.length) return null
  const file = data.find(f => f.name.startsWith('resume.')) ?? data[0]
  return `${leadId}/${file.name}`
}

/** Copy the file at `url` into the bucket for this lead. Returns the path, or null if it can't be fetched. */
export async function storeLeadResume(sb, leadId, url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) })
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length || buf.length > MAX_BYTES) return null

  // Appcast serves these as octet-stream, so go by the file's own signature.
  const head = buf.subarray(0, 8).toString('latin1')
  const ext = head.startsWith('%PDF') ? 'pdf'
    : head.startsWith('PK') ? 'docx'
    : head.startsWith('\xD0\xCF\x11\xE0') ? 'doc'
    : head.startsWith('{\\rtf') ? 'rtf'
    : EXT_BY_TYPE[(res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()] ?? 'pdf'

  await ensureBucket(sb)
  const path = `${leadId}/resume.${ext}`
  const { error } = await sb.storage.from(RESUME_BUCKET).upload(path, buf, {
    contentType: Object.keys(EXT_BY_TYPE).find(t => EXT_BY_TYPE[t] === ext),
    upsert: true,
  })
  if (error) throw error
  // A re-copy may land under a different extension; keep one file per lead.
  const { data: others } = await sb.storage.from(RESUME_BUCKET).list(String(leadId))
  const stale = (others ?? []).map(f => `${leadId}/${f.name}`).filter(f => f !== path)
  if (stale.length) await sb.storage.from(RESUME_BUCKET).remove(stale)
  return path
}

/** Short-lived download link for a lead's resume, copying it in first if needed. Null when there is none. */
export async function resumeDownloadUrl(sb, lead) {
  let path = await storedResumePath(sb, lead.id)
  if (!path) {
    const src = resumeUrlFromNotes(lead.notes)
    if (!src) return null
    path = await storeLeadResume(sb, lead.id, src)
    if (!path) return src // could not copy (link expired?) — fall back to the original link
  }
  const { data, error } = await sb.storage.from(RESUME_BUCKET).createSignedUrl(path, 300)
  if (error) throw error
  return data.signedUrl
}
