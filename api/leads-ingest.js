import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { buildRecruitingLead } from '../shared/recruitingSheetLead.js'
import { resumeUrlFromNotes, storeLeadResume } from '../shared/leadResume.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

// Configure VAPID once at module load (no-ops if keys aren't set yet)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:portal@wattsfamilyagency.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
}

/**
 * Leads Ingest API
 *
 * POST /api/leads-ingest
 * Header: X-WFA-Secret: <WFA_INGEST_SECRET>
 *
 * Actions:
 *   lookup_agent          { action, email }                        → { sfg_id }
 *   check_duplicate       { action, phone, sfg_id }               → { duplicate }
 *   insert_lead           { action, lead: {...} }                  → { success }
 *   upsert_recruiting_lead{ action, row: { status, name, phone,
 *                           email, state, apply_date, requisition,
 *                           licensed, willing, commission_ok, tier,
 *                           resume_url, agent_notes } }           → { success, duplicate, id }
 *   insert_error          { action, error: {...} }                 → { success }
 *   insert_contract_number{ action, contract: { sfg_id, carrier,
 *                           contract_number, effective_date,
 *                           source } }                            → { success }
 *
 * Required table — run once in Supabase:
 *
 * CREATE TABLE public.parse_errors (
 *   id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 *   sender       text,
 *   subject      text,
 *   reason       text NOT NULL,
 *   body_snippet text,
 *   created_at   timestamptz NOT NULL DEFAULT now()
 * );
 * ALTER TABLE public.parse_errors ENABLE ROW LEVEL SECURITY;
 * CREATE POLICY "parse_errors_service" ON public.parse_errors
 *   FOR ALL TO service_role USING (true) WITH CHECK (true);
 * GRANT ALL ON public.parse_errors TO service_role;
 * GRANT USAGE, SELECT ON SEQUENCE parse_errors_id_seq TO service_role;
 */

// Quility's recruiting sheet ("Watts Family Agency.xlsx") belongs to Kristina Watts.
const RECRUITING_LEADS_OWNER = 'SFG0049415'

const sb = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

