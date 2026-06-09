import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { requireAuth } from './_auth.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

/**
 * Transactions API  (income/expense tracker)
 *
 * GET  /api/transactions                            → list transactions
 * GET  /api/transactions?hashes_only=1             → return existing import_hashes (for dedup)
 * POST /api/transactions                            → insert single (409 on hash conflict)
 * POST /api/transactions?bulk=1                     → insert array, skip conflicts silently
 * PATCH  /api/transactions?id=<uuid>               → update transaction
 * DELETE /api/transactions?id=<uuid>               → delete transaction
 */

// Hash uses the signed amount (positive=income, negative=expense) so a
// $100 income and $100 expense on the same date/description get different hashes.
function txHash(date, amount, description) {
  const str = `${date}|${amount}|${String(description).toLowerCase().trim()}`
  return createHash('sha256').update(str).digest('hex')
}

export default async function handler(req, res) {
  const caller = await requireAuth(req, res)
  if (!caller) return

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  const sfgId = caller.sfg_id
  if (!sfgId) return res.status(403).json({ error: 'No SFG ID associated with this account' })

  // ── GET ───────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    // Super admins may pass ?view_as=<sfg_id> to read another user's transactions
    let targetSfgId = sfgId
    if (req.query.view_as && caller.role === 'super_admin') {
      targetSfgId = req.query.view_as.trim().toUpperCase()
    }

    // Hashes-only mode: used by bulk import to detect duplicates client-side
    if (req.query.hashes_only === '1') {
      const { data, error } = await supabase
        .from('transactions')
        .select('import_hash')
        .eq('sfg_id', targetSfgId)
        .not('import_hash', 'is', null)
      if (error) return res.status(500).json({ error: error.message })
      return res.status(200).json({ hashes: (data ?? []).map(r => r.import_hash) })
    }

    let query = supabase
      .from('transactions')
      .select('*')
      .eq('sfg_id', targetSfgId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })

    if (req.query.start_date) query = query.gte('date', req.query.start_date)
    if (req.query.end_date)   query = query.lte('date', req.query.end_date)
    if (req.query.type && ['income','expense'].includes(req.query.type))
      query = query.eq('type', req.query.type)
    if (req.query.category) query = query.eq('category', req.query.category)

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).json({ transactions: data ?? [] })
  }

  // ── POST ──────────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    // ── Bulk import ───────────────────────────────────────────────────────────
    if (req.query.bulk === '1') {
      const rows = body.transactions
      if (!Array.isArray(rows) || !rows.length) {
        return res.status(400).json({ error: 'transactions array required' })
      }

      const enriched = rows.map(r => {
        // r.amount is already signed (positive=income, negative=expense)
        const signedAmt = r.type === 'expense' ? -Math.abs(Number(r.amount)) : Math.abs(Number(r.amount))
        return {
          sfg_id:         sfgId,
          date:           r.date,
          description:    r.description,
          amount:         signedAmt,
          type:           r.type,
          category:       r.category ?? null,
          source:         r.source   ?? null,
          tax_deductible: r.tax_deductible ?? false,
          notes:          r.notes    ?? null,
          import_hash:    txHash(r.date, signedAmt, r.description),
        }
      })

      // Insert in chunks of 100 to avoid request size limits
      let inserted = 0, skipped = 0
      const CHUNK = 100
      for (let i = 0; i < enriched.length; i += CHUNK) {
        const chunk = enriched.slice(i, i + CHUNK)
        const { data, error } = await supabase
          .from('transactions')
          .upsert(chunk, { onConflict: 'sfg_id,import_hash', ignoreDuplicates: true })
          .select('id')
        if (error) return res.status(500).json({ error: error.message })
        inserted += (data ?? []).length
        skipped  += chunk.length - (data ?? []).length
      }

      return res.status(200).json({ inserted, skipped })
    }

    // ── Single insert ─────────────────────────────────────────────────────────
    const { date, description, amount, type, category, source, tax_deductible, notes, force } = body

    if (!date || !description || amount == null || !type) {
      return res.status(400).json({ error: 'date, description, amount, and type are required' })
    }
    if (!['income', 'expense'].includes(type)) {
      return res.status(400).json({ error: 'type must be income or expense' })
    }

    const signedAmt = type === 'expense' ? -Math.abs(Number(amount)) : Math.abs(Number(amount))
    const hash = txHash(date, signedAmt, description)

    if (!force) {
      const { data: existing } = await supabase
        .from('transactions')
        .select('id, date, description, amount, type')
        .eq('sfg_id', sfgId)
        .eq('import_hash', hash)
        .maybeSingle()

      if (existing) {
        return res.status(409).json({
          conflict: true,
          existing,
          message: 'This looks like a duplicate of an existing entry',
        })
      }
    }

    const { data, error } = await supabase
      .from('transactions')
      .insert({
        sfg_id: sfgId,
        date, description,
        amount: signedAmt,
        type,
        category:       category       ?? null,
        source:         source         ?? null,
        tax_deductible: tax_deductible ?? false,
        notes:          notes          ?? null,
        import_hash:    hash,
      })
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json({ transaction: data })
  }

  // ── PATCH ─────────────────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id required as query param' })

    let body
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' })
    }

    // Verify ownership
    const { data: current } = await supabase
      .from('transactions')
      .select('sfg_id, date, description, amount, type')
      .eq('id', id)
      .maybeSingle()
    if (!current)            return res.status(404).json({ error: 'Transaction not found' })
    if (current.sfg_id !== sfgId) return res.status(403).json({ error: 'Forbidden' })

    const { date, description, amount, type, category, source, tax_deductible, notes } = body

    const finalType = type ?? current.type
    const finalDate = date ?? current.date
    const finalDesc = description ?? current.description

    const updates = { updated_at: new Date().toISOString() }
    if (date        != null) updates.date        = date
    if (description != null) updates.description = description
    if (type        != null) updates.type        = type
    if (category    != null) updates.category    = category
    if (source      != null) updates.source      = source
    if (tax_deductible != null) updates.tax_deductible = tax_deductible
    if (notes       != null) updates.notes       = notes

    // Recompute signed amount if amount or type changed
    if (amount != null || type != null) {
      const baseAmt = amount != null ? Math.abs(Number(amount)) : Math.abs(Number(current.amount))
      updates.amount = finalType === 'expense' ? -baseAmt : baseAmt
    }

    const finalAmt = updates.amount ?? current.amount
    updates.import_hash = txHash(finalDate, finalAmt, finalDesc)

    const { data, error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ transaction: data })
  }

  // ── DELETE ────────────────────────────────────────────────────────────────────
  if (req.method === 'DELETE') {
    const id = req.query.id
    if (!id) return res.status(400).json({ error: 'id required as query param' })

    const { data: existing } = await supabase
      .from('transactions')
      .select('sfg_id')
      .eq('id', id)
      .maybeSingle()
    if (!existing)               return res.status(404).json({ error: 'Transaction not found' })
    if (existing.sfg_id !== sfgId) return res.status(403).json({ error: 'Forbidden' })

    const { error } = await supabase.from('transactions').delete().eq('id', id)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ success: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
