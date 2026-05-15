import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";

const RepoPage = lazy(() => import("./pages/RepoPage"));

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div style={{ height: "100vh", background: "var(--bg)" }} />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/repo/:id" element={<RepoPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
