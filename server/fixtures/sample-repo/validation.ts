export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateName(name: string): boolean {
  return name.trim().length >= 2 && name.trim().length <= 100;
}

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateUserInput(input: { name: string; email: string }): ValidationResult {
  if (!validateName(input.name)) return { ok: false, reason: "Invalid name" };
  if (!validateEmail(input.email)) return { ok: false, reason: "Invalid email" };
  return { ok: true };
}
