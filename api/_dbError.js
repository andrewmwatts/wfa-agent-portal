/**
 * Turn a Postgres error into something a user can act on.
 *
 * Supabase surfaces constraint violations as opaque 5xx "failed to save" text
 * unless the real message is passed through, which hides the actual cause (a
 * missing parent row, a duplicate key) from whoever hit it.
 */
export function dbErrorMessage(err, fallback) {
  const code = err?.code
  const raw  = [err?.message, err?.details].filter(Boolean).join(' — ')
  if (code === '23503') {
    return `${fallback}: it is still referenced by another record. ${raw}`
  }
  if (code === '23505') {
    return `${fallback}: that would duplicate an existing record. ${raw}`
  }
  return raw ? `${fallback}: ${raw}` : fallback
}
