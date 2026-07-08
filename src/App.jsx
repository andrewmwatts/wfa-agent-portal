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
import NotFound from './pages/NotFound'
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
import Project100Page from './pages/Project100Page'
import CarrierMetricsPage from './pages/CarrierMetricsPage'
import Admin from './pages/Admin'
import AdminToolsPage from './pages/AdminToolsPage'
import SnapshotPage from './pages/SnapshotPage'
import IncomePage from './pages/IncomePage'
import Landing from './pages/public/Landing'
import VideoLibrary from './pages/public/VideoLibrary'
import CalendarPage from './pages/public/CalendarPage'
import UnderwritingPage from './pages/public/UnderwritingPage'
import PublicLayout from './components/public/PublicLayout'

function ComingSoon({ title }) {
  return (
    <PublicLayout>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '64px 28px', textAlign: 'center' }}>
        <p style={{ fontSize: 11, color: '#7A9499', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: 'Inter, sans-serif', margin: '0 0 8px' }}>Coming soon</p>
        <h1 style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 28, fontWeight: 500, color: '#003539', margin: 0 }}>{title}</h1>
      </div>
    </PublicLayout>
  )
}

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
                <Route path="/portal/dashboard"       element={<Dashboard />} />
                <Route path="/portal/policies"        element={<PoliciesPage />} />
                <Route path="/portal/engagement"      element={<EngagementPage />} />
                <Route path="/portal/monthly-metrics" element={<MonthlyMetricsPage />} />
                <Route path="/portal/weekly-metrics"  element={<WeeklyMetricsPage />} />
                <Route path="/portal/carrier-metrics" element={<CarrierMetricsPage />} />
                <Route path="/portal/income"          element={<IncomePage />} />
                <Route path="/portal/activity"        element={<ActivityPage />} />
                <Route path="/portal/leads"           element={<LeadsPage />} />
                <Route path="/portal/recruiting"      element={<RecruitingPage />} />
                <Route path="/portal/project-100"     element={<Project100Page />} />
              </Route>
            </Route>

            {/* Leader, Owner, Director, Admin */}
            <Route element={<ProtectedRoute allowedRoles={['leader', 'owner', 'director', 'super_admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/portal/contracting"          element={<OnboardingPage />} />
                <Route path="/portal/monthly-agent-totals" element={<MonthlyAgentTotalsPage />} />
                <Route path="/portal/coaching"             element={<CoachingPage />} />
                <Route path="/portal/agents"               element={<AgentsPage />} />
              </Route>
            </Route>

            {/* Owner, Director, Admin only */}
            <Route element={<ProtectedRoute allowedRoles={['owner', 'director', 'super_admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/portal/accountability" element={<AccountabilityPage />} />
                <Route path="/portal/promotions"     element={<SnapshotPage />} />
              </Route>
            </Route>

            {/* Admin only */}
            <Route element={<ProtectedRoute allowedRoles={['super_admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/portal/admin"       element={<Admin />} />
                <Route path="/portal/admin-tools" element={<AdminToolsPage />} />
              </Route>
            </Route>

            {/* Public site */}
            <Route path="/"           element={<Landing />} />
            <Route path="/videos"     element={<VideoLibrary />} />
            <Route path="/resources"  element={<ComingSoon title="Documents & guides" />} />
            <Route path="/calendar"   element={<CalendarPage />} />
            <Route path="/guidelines" element={<UnderwritingPage />} />

            {/* Unknown /portal/* paths → dashboard */}
            <Route path="/portal/*" element={<Navigate to="/portal/dashboard" replace />} />

            {/* Catch-all for truly unknown paths */}
            <Route path="*" element={<NotFound />} />
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
