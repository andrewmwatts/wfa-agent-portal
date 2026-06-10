import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import PWAUpdatePrompt from './components/PWAUpdatePrompt'
import { AgencyProvider } from './context/AgencyContext'
import { ViewingProvider } from './context/ViewingContext'
import { ThemeProvider } from './context/ThemeContext'
import ProtectedRoute from './routes/ProtectedRoute'
import AppLayout from './components/AppLayout'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import AcceptInvite from './pages/AcceptInvite'
import Dashboard from './pages/Dashboard'
import PoliciesPage from './pages/PoliciesPage'
import OnboardingPage from './pages/OnboardingPage'
import EngagementPage from './pages/EngagementPage'
import MonthlyMetricsPage from './pages/MonthlyMetricsPage'
import WeeklyMetricsPage from './pages/WeeklyMetricsPage'
import MonthlyAgentTotalsPage from './pages/MonthlyAgentTotalsPage'
import AgentsPage from './pages/AgentsPage'
import AccountabilityPage from './pages/AccountabilityPage'
import CoachingPage from './pages/CoachingPage'
import ActivityPage from './pages/ActivityPage'
import LeadsPage from './pages/LeadsPage'
import RecruitingPage from './pages/RecruitingPage'
import CarrierMetricsPage from './pages/CarrierMetricsPage'
import Admin from './pages/Admin'
import AdminToolsPage from './pages/AdminToolsPage'
import SnapshotPage from './pages/SnapshotPage'
import IncomePage from './pages/IncomePage'

export default function App() {
  return (
    <>
    <ThemeProvider>
    <AuthProvider>
      <AgencyProvider>
      <ViewingProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />

            {/* All authenticated users */}
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard"       element={<Dashboard />} />
                <Route path="/policies"        element={<PoliciesPage />} />
                <Route path="/engagement"      element={<EngagementPage />} />
                <Route path="/monthly-metrics"  element={<MonthlyMetricsPage />} />
                <Route path="/weekly-metrics"   element={<WeeklyMetricsPage />} />
                <Route path="/carrier-metrics"  element={<CarrierMetricsPage />} />
                <Route path="/income"          element={<IncomePage />} />
                <Route path="/activity"        element={<ActivityPage />} />
                <Route path="/leads"           element={<LeadsPage />} />
                <Route path="/recruiting"      element={<RecruitingPage />} />
              </Route>
            </Route>

            {/* Leader, Owner, Director, Admin */}
            <Route element={<ProtectedRoute allowedRoles={['leader', 'owner', 'director', 'super_admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/contracting"          element={<OnboardingPage />} />
                <Route path="/monthly-agent-totals" element={<MonthlyAgentTotalsPage />} />
                <Route path="/coaching"             element={<CoachingPage />} />
                <Route path="/agents"               element={<AgentsPage />} />
              </Route>
            </Route>

            {/* Owner, Director, Admin only */}
            <Route element={<ProtectedRoute allowedRoles={['owner', 'director', 'super_admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/accountability" element={<AccountabilityPage />} />
                <Route path="/snapshot"       element={<SnapshotPage />} />
              </Route>
            </Route>

            {/* Admin only */}
            <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/admin"       element={<Admin />} />
                <Route path="/admin-tools" element={<AdminToolsPage />} />
              </Route>
            </Route>

            {/* Catch-all */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </ViewingProvider>
      </AgencyProvider>
    </AuthProvider>
    </ThemeProvider>
    <PWAUpdatePrompt />
    </>
  )
}
