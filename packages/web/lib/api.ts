const WARDEN_BASE = process.env.NEXT_PUBLIC_WARDEN_URL ?? "";

export function apiUrl(path: string): string {
  return `${WARDEN_BASE}${path}`;
}
