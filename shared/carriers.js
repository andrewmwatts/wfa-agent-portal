// Shared carrier-name normalization — imported by BOTH the React app (src/*)
// and the serverless API functions (api/*). Keep this file dependency-free
// (no React, no Node-only APIs) so both bundlers can include it.

// Carriers that share an identity — keyed by any lowercase variant,
// value = canonical display name.
export const CARRIER_ALIASES = {
  'american amicable group': 'American Amicable',
  'occidental':              'American Amicable',
  'lga':                     'Banner',
  'corebridge':              'American General',
  'transamerica group':      'TransAmerica',
  'foresters dfl':           'Foresters',
}

// Map any carrier spelling to its canonical display name.
export function normalizeCarrier(raw) {
  if (!raw) return raw
  return CARRIER_ALIASES[raw.trim().toLowerCase()] ?? raw.trim()
}
