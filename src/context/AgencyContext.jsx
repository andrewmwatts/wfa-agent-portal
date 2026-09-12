import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'
import { useTheme } from './ThemeContext'

const AgencyContext = createContext(null)

// ── Color utilities ────────────────────────────────────────────────────────────

// Trimmed defensively — colors are free-text admin input (or pasted from
// elsewhere, e.g. a spreadsheet cell), and a stray leading/trailing character
// like a tab makes this fail to match with no visible sign why.
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex ?? '').trim())
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
}

function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break
      case g: h = ((b - r) / d + 2) / 6; break
      case b: h = ((r - g) / d + 4) / 6; break
    }
  }
  return [h * 360, s * 100, l * 100]
}

function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const hue2rgb = t => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [
    Math.round(hue2rgb(h + 1 / 3) * 255),
    Math.round(hue2rgb(h)         * 255),
    Math.round(hue2rgb(h - 1 / 3) * 255),
  ]
}

function adjustLightness(hex, delta) {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [h, s, l] = rgbToHsl(...rgb)
  return hslToRgb(h, s, Math.max(0, Math.min(100, l + delta)))
}

// ── WCAG contrast ──────────────────────────────────────────────────────────────

function relativeLuminance([r, g, b]) {
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const [rl, gl, bl] = [lin(r), lin(g), lin(b)]
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}

function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA), b = hexToRgb(hexB)
  if (!a || !b) return 21 // unparsable — fail open rather than fight a color we can't read
  const [L1, L2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (L1 + 0.05) / (L2 + 0.05)
}

// Deliberately not a WCAG tier (even the most lenient, 3:1 for large text/UI
// components, was still re-tuning colors real agencies had already chosen and
// found perfectly readable — e.g. Watts pink on its teal secondary sits at
// ~2.1:1, Davis's mint accent on white at ~1.82:1). This is a much lower,
// empirically-set floor meant only to catch a pairing that's genuinely close
// to invisible (e.g. Larsen's yellow on white measured ~1.33:1) — a safety
// net, not a general beautifier or an accessibility-compliance guarantee.
const MIN_ACCENT_CONTRAST = 1.7

// Agency colors are picked once against no particular background in mind, so
// pastel or midtone choices can end up unreadable as text against whichever
// surface they land on. Nudges `hex`'s lightness (keeping its hue/saturation)
// away from `bgHex` until it reaches `minRatio` contrast, or bottoms/tops out.
// A color that already clears the bar is returned unchanged.
function ensureContrast(hex, bgHex, minRatio = MIN_ACCENT_CONTRAST) {
  if (contrastRatio(hex, bgHex) >= minRatio) return hex
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const [h, s, l] = rgbToHsl(...rgb)
  // Whichever extreme (black or white) contrasts better against this
  // background tells us which way to push lightness.
  const darken = contrastRatio('#000000', bgHex) >= contrastRatio('#ffffff', bgHex)
  let cur = l
  for (let i = 0; i < 40 && cur > 0 && cur < 100; i++) {
    cur = darken ? Math.max(0, cur - 2.5) : Math.min(100, cur + 2.5)
    const candidate = rgbToHex(hslToRgb(h, s, cur))
    if (contrastRatio(candidate, bgHex) >= minRatio) return candidate
  }
  return rgbToHex(hslToRgb(h, s, cur))
}

// Write a color + its light/dark variants to CSS custom properties.
// Format: bare RGB components ("0 83 101") so Tailwind's /opacity syntax works.
// A hex that still won't parse at this point falls back to mid-gray rather
// than silently skipping the write — leaving a CSS variable untouched means
// it keeps whatever the *previous* agency's value was, which reads as "this
// agency's colors are wrong" rather than "this agency's colors are missing."
function setColorVars(root, name, hex) {
  const resolved = hexToRgb(hex) ? hex : '#888888'
  const base = hexToRgb(resolved)
  root.style.setProperty(`--color-${name}`,       base.join(' '))
  const light = adjustLightness(resolved, +8)
  const dark  = adjustLightness(resolved, -8)
  if (light) root.style.setProperty(`--color-${name}-light`, light.join(' '))
  if (dark)  root.style.setProperty(`--color-${name}-dark`,  dark.join(' '))
}

const DEFAULTS = {
  primary:   '#005365',
  secondary: '#003539',
  accent:    '#EE2666',
}

// The page background text-accent actually sits on per theme: a fixed light
// surface in light mode (cards and page backgrounds are plain white/near-white
// regardless of agency branding), and the agency's own secondary color in dark
// mode (that's literally what dark:bg-secondary renders) — so that one comes
// from the branding itself rather than a fixed constant.
const LIGHT_BG = '#FFFFFF'

// Falls back to a known-good default for anything that isn't actually a
// parseable hex color — not just empty/missing, so a malformed saved value
// (stray whitespace, truncated input) can't silently propagate.
function resolvedColor(value, fallback) {
  return hexToRgb(value) ? String(value).trim() : fallback
}

function applyBranding(colors = {}, theme = 'light') {
  const root = document.documentElement
  const primary   = resolvedColor(colors.primary,   DEFAULTS.primary)
  const secondary = resolvedColor(colors.secondary, DEFAULTS.secondary)
  const accentRaw = resolvedColor(colors.accent,    DEFAULTS.accent)
  const bg      = theme === 'dark' ? secondary : LIGHT_BG
  const accent  = ensureContrast(accentRaw, bg)

  setColorVars(root, 'primary',   primary)
  setColorVars(root, 'secondary', secondary)
  setColorVars(root, 'accent',    accent)
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function AgencyProvider({ children }) {
  const { userProfile } = useAuth()
  const { theme } = useTheme()
  const agencyOwner = userProfile?.agency_owner
  const [realAgency, setRealAgency] = useState(null)

  // A super_admin previewing branding from Admin Tools — including unsaved
  // in-progress edits, or an owner/director with no portal account yet —
  // without switching who they're logged in as. Overrides realAgency
  // everywhere below until cleared.
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    if (!agencyOwner) { setRealAgency(null); return }

    supabase
      .from('agencies')
      .select('owner_sfg_id, name, logo_url_light, logo_url_dark, primary_color, secondary_color, accent_color')
      .eq('owner_sfg_id', agencyOwner)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error('[AgencyContext] fetch error:', error)
        setRealAgency(data ?? null)
      })
  }, [agencyOwner])

  const agency = preview ?? realAgency

  // Re-applied on every theme toggle too, since the accent's contrast check
  // is against a different background in light vs. dark mode.
  useEffect(() => {
    applyBranding(agency ? {
      primary:   agency.primary_color,
      secondary: agency.secondary_color,
      accent:    agency.accent_color,
    } : undefined, theme)
  }, [agency, theme])

  return (
    <AgencyContext.Provider value={{ agency, preview, setPreview }}>
      {children}
    </AgencyContext.Provider>
  )
}

export function useAgency() {
  return useContext(AgencyContext)
}

// Returns the correct logo URL for the current theme.
// Falls back to whichever logo is available if only one is set.
export function useAgencyLogo() {
  const { agency } = useAgency()
  const { theme }  = useTheme()
  if (!agency) return null
  return theme === 'dark'
    ? (agency.logo_url_dark  || agency.logo_url_light)
    : (agency.logo_url_light || agency.logo_url_dark)
}
