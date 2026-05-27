import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from './AuthContext'
import { useTheme } from './ThemeContext'

const AgencyContext = createContext(null)

// ── Color utilities ────────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null
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

// Write a color + its light/dark variants to CSS custom properties.
// Format: bare RGB components ("0 83 101") so Tailwind's /opacity syntax works.
function setColorVars(root, name, hex) {
  const base = hexToRgb(hex)
  if (!base) return
  root.style.setProperty(`--color-${name}`,       base.join(' '))
  const light = adjustLightness(hex, +8)
  const dark  = adjustLightness(hex, -8)
  if (light) root.style.setProperty(`--color-${name}-light`, light.join(' '))
  if (dark)  root.style.setProperty(`--color-${name}-dark`,  dark.join(' '))
}

const DEFAULTS = {
  primary:   '#005365',
  secondary: '#003539',
  accent:    '#EE2666',
}

function applyBranding(colors = {}) {
  const root = document.documentElement
  setColorVars(root, 'primary',   colors.primary   || DEFAULTS.primary)
  setColorVars(root, 'secondary', colors.secondary || DEFAULTS.secondary)
  setColorVars(root, 'accent',    colors.accent    || DEFAULTS.accent)
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function AgencyProvider({ children }) {
  const { userProfile } = useAuth()
  const [agency, setAgency] = useState(null)

  useEffect(() => {
    if (!userProfile?.agency_owner) {
      applyBranding()
      setAgency(null)
      return
    }

    supabase
      .from('agencies')
      .select('owner_sfg_id, name, logo_url_light, logo_url_dark, primary_color, secondary_color, accent_color')
      .eq('owner_sfg_id', userProfile.agency_owner)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error('[AgencyContext] fetch error:', error)
        }
        console.log('[AgencyContext] agency_owner lookup:', userProfile.agency_owner, '→ data:', data)
        setAgency(data ?? null)
        applyBranding(data ? {
          primary:   data.primary_color,
          secondary: data.secondary_color,
          accent:    data.accent_color,
        } : undefined)
      })
  }, [userProfile?.agency_owner])

  return (
    <AgencyContext.Provider value={{ agency }}>
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
