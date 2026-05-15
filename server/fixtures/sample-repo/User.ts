export type User = {
  id: string;
  name: string;
  email: string;
  createdAt: string;
};

export class UserRepository {
  private users = new Map<string, User>();

  save(user: User): void {
    this.users.set(user.id, user);
  }

  findById(id: string): User | undefined {
    return this.users.get(id);
  }

  list(): User[] {
    return Array.from(this.users.values());
  }
}
