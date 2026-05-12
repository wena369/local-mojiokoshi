import { auth } from "@/auth";
import { NextResponse } from "next/server";

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "wena369@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export async function GET() {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ isAdmin: false });
  }
  const email = session.user.email.toLowerCase();
  const isAdmin = ADMIN_EMAILS.includes(email);
  return NextResponse.json({ isAdmin });
}
