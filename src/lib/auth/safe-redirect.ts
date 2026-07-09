export function safeRedirect(path: string | null): string {
  if (!path) return "/";
  // Browsers and the WHATWG URL parser strip tab/CR/LF before parsing a URL, so a
  // literal control character (e.g. from a decoded "%09") can hide a "//" or "/\"
  // prefix from a naive string check. Strip them first so the check sees what a
  // URL parser would eventually see.
  const stripped = path.replace(/[\t\r\n]/g, "");
  if (!stripped.startsWith("/")) return "/";
  if (stripped.startsWith("//") || stripped.startsWith("/\\")) return "/";
  return stripped;
}
