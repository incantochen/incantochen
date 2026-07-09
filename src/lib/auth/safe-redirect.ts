export function safeRedirect(path: string | null): string {
  if (!path) return "/";
  // Browsers strip ASCII tab/CR/LF during URL parsing, so a path like
  // "/\t/evil.com" would become "//evil.com" after normalization and
  // slip past the prefix checks below — reject it outright.
  if (/[\t\r\n]/.test(path)) return "/";
  if (!path.startsWith("/")) return "/";
  if (path.startsWith("//") || path.startsWith("/\\")) return "/";
  return path;
}
