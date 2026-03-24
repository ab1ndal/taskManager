export function resolveNext(rawNext: string | null, origin: string): string {
  if (!rawNext) return "/tasks";
  try {
    const decoded = decodeURIComponent(rawNext);
    // Must start with / but not // (protocol-relative)
    if (!decoded.startsWith("/") || decoded.startsWith("//")) return "/tasks";
    const url = new URL(decoded, origin);
    if (url.origin === origin) return decoded;
  } catch {
    // malformed — fall through
  }
  return "/tasks";
}
