import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const DEV_BYPASS = import.meta.env.VITE_BYPASS_AUTH === 'true'

export default function ProtectedRoute({ allowedRoles }) {
  const { session, role, loading, pendingInvite } = useAuth()

  if (DEV_BYPASS) return <Outlet />

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-secondary">
        <span className="text-gray-400 dark:text-white/40 text-sm">Loading…</span>
      </div>
    )
  }

  if (!session) return <Navigate to="/login" replace />

  // Invite-only session — no portal profile yet
  if (pendingInvite) return <Navigate to="/accept-invite" replace />

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
