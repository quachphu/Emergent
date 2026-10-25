import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { Skeleton } from "./components/ui/misc";
import { useAuth } from "./lib/auth";
import AuthPage from "./pages/Auth";
import CommandCenter from "./pages/CommandCenter";
import Setup from "./pages/Setup";

const Welcome = lazy(() => import("./pages/Welcome"));
const Stuff = lazy(() => import("./pages/Stuff"));
const Transport = lazy(() => import("./pages/Transport"));
const OldHome = lazy(() => import("./pages/OldHome"));
const NewHome = lazy(() => import("./pages/NewHome"));
const Admin = lazy(() => import("./pages/Admin"));
const RunPage = lazy(() => import("./pages/Run"));
const MapPage = lazy(() => import("./pages/MapPage"));
const Vault = lazy(() => import("./pages/Vault"));
const InboxPage = lazy(() => import("./pages/Inbox"));
const SettingsPage = lazy(() => import("./pages/Settings"));
const PublicListing = lazy(() => import("./pages/PublicListing"));
const PhoneCapture = lazy(() => import("./pages/PhoneCapture"));
const Checkout = lazy(() => import("./pages/Checkout"));
const HandoffBoard = lazy(() => import("./pages/HandoffBoard"));
const PublicOffer = lazy(() => import("./pages/PublicOffer"));

function PageFallback() {
  return (
    <div className="space-y-4 p-6" aria-busy>
      <Skeleton className="h-10 w-64" />
      <Skeleton className="h-40 w-full" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}</div>
    </div>
  );
}

function Protected({ children, shell = true }: { children: ReactNode; shell?: boolean }) {
  const { user, hasMove, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageFallback />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!hasMove && location.pathname !== "/setup") return <Navigate to="/setup" replace />;
  return shell ? <AppShell>{children}</AppShell> : <>{children}</>;
}

export default function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/signup" element={<AuthPage initialMode="signup" />} />
        <Route path="/l/:slug" element={<PublicListing />} />
        <Route path="/capture/:token" element={<PhoneCapture />} />
        <Route path="/handoff" element={<HandoffBoard />} />
        <Route path="/offer/:id" element={<PublicOffer />} />
        <Route path="/setup" element={<Protected shell={false}><Setup /></Protected>} />
        <Route path="/welcome" element={<Protected shell={false}><Welcome /></Protected>} />
        <Route path="/checkout/:bookingId" element={<Protected shell={false}><Checkout /></Protected>} />
        <Route path="/" element={<Protected><CommandCenter /></Protected>} />
        <Route path="/stuff" element={<Protected><Stuff /></Protected>} />
        <Route path="/transport" element={<Protected><Transport /></Protected>} />
        <Route path="/old-home" element={<Protected><OldHome /></Protected>} />
        <Route path="/new-home" element={<Protected><NewHome /></Protected>} />
        <Route path="/admin" element={<Protected><Admin /></Protected>} />
        <Route path="/run" element={<Protected><RunPage /></Protected>} />
        <Route path="/map" element={<Protected><MapPage /></Protected>} />
        <Route path="/vault" element={<Protected><Vault /></Protected>} />
        <Route path="/inbox" element={<Protected><InboxPage /></Protected>} />
        <Route path="/settings" element={<Protected><SettingsPage /></Protected>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
