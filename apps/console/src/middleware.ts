import type { NextRequest } from "next/server";
import {
  createMiddlewareClient,
  matchesRoute,
} from "@superserve/supabase/middleware";

const PUBLIC_ROUTES = [
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/callback",
  "/auth/auth-code-error",
  "/device",
];

export async function middleware(request: NextRequest) {
  const client = createMiddlewareClient(request);
  if (!client.supabase) return client.response;

  const {
    data: { user },
  } = await client.supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isPublicRoute = matchesRoute(pathname, PUBLIC_ROUTES);

  if (!user && !isPublicRoute) {
    const signinUrl = request.nextUrl.clone();
    signinUrl.pathname = "/auth/signin";
    signinUrl.searchParams.set("next", pathname);
    return Response.redirect(signinUrl);
  }

  return client.response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
