import { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { FullPageMessage, Layout } from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';
import AdminPage from './pages/Admin';
import ClaimsPage from './pages/Claims';
import HomePage from './pages/Home';
import LoginPage from './pages/Login';
import MatchDetailPage from './pages/MatchDetail';
import { CreateMatchPage, QuickMatchPage } from './pages/MatchForms';
import MatchesPage from './pages/Matches';
import MePage from './pages/Me';
import NotificationsPage from './pages/Notifications';
import OnboardingPage from './pages/Onboarding';
import { PlayerDetailPage, PlayersPage } from './pages/Players';
import ScoringPage from './pages/Scoring';
import StatsPage from './pages/Stats';
import { JoinTeamPage, TeamDetailPage, TeamFormPage, TeamsPage } from './pages/Teams';
import { TournamentDetailPage, TournamentFormPage, TournamentsPage } from './pages/Tournaments';

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading text="Signing in…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  if (!user.isOnboarded && loc.pathname !== '/onboarding') return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="matches" element={<MatchesPage />} />
        <Route path="matches/new" element={<CreateMatchPage />} />
        <Route path="matches/quick" element={<QuickMatchPage />} />
        <Route path="matches/:id" element={<MatchDetailPage />} />
        <Route path="matches/:id/score" element={<ScoringPage />} />
        <Route path="tournaments" element={<TournamentsPage />} />
        <Route path="tournaments/new" element={<TournamentFormPage />} />
        <Route path="tournaments/:id" element={<TournamentDetailPage />} />
        <Route path="tournaments/:id/edit" element={<TournamentFormPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/new" element={<TeamFormPage />} />
        <Route path="teams/join" element={<JoinTeamPage />} />
        <Route path="teams/:id" element={<TeamDetailPage />} />
        <Route path="teams/:id/edit" element={<TeamFormPage />} />
        <Route path="players" element={<PlayersPage />} />
        <Route path="players/:id" element={<PlayerDetailPage />} />
        <Route path="me" element={<MePage />} />
        <Route path="claims" element={<ClaimsPage />} />
        <Route path="stats" element={<StatsPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<FullPageMessage title="Page not found">That page doesn't exist.</FullPageMessage>} />
      </Route>
    </Routes>
  );
}
