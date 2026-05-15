import type { User } from "./User";

export function createUser(name: string, email: string): User {
  return {
    id: crypto.randomUUID(),
    name,
    email,
    createdAt: new Date().toISOString(),
  };
}

export function deleteUser(id: string): Promise<void> {
  return fetch(`/api/users/${id}`, { method: "DELETE" }).then(() => undefined);
}
