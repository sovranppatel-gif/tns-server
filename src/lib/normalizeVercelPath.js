/**
 * Vercel Functions sometimes mount the Express app at `/api`, so a request to
 * `/api/students` arrives as `/students`. Re-prefix those so existing routes match.
 */
export function normalizeVercelPath(req, _res, next) {
  const raw = req.url || "/";
  const qIndex = raw.indexOf("?");
  const pathname = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = qIndex === -1 ? "" : raw.slice(qIndex);

  if (
    pathname === "/" ||
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/health") ||
    pathname.startsWith("/uploads") ||
    pathname.startsWith("/socket.io")
  ) {
    return next();
  }

  req.url = `/api${pathname.startsWith("/") ? pathname : `/${pathname}`}${query}`;
  next();
}
