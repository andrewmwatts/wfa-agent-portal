import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'

const ViewingContext = createContext(null)

const SECTION_MAP = {
  personnel:         'myInfo',
  onboarding:        'onboarding',
  apps_and_policies: 'appsAndPolicies',
  metrics:           'metrics',
  leads:             'leads',
  recruiting:        'recruiting',
  accountability:    'accountability',
  snapshot:          'snapshot',
  activity:          'activity',
  income:            'income',
}

const ALL_SECTIONS = ['myInfo', 'onboarding', 'team', 'appsAndPolicies', 'metrics', 'admin', 'leads', 'recruiting', 'accountability', 'snapshot', 'activity', 'income']

const ALWAYS_WRITE = new Set(['leads', 'recruiting', 'activity', 'income'])

function makePerms(readable = [], writable = []) {
  return Object.fromEntries(
    ALL_SECTIONS.map(s => [s, {
      read:  readable.includes(s) || readable.includes('*'),
      write: writable.includes(s) || writable.includes('*'),
    }])
  )
}

// Sections each role can read
function sectionsByRole(role) {
  switch (role) {
    case 'super_admin':
      return ['*']
    case 'director':
    case 'owner':
      return ['myInfo', 'onboarding', 'team', 'appsAndPolicies', 'metrics', 'leads', 'recruiting', 'accountability', 'snapshot', 'activity', 'income']
    case 'leader':
      return ['myInfo', 'onboarding', 'team', 'appsAndPolicies', 'metrics', 'leads', 'recruiting', 'activity', 'income']
    default: // agent
      return ['myInfo', 'appsAndPolicies', 'metrics', 'leads', 'recruiting', 'activity', 'income']
  }
}

function resolvePermissions(viewer, isSelf, assistantPerms = null) {
  if (viewer.role === 'super_admin') return makePerms(['*'], ['*'])
  if (isSelf) {
    const readable = sectionsByRole(viewer.role)
    const writable = readable.filter(s => ALWAYS_WRITE.has(s))
    for (const dbKey of viewer.write_sections ?? []) {
      const viewKey = SECTION_MAP[dbKey]
      if (viewKey && readable.includes(viewKey) && !writable.includes(viewKey)) {
        writable.push(viewKey)
      }
    }
    return makePerms(readable, writable)
  }
  if (assistantPerms) {
    const readable = []
    const writable = []
    for (const p of assistantPerms) {
      const key = SECTION_MAP[p.section]
      if (!key) continue
      if (p.can_read)  readable.push(key)
      if (p.can_write) writable.push(key)
    }
    return makePerms(readable, writable)
  }
  return makePerms()
}

export function ViewingProvider({ children }) {
  const { userProfile } = useAuth()
  const [subjects, setSubjects]   = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    if (!userProfile) {
      setSubjects([])
      setLoading(false)
      return
    }
    setLoading(true)

    Promise.all([
      buildSubjectList(userProfile),
      supabase
        .from('user_settings')
        .select('default_view_sfg_id')
        .eq('user_id', userProfile.id)
        .maybeSingle(),
    ]).then(([list, { data: settings }]) => {
      setSubjects(list)

      // Default: prefer stored preference, otherwise self
      let defaultIdx = list.findIndex(s => s.isSelf)
      if (defaultIdx < 0) defaultIdx = 0

      if (settings?.default_view_sfg_id) {
        const prefIdx = list.findIndex(
          s => s.profile.sfg_id === settings.default_view_sfg_id
        )
        if (prefIdx >= 0) defaultIdx = prefIdx
      }

      setActiveIdx(defaultIdx)
      setLoading(false)
    })
  }, [userProfile?.id])

  async function buildSubjectList(viewer) {
    const list = []

    // Always add self first
    if (viewer.role) {
      list.push({
        profile:     viewer,
        permissions: resolvePermissions(viewer, true),
        isSelf:      true,
      })
    }

    if (viewer.role === 'super_admin') {
      // Super admin can view as any portal user
      const { data: allUsers } = await supabase
        .from('users')
        .select('id, sfg_id, role, full_name, email, is_assistant, is_active, upline_sfg_id, owner_since')
        .neq('id', viewer.id)
        .order('full_name')

      for (const u of (allUsers ?? [])) {
        list.push({
          profile:     u,
          permissions: makePerms(['*'], ['*']),
          isSelf:      false,
        })
      }
    } else if (viewer.is_assistant) {
      // Assistants can view their assigned agents
      const { data: assignments, error } = await supabase
        .from('agent_assistants')
        .select('id, agent_sfg_id, assistant_permissions(section, can_read, can_write)')
        .eq('assistant_sfg_id', viewer.sfg_id)
        .eq('is_active', true)

      if (!error && assignments?.length) {
        const sfgIds = assignments.map(a => a.agent_sfg_id)
        const { data: profiles } = await supabase
          .from('users')
          .select('id, sfg_id, role, full_name, email, is_assistant, is_active, upline_sfg_id, owner_since')
          .in('sfg_id', sfgIds)

        for (const a of assignments) {
          const profile = profiles?.find(p => p.sfg_id === a.agent_sfg_id)
          if (profile) {
            list.push({
              profile,
              permissions: resolvePermissions(viewer, false, a.assistant_permissions),
              isSelf:      false,
            })
          }
        }
      }
    }

    return list
  }

  const active = subjects[activeIdx] ?? null

  // Super admins always get full read + write regardless of whose profile is active
  const isSuperAdmin = userProfile?.role === 'super_admin'
  const effectivePermissions = isSuperAdmin
    ? makePerms(['*'], ['*'])
    : (active?.permissions ?? makePerms())

  return (
    <ViewingContext.Provider value={{
      loading,
      subjects,
      activeSubject:    active?.profile     ?? null,
      permissions:      effectivePermissions,
      isSelf:           active?.isSelf      ?? true,
      activeIdx,
      setActiveSubject: setActiveIdx,
    }}>
      {children}
    </ViewingContext.Provider>
  )
}

export function useViewing() {
  const ctx = useContext(ViewingContext)
  if (!ctx) throw new Error('useViewing must be used within ViewingProvider')
  return ctx
}
