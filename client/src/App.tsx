import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import RepoPage from "./pages/RepoPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/repo/:id" element={<RepoPage />} />
      </Routes>
    </BrowserRouter>
  );
}
