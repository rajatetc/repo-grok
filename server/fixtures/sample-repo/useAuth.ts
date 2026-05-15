import { useState, useEffect } from "react";
import type { User } from "./User";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  function logout() {
    return fetch("/api/logout", { method: "POST" }).then(() => setUser(null));
  }

  return { user, loading, isAuthenticated: !!user, logout };
}
