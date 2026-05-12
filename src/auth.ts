import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Allowed email addresses (whitelist)
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "wena369@gmail.com,wena@enartsu.co.jp,wena@369.co.jp")
  .split(",")
  .map((e) => e.trim().toLowerCase());

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // Only allow whitelisted email addresses
      const email = user.email?.toLowerCase();
      if (!email || !ALLOWED_EMAILS.includes(email)) {
        return false; // Reject sign-in
      }
      return true;
    },
    async session({ session }) {
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
