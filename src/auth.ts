import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Allowed email addresses (whitelist)
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "wena369@gmail.com,wena@enartsu.co.jp,wena@369.co.jp")
  .split(",")
  .map((e) => e.trim().toLowerCase());

declare module "next-auth" {
  interface Session {
    accessToken?: string;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile",
          access_type: "offline",
          prompt: "consent",
        },
      },
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
    async jwt({ token, account }) {
      if (account && account.access_token) {
        token.accessToken = account.access_token;
      }
      return token;
    },
    async session({ session, token }: any) {
      if (token && token.accessToken) {
        session.accessToken = token.accessToken;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
    error: "/login",
  },
});
