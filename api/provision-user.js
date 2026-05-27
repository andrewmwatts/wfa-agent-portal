import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../.vercel/.env.development.local') })
loadEnv({ path: resolve(__dirname, '../.env.local') })

// Determine the appropriate portal role from agent_promotions data.
// Priority: owner > leader > agent
// Owner  = AO  month_1 + month_2 + month_3 all filled
// Leader = KL  month_1 + month_2 both filled
async function resolveRole(supabase, sfgId) {
  const { data: promos } = await supabase
    .from('agent_promotions')
    .select('level, month_1, month_2, month_3')
    .eq('sfg_id', sfgId.trim().toUpperCase())
    .eq('promotion_type', 'leadership')

  if (!promos?.length) return 'agent'

  const byLevel = {}
  for (const row of promos) {
    byLevel[row.level?.toUpperCase()] = row
  }

  const ao = byLevel['AO']
  if (ao?.month_1 && ao?.month_2 && ao?.month_3) return 'owner'

  const kl = byLevel['KL']
  if (kl?.month_1 && kl?.month_2) return 'leader'

  return 'agent'
}

// Walk the personnel upline chain until we find a portal user with role
// owner|director (an AO). Returns their sfg_id, or null if not found.
// Short-circuits if we hit a user who already has agency_owner set.
async function findAgencyOwner(supabase, startSfgId, selfRole = 'agent') {
  const MAX_DEPTH = 5
  let currentId = startSfgId.trim().toUpperCase()

  // If the registering user is themselves an AO, they are their own agency_owner
  if (['owner', 'director'].includes(selfRole)) return currentId

  for (let i = 0; i < MAX_DEPTH; i++) {
    // Step up one level in the org chart
    const { data: personnelRow } = await supabase
      .from('personnel')
      .select('upline_sfg_id')
      .eq('sfg_id', currentId)
      .maybeSingle()

    const uplineId = personnelRow?.upline_sfg_id?.trim()?.toUpperCase()
    if (!uplineId) break  // reached the top of the chain

    // Check whether this upline is a portal user
    const { data: portalUser } = await supabase
      .from('users')
      .select('role, agency_owner')
      .eq('sfg_id', uplineId)
      .maybeSingle()

    if (portalUser) {
      // Found an AO — this is the agency owner
      if (['owner', 'director'].includes(portalUser.role)) return uplineId
      // Found a user who already has agency_owner resolved — reuse it
      if (portalUser.agency_owner) return portalUser.agency_owner
    }

    currentId = uplineId
  }

  return null
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  let user_id, email, sfg_id, full_name
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    user_id   = body.user_id
    email     = body.email
    sfg_id    = body.sfg_id
    full_name = body.full_name
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  if (!user_id || !email || !sfg_id) {
    return res.status(400).json({ error: 'user_id, email, and sfg_id are required' })
  }

  try {
    const supabase = createClient(
      process.env.VITE_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Resolve role first, then use it to short-circuit the upline walk if needed
    const role         = await resolveRole(supabase, sfg_id)
    const agency_owner = await findAgencyOwner(supabase, sfg_id, role)

    const { error } = await supabase
      .from('users')
      .insert({
        id:           user_id,
        email:        email.trim().toLowerCase(),
        sfg_id:       sfg_id.trim(),
        full_name:    full_name?.trim() ?? '',
        role,
        is_active:    true,
        agency_owner: agency_owner ?? null,
      })

    if (error) {
      console.error('[provision-user] insert error:', error)
      return res.status(500).json({ error: error.message ?? 'Failed to create portal account' })
    }

    // Copy super_admin's hidden_sfg_ids into user_settings for the new user
    const { data: superAdmins } = await supabase
      .from('users')
      .select('id')
      .eq('role', 'super_admin')
      .limit(1)

    const superAdminId = superAdmins?.[0]?.id
    if (superAdminId) {
      const { data: adminSettings } = await supabase
        .from('user_settings')
        .select('hidden_sfg_ids')
        .eq('user_id', superAdminId)
        .maybeSingle()

      const hiddenIds = adminSettings?.hidden_sfg_ids ?? []
      if (hiddenIds.length) {
        await supabase
          .from('user_settings')
          .upsert({
            user_id,
            hidden_sfg_ids: hiddenIds,
          }, { onConflict: 'user_id' })
      }
    }

    return res.status(200).json({ success: true, agency_owner })
  } catch (err) {
    console.error('[provision-user] unexpected error:', err)
    return res.status(500).json({ error: 'Failed to create portal account' })
  }
}
