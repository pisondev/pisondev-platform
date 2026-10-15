import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate: no session cookie means straight to /login. The API still checks the
// session on every request; this only avoids rendering private pages for nobody.
export function proxy(request: NextRequest) {
  if (request.cookies.has("pd_session")) {
    return NextResponse.next();
  }
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|login|_next|favicon.ico|robots.txt).*)"],
};