export default async function handler(req, res) {
  // ── Method guard ──────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── Auth: shared secret ───────────────────────────────────────────────────
  const secret = process.env.WFA_INGEST_SECRET
  if (!secret || req.headers['x-wfa-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const body = req.body ?? {}
  const { action } = body

  // ── lookup_agent ──────────────────────────────────────────────────────────
  if (action === 'lookup_agent') {
    const { email } = body
    if (!email) return res.status(400).json({ error: 'email is required' })

    const { data, error } = await sb
      .from('users')
      .select('sfg_id')
      .or(`leads_email.ilike.${email},email.ilike.${email}`)
      .limit(1)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ sfg_id: data?.sfg_id ?? null })
  }

  // ── check_duplicate ───────────────────────────────────────────────────────
  if (action === 'check_duplicate') {
    const { phone, sfg_id } = body
    if (!phone || !sfg_id) {
      return res.status(400).json({ error: 'phone and sfg_id are required' })
    }

    const { data, error } = await sb
      .from('leads')
      .select('id')
      .eq('phone', phone)
      .eq('sfg_id', sfg_id.toUpperCase())
      .limit(1)
      .maybeSingle()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ duplicate: !!data })
  }

  // ── insert_lead ───────────────────────────────────────────────────────────
  if (action === 'insert_lead') {
    const { lead } = body
    if (!lead || !lead.sfg_id || !lead.name) {
      return res.status(400).json({ error: 'lead.sfg_id and lead.name are required' })
    }

    const { error } = await sb.from('leads').insert({
      ...lead,
      sfg_id:     lead.sfg_id.toUpperCase(),
      name:       lead.name.trim(),
      added:      lead.added      || new Date().toISOString().slice(0, 10),
      created_at: lead.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    if (error) return res.status(500).json({ success: false, error: error.message })

    // Best-effort push notification — awaited so the serverless function
    // doesn't tear down before it completes. An un-awaited promise here can
    // get killed mid-flight the instant the response is sent, silently
    // dropping the push with no error ever logged.
    try {
      await sendLeadPushNotification(sb, lead)
    } catch (e) {
      console.error('[push] notification error:', e.message)
    }

    return res.status(201).json({ success: true })
  }

  // ── upsert_recruiting_lead ────────────────────────────────────────────────
  // One recruiting application, sent by the Gmail sync script (Appcast application emails
  // and Quility allocation emails). Inserts a recruiting lead for the owner unless one with
  // the same phone (or requisition) exists. An existing lead is never overwritten, since it
  // may have been worked in the portal; it is only given what it lacks: the Quility order
  // number and the resume link, which arrive in the allocation email after the Appcast one.
  if (action === 'upsert_recruiting_lead') {
    const owner = (process.env.RECRUITING_LEADS_SFG_ID || RECRUITING_LEADS_OWNER).toUpperCase()
    const lead = buildRecruitingLead(body.row ?? {}, owner, new Date().toISOString())
    if (!lead) return res.status(400).json({ error: 'row.name and row.phone (or row.email) are required' })

    const matches = []
    if (lead.phone)          matches.push(`phone.eq.${lead.phone}`)
    if (lead.vendor_lead_id) matches.push(`vendor_lead_id.eq.${lead.vendor_lead_id}`)
    if (matches.length) {
      const { data: dup, error: dupErr } = await sb
        .from('leads').select('id, vendor_lead_id, notes')
        .eq('sfg_id', owner).eq('category', 'recruiting')
        .or(matches.join(','))
        .limit(1).maybeSingle()
      if (dupErr) return res.status(500).json({ success: false, error: dupErr.message })
      if (dup) {
        const fill = {}
        if (!dup.vendor_lead_id && lead.vendor_lead_id) fill.vendor_lead_id = lead.vendor_lead_id
        const resume = (lead.notes ?? '').split('\n').find(l => l.startsWith('Resume'))
        if (resume && !/^Resume/m.test(dup.notes ?? '')) fill.notes = [dup.notes, resume].filter(Boolean).join('\n')
        if (Object.keys(fill).length) {
          const { error: fillErr } = await sb.from('leads').update(fill).eq('id', dup.id)
          if (fillErr) return res.status(500).json({ success: false, error: fillErr.message })
        }
        if (fill.notes) await copyResume(dup.id, resumeUrlFromNotes(fill.notes))
        return res.status(200).json({ success: true, duplicate: true, id: dup.id, filled: Object.keys(fill) })
      }
    }

    const { data: created, error } = await sb.from('leads').insert(lead).select('id').single()
    if (error) return res.status(500).json({ success: false, error: error.message })

    await copyResume(created.id, resumeUrlFromNotes(lead.notes))
    if (lead.status === 'new') {
      try {
        await sendLeadPushNotification(sb, lead, { title: 'New Recruiting Lead', url: '/portal/recruiting' })
      } catch (e) {
        console.error('[push] notification error:', e.message)
      }
    }
    return res.status(201).json({ success: true, duplicate: false, id: created.id })
  }

  // ── insert_error ──────────────────────────────────────────────────────────
  if (action === 'insert_error') {
    const { error: errPayload } = body
    if (!errPayload?.reason) {
      return res.status(400).json({ error: 'error.reason is required' })
    }

    const { error } = await sb.from('parse_errors').insert({
      sender:       errPayload.sender       || null,
      subject:      errPayload.subject      || null,
      reason:       errPayload.reason,
      body_snippet: errPayload.body_snippet || null,
    })

    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(201).json({ success: true })
  }

  // ── insert_contract_number ───────────────────────────────────────────────
  if (action === 'insert_contract_number') {
    const { sfg_id, carrier, contract_number, effective_date, source } = body.contract ?? {}
    if (!sfg_id || !carrier || !contract_number || !source) {
      return res.status(400).json({
        error: 'sfg_id, carrier, contract_number, and source are required',
      })
    }

    const { error } = await sb.from('contract_numbers').upsert(
      {
        sfg_id:          sfg_id.toUpperCase(),
        carrier:         carrier.trim(),
        contract_number: contract_number.trim(),
        effective_date:  effective_date || null,
        source:          source.trim(),
      },
      { onConflict: 'sfg_id,carrier,contract_number', ignoreDuplicates: true },
    )

    if (error) return res.status(500).json({ success: false, error: error.message })
    return res.status(200).json({ success: true })
  }

  // ── Unknown action ────────────────────────────────────────────────────────
  return res.status(400).json({ error: `Unknown action: ${action}` })
}

// Best-effort copy of the lead's resume into storage (the Appcast link is tokenized and may
// expire); the lead is already saved, and the download endpoint retries on demand.
async function copyResume(leadId, url) {
  if (!url) return
  try {
    await storeLeadResume(sb, leadId, url)
  } catch (e) {
    console.error('[resume] copy failed for lead', leadId, e.message)
  }
}

// ── Push helper ───────────────────────────────────────────────────────────────

async function sendLeadPushNotification(sb, lead, { title = 'New Lead', url = '/portal/leads' } = {}) {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return

  const sfgId = lead.sfg_id?.toUpperCase()
  if (!sfgId) return

  const { data: subs } = await sb
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('sfg_id', sfgId)

  if (!subs?.length) return

  const bodyParts = [
    lead.name,
    lead.type || lead.lead_type || null,
    lead.state || null,
  ].filter(Boolean)

  const payload = JSON.stringify({
    title,
    body: bodyParts.join(' — '),
    url,
  })

  const staleIds = []
  await Promise.allSettled(
    subs.map(async sub => {
      try {
        await webpush.sendNotification(sub.subscription, payload)
      } catch (e) {
        if (e.statusCode === 410) staleIds.push(sub.id)
        else console.error('[push] send failed for sub', sub.id, e.message)
      }
    })
  )

  if (staleIds.length) {
    await sb.from('push_subscriptions').delete().in('id', staleIds)
  }
}
