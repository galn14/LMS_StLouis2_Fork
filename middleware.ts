import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- FIX START ---
  // Check directly if the browser sent the Secure cookie
  // This works in Local (HTTP) AND Production (HTTPS) automatically
  const hasSecureCookie = request.cookies.has('__Secure-next-auth.session-token');
  
  const cookieName = hasSecureCookie
    ? '__Secure-next-auth.session-token' // Use this if present
    : 'next-auth.session-token';         // Fallback for localhost

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
    cookieName, // We tell getToken exactly which name to read
  });
  // --- FIX END ---

  // Logging to confirm the fix
  console.log(`Middleware [${pathname}]`, {
    detectedCookieName: cookieName,
    tokenFound: !!token
  });

  // ----------------------------------------------------
  // The rest of your logic remains exactly the same...
  // ----------------------------------------------------

  // Skip static files
  if (
    pathname.startsWith('/api/auth') || 
    pathname.startsWith('/_next/') || 
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/icons/') ||
    pathname.includes('.') 
  ) {
    return NextResponse.next();
  }

  const publicRoutes = ['/login', '/register'];
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route));

  if (token) {
    if (isPublicRoute) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    return NextResponse.next();
  }

  if (!isPublicRoute) {
    const url = new URL('/login', request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico|images|icons).*)',
  ],
};