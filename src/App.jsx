import { lazy } from 'react'
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
import Landing from './pages/public/Landing'
import VideoLibrary from './pages/public/VideoLibrary'
import VideoBrowse from './pages/public/VideoBrowse'
import CalendarPage from './pages/public/CalendarPage'
import UnderwritingPage from './pages/public/UnderwritingPage'
import NewYorkOptionsPage from './pages/public/NewYorkOptionsPage'
import PrivacyPolicy from './pages/public/PrivacyPolicy'
import TermsOfService from './pages/public/TermsOfService'
import ResourcesPage from './pages/public/ResourcesPage'

// Portal pages load on demand: they are only reached after sign-in, and keeping them out
// of the entry bundle leaves it small enough for the service worker to precache.
// AppLayout wraps <Outlet /> in <Suspense> for the loading state.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const PoliciesPage = lazy(() => import('./pages/PoliciesPage'))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'))
const EngagementPage = lazy(() => import('./pages/EngagementPage'))
const MonthlyMetricsPage = lazy(() => import('./pages/MonthlyMetricsPage'))
const WeeklyMetricsPage = lazy(() => import('./pages/WeeklyMetricsPage'))
const MonthlyAgentTotalsPage = lazy(() => import('./pages/MonthlyAgentTotalsPage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const AccountabilityPage = lazy(() => import('./pages/AccountabilityPage'))
const CoachingPage = lazy(() => import('./pages/CoachingPage'))
const ActivityPage = lazy(() => import('./pages/ActivityPage'))
const LeadsPage = lazy(() => import('./pages/LeadsPage'))
const RecruitingPage = lazy(() => import('./pages/RecruitingPage'))
const Project100Page = lazy(() => import('./pages/Project100Page'))
const NinetyDayPlanPage = lazy(() => import('./pages/NinetyDayPlanPage'))
const CarrierMetricsPage = lazy(() => import('./pages/CarrierMetricsPage'))
const Admin = lazy(() => import('./pages/Admin'))
const AdminToolsPage = lazy(() => import('./pages/AdminToolsPage'))
const SnapshotPage = lazy(() => import('./pages/SnapshotPage'))
const IncomePage = lazy(() => import('./pages/IncomePage'))

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
                <Route path="/portal/ninety-day-plan" element={<NinetyDayPlanPage />} />
                <Route path="/portal/monthly-agent-totals" element={<MonthlyAgentTotalsPage />} />
              </Route>
            </Route>

            {/* Leader, Owner, Director, Admin */}
            <Route element={<ProtectedRoute allowedRoles={['leader', 'owner', 'director', 'super_admin']} />}>
              <Route element={<AppLayout />}>
                <Route path="/portal/contracting"          element={<OnboardingPage />} />
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
            <Route path="/videos/browse" element={<VideoBrowse />} />
            <Route path="/resources"  element={<ResourcesPage />} />
            <Route path="/calendar"   element={<CalendarPage />} />
            <Route path="/guidelines" element={<UnderwritingPage />} />
            <Route path="/guidelines/new-york" element={<NewYorkOptionsPage />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms"   element={<TermsOfService />} />

            {/* /portal and unknown /portal/* paths → dashboard (ProtectedRoute handles auth redirect) */}
            <Route path="/portal"   element={<Navigate to="/portal/dashboard" replace />} />
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
