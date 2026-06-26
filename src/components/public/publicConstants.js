export const SERIES_META = {
  'wfh':               { name: 'Watts Family Huddle',                host: 'Kristina Watts' },
  'fif-reset-room':    { name: 'Finding Income Friday / Reset Room', host: 'Fred Roethlisberger, Josh DeTar' },
  'babb':              { name: 'Be a Better Builder',                host: 'Sara Reineke' },
  'tpc':               { name: 'Top Producer Call',                  host: 'Michael Mathews' },
  'su':                { name: 'Skills + Underwriting',              host: 'Kristina Watts, Amber Pearson' },
  'live-dialing':      { name: 'Live Dialing',                       host: null },
  'getting-unstuck':   { name: 'Getting Unstuck',                    host: null },
  'national-call':     { name: 'National Call',                      host: null },
  'corporate-overviews': { name: 'Corporate Overviews',              host: null },
  '__additional__':    { name: 'Additional training',                host: null },
}

// Named strips rendered in order; everything else → additional strip
export const STRIP_ORDER = ['wfh', 'tpc', 'babb', 'fif-reset-room', 'su']

export const SERIES_CHIP_COLORS = {
  'wfh':             { bg: '#E6F3F5', text: '#005365' },
  'fif-reset-room':  { bg: '#EAF3DE', text: '#3B6D11' },
  'babb':            { bg: '#EEEDFE', text: '#3C3489' },
  'tpc':             { bg: '#FAEEDA', text: '#854F0B' },
  'su':              { bg: '#FBEAF0', text: '#72243E' },
  'live-dialing':    { bg: '#E6F1FB', text: '#185FA5' },
  'getting-unstuck': { bg: '#E6EFF5', text: '#185FA5' },
}

export const NEUTRAL_CHIP = { bg: '#EEF1F2', text: '#4A6568' }

export const CHIPS = [
  { label: 'All',              slug: null              },
  { label: 'WFH',              slug: 'wfh'             },
  { label: 'Reset Room',       slug: 'fif-reset-room'  },
  { label: 'BABB',             slug: 'babb'            },
  { label: 'Top Producer',     slug: 'tpc'             },
  { label: 'S+U',              slug: 'su'              },
  { label: 'Live Dialing',     slug: 'live-dialing'    },
  { label: 'Getting Unstuck',  slug: 'getting-unstuck' },
]

export function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function formatSpeakers(speakers) {
  if (!speakers) return ''
  const parts = speakers.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length <= 2) return parts.join(', ')
  return `${parts[0]}, ${parts[1]} +${parts.length - 2}`
}

export function getSeriesChipStyle(seriesSlug) {
  return SERIES_CHIP_COLORS[seriesSlug] ?? NEUTRAL_CHIP
}

export function getSeriesName(seriesSlug) {
  return SERIES_META[seriesSlug]?.name ?? seriesSlug ?? 'Unknown series'
}

export function getEmbedUrl(resource) {
  const { platform, url, vimeo_id } = resource
  if (platform === 'vimeo' && vimeo_id) {
    return `https://player.vimeo.com/video/${vimeo_id}?autoplay=1&title=0&byline=0&portrait=0`
  }
  if (platform === 'youtube') {
    const m = (url ?? '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([a-zA-Z0-9_-]{11})/)
    return m ? `https://www.youtube.com/embed/${m[1]}?autoplay=1` : null
  }
  if (platform === 'loom') {
    const m = (url ?? '').match(/loom\.com\/share\/([a-f0-9]+)/)
    return m ? `https://www.loom.com/embed/${m[1]}?autoplay=1` : null
  }
  return null
}
