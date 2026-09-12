import { useAgency } from '../context/AgencyContext'

// Shown anywhere in the portal while a super_admin is previewing an agency's
// branding from Admin Tools — the preview applies globally (it's just CSS
// custom properties on the document root), so this is the one place to find
// and clear it again after navigating away from Admin Tools.
export default function AgencyPreviewBanner() {
  const { preview, setPreview } = useAgency()
  if (!preview) return null

  return (
    <div className="bg-accent/10 border-b border-accent/20 px-6 py-2 flex items-center gap-3">
      <span className="text-xs font-semibold uppercase tracking-widest text-accent">
        Previewing branding
      </span>
      <span className="text-sm font-medium text-gray-900 dark:text-white">
        {preview.name || preview.sfg_id}
      </span>
      <button
        onClick={() => setPreview(null)}
        className="ml-auto text-xs font-semibold text-accent hover:underline"
      >
        Stop previewing
      </button>
    </div>
  )
}
