import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import { Spinner } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Satellites from './pages/Satellites.jsx';
import SatelliteDetail from './pages/SatelliteDetail.jsx';
import Stations from './pages/Stations.jsx';
import StationDetail from './pages/StationDetail.jsx';
import Scheduling from './pages/Scheduling.jsx';
import Sessions from './pages/Sessions.jsx';
import Bandwidth from './pages/Bandwidth.jsx';
import Contracts from './pages/Contracts.jsx';
import Anomalies from './pages/Anomalies.jsx';
import Reports from './pages/Reports.jsx';
import Admin from './pages/Admin.jsx';
import Audit from './pages/Audit.jsx';

function Guard({ children, staff, admin }) {
  const { user, isStaff, isAdmin } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if ((staff && !isStaff) || (admin && !isAdmin)) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="center-screen"><Spinner label="Starting SCMS" /></div>;
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="satellites" element={<Satellites />} />
        <Route path="satellites/:id" element={<SatelliteDetail />} />
        <Route path="stations" element={<Stations />} />
        <Route path="stations/:id" element={<StationDetail />} />
        <Route path="scheduling" element={<Guard staff><Scheduling /></Guard>} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="bandwidth" element={<Bandwidth />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="anomalies" element={<Anomalies />} />
        <Route path="reports" element={<Guard staff><Reports /></Guard>} />
        <Route path="admin" element={<Guard admin><Admin /></Guard>} />
        <Route path="audit" element={<Guard admin><Audit /></Guard>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
