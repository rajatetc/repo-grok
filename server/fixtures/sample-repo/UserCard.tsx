import type { User } from "./User";

export function UserCard({ user }: { user: User }) {
  return (
    <div className="user-card">
      <h3>{user.name}</h3>
      <p>{user.email}</p>
      <small>Joined {user.createdAt}</small>
    </div>
  );
}
