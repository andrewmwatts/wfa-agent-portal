// MyInfoSection — pure display, no data fetching.
// Auth fields (role, email, etc.) come from `subject` (users table via ViewingContext).
// Personnel fields (hire_date, contracting, etc.) come from `personnelRow` (personnel table).
// Upline name is resolved from the `personnel` array passed by Dashboard.

export default function MyInfoSection({ subject, canWrite, personnelRow, personnel = [] }) {
  if (!subject) return null

  const roleLabel = {
    super_admin: 'Super Admin',
    owner:       'Agency Owner',
    agent:       'Agent',
  }[subject.role] ?? subject.role

  // Resolve upline display name from personnel roster (no extra fetch needed)
  const uplinePersonnel = subject.upline_sfg_id
    ? personnel.find(p => p.sfg_id?.toLowerCase() === subject.upline_sfg_id?.toLowerCase())
    : null
  const uplineDisplay = uplinePersonnel
    ? `${uplinePersonnel.name || uplinePersonnel.preferred_name || uplinePersonnel.sfg_id} (${uplinePersonnel.sfg_id})`
    : subject.upline_sfg_id ?? '—'

  // Notification email: show only if different from login email
  const notificationEmail = personnelRow?.email && personnelRow.email !== subject.email
    ? personnelRow.email
    : null

  if (!personnelRow && !subject.sfg_id) {
    return <SectionShell title="My Info"><Skeleton /></SectionShell>
  }

  return (
    <SectionShell title="My Info" canWrite={canWrite}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
        <Field label="Name"     value={subject.full_name} />
        <Field label="SFG ID"   value={subject.sfg_id} mono />
        <Field label="Email"    value={subject.email} />
        <Field label="Role"     value={roleLabel} />
        <Field label="Status"   value={subject.is_active ? 'Active' : 'Inactive'}
               accent={subject.is_active} />
        <Field label="Upline"   value={uplineDisplay} />
        <Field label="Hire Date"            value={fmt(personnelRow?.hire_date)} />
        {subject.role === 'owner' && (
          <Field label="Owner Since"        value={fmt(subject.owner_since)} />
        )}
        <Field label="SureLC Profile"       value={fmt(personnelRow?.surelc_profile_date)} />
        <Field label="To Producer"          value={fmt(personnelRow?.contracting_to_producer)} />
        <Field label="Contracting Complete" value={fmt(personnelRow?.contracting_complete)} />
        <Field label="No E&O"               value={personnelRow?.no_eando ? 'Yes' : 'No'} />
        {notificationEmail && (
          <Field label="Notification Email" value={notificationEmail} />
        )}
      </div>
    </SectionShell>
  )
}

function fmt(dateStr) {
  if (!dateStr) return '—'
  // Parse YYYY-MM-DD as local to avoid UTC day-shift
  const iso = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/)
  const d   = iso
    ? new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]))
    : new Date(dateStr)
  return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function Field({ label, value, mono, accent }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-white/40 mb-0.5">{label}</p>
      <p className={`text-sm ${mono ? 'font-mono' : ''} ${accent ? 'text-accent' : 'text-gray-900 dark:text-white'}`}>
        {value ?? '—'}
      </p>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i}>
          <div className="h-2.5 w-16 bg-gray-200 dark:bg-white/10 rounded mb-1.5 animate-pulse" />
          <div className="h-4 w-32 bg-gray-200 dark:bg-white/10 rounded animate-pulse" />
        </div>
      ))}
    </div>
  )
}

export function SectionShell({ title, children }) {
  return (
    <section className="bg-white border border-primary/15 shadow-sm dark:bg-primary/30 dark:border-white/10 dark:shadow-none rounded-2xl p-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-400 dark:text-white/50">{title}</h3>
      </div>
      {children}
    </section>
  )
}
