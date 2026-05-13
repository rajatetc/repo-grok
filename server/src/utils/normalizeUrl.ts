export function normalizeUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/$/, "");
}
