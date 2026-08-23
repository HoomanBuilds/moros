import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { legacyPredictDestination } from "./lib/legacy-predict-redirect";

export function proxy(request: NextRequest) {
  const forwardedHost =
    request.headers.get("x-forwarded-host") || request.headers.get("host");
  const destination = legacyPredictDestination(request.url, forwardedHost);
  return destination ? NextResponse.redirect(destination, 308) : NextResponse.next();
}

export const config = {
  matcher: "/app/:path*",
};
