import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import LandingPage from "./pages/LandingPage";

const RepoPage = lazy(() => import("./pages/RepoPage"));

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<div className="suspense-fallback" />}>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/repo/:id" element={<RepoPage />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
