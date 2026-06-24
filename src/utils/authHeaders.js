export function makeAuthHeaders(session) {
  const h = { 'Content-Type': 'application/json' }
  if (session?.access_token) h['Authorization'] = `Bearer ${session.access_token}`
  return h
}
