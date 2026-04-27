import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  // Allow auth API routes
  if (req.nextUrl.pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Allow login page
  if (req.nextUrl.pathname === "/login") {
    return NextResponse.next();
  }

  // Require auth for everything else
  if (!req.auth) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
