// App-wide magic strings, centralized.

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  DIRECTOR:    'director',
  OWNER:       'owner',
  LEADER:      'leader',
  AGENT:       'agent',
}

// Roles that can see master/baseshop toggles and team-wide scope.
export const DIRECTOR_ROLES = [ROLES.DIRECTOR, ROLES.SUPER_ADMIN]
export const OWNER_PLUS_ROLES = [ROLES.OWNER, ROLES.DIRECTOR, ROLES.SUPER_ADMIN]

// Delegation section keys (must match the DB check constraint on
// assistant_permissions.section).
export const DELEGATION_SECTIONS = [
  'personnel', 'onboarding', 'apps_and_policies', 'metrics',
  'leads', 'recruiting', 'accountability', 'snapshot', 'activity',
]
