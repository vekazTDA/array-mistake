import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Refreshes the Supabase session cookie on every request.
 *
 * Without this, an access token that expires mid-session isn't renewed, and
 * server-side getUser() starts returning null while the customer is still
 * using the app — which surfaces as an unexplained bounce to /login.
 *
 * Note this is the *Supabase* session, which is unrelated to the Array
 * userToken. Both expire, on different clocks, for different reasons.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Touching getUser() is what triggers the refresh. Don't remove it.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  /**
   * Defence in depth, not a data boundary.
   *
   * /enroll and /dashboard are client components that already redirect when
   * there's no session, and neither renders anything sensitive on its own —
   * the credit data arrives from Array in the browser, gated by a userToken
   * that only the server-side route will mint. So this doesn't close a leak.
   *
   * What it does is stop an unauthenticated visitor loading the page shell,
   * mounting an Array component with no token, and getting a broken screen
   * instead of a login form.
   */
  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

const PROTECTED_PREFIXES = ["/enroll", "/dashboard"];

export const config = {
  matcher: [
    /**
     * Everything except static assets. Array's component scripts are loaded
     * from embed.array.io by the browser, so they never pass through here.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
