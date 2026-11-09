import { getSessionCookie } from "better-auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

// A fast first gate: no session cookie, no page. Pages still check the
// session itself (requireActor); a cookie alone proves nothing.
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next()
  const url = new URL("/sign-in", request.url)
  url.searchParams.set(
    "next",
    request.nextUrl.pathname + request.nextUrl.search
  )
  return NextResponse.redirect(url)
}

export const config = {
  // Open: sign-in, guest links (/g/<secret>), consent and the pages Nextcloud
  // frames (/embed: they handle their own state), the auth and
  // MCP endpoints (they answer with OAuth errors, not redirects), uploads
  // (they check the session themselves, and proxy would buffer the body and
  // cut it at 10 MB), discovery documents and static files (pdfjs: the reader's worker and fonts).
  matcher: [
    "/((?!(?:sign-in|g|consent|embed|api/auth|api/upload|mcp|\\.well-known|_next/static|_next/image|pdfjs)(?:/|$)|icon\\.png$|apple-icon\\.png$).*)",
  ],
}
