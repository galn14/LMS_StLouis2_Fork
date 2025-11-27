import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. DETERMINE COOKIE NAME
  // If we are in production (Vercel) or HTTPS, use the Secure name.
  // Otherwise, use the local name.
  const secureCookie = process.env.NEXTAUTH_URL?.startsWith("https://") ?? !!process.env.VERCEL;
  const cookieName = secureCookie 
    ? "__Secure-next-auth.session-token" 
    : "next-auth.session-token";

  // 2. GET TOKEN WITH EXPLICIT COOKIE NAME
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET, // Ensure this Variable is set in Vercel!
    cookieName, // <--- This is the key fix
  });

  // 3. LOGGING (Updated to help debugging)
  console.log(`Middleware [${pathname}]`, {
    environment: secureCookie ? 'Production (Secure)' : 'Development',
    lookingForCookie: cookieName,
    tokenFound: !!token
  });

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

  // --- LOGIC ---

  if (token) {
    // If user is logged in but trying to access Login -> Go to Dashboard
    if (isPublicRoute) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    // Allow access to protected routes
    return NextResponse.next();
  }

  // No Token Found
  if (!isPublicRoute) {
    // Redirect to login
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