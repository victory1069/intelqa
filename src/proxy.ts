import { NextResponse, type NextRequest } from "next/server";

/**
 * E17: Opera Mini (extreme/data-saver mode) renders pages on Opera's servers and runs almost no
 * JavaScript, so the app can't work there. Those students get a plain page that needs no JS,
 * with the link to copy into Chrome. Everyone else passes straight through.
 */
export function proxy(request: NextRequest) {
  const ua = request.headers.get("user-agent") ?? "";
  if (/Opera Mini|OPiOS.*Mini/i.test(ua)) {
    return NextResponse.rewrite(new URL("/unsupported.html", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: skip the API, build assets and anything with a file extension (sw.js, icons…).
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
