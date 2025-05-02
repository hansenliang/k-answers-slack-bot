import { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { JWT } from "next-auth/jwt";
import { Session, Account } from "next-auth";
import { getServerSession } from "next-auth";

/* -------- extend the built-in types -------- */
declare module "next-auth" {
  interface Session {
    /** Gmail / Drive access token we copy from the JWT */
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    /** Copied from OAuth account once after sign-in */
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }
}

/* -------- auth config -------- */
export const authOptions: NextAuthOptions = {
  debug: true, // Enable debug logging
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile " +
            "https://www.googleapis.com/auth/drive " +
            "https://www.googleapis.com/auth/documents",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: { signIn: "/auth/signin" },

  callbacks: {
    async jwt({
      token,
      account,
    }: {
      token: JWT;
      account?: Account | null;
    }): Promise<JWT> {
      // Log the JWT callback
      console.log("JWT callback triggered", { hasAccount: !!account, tokenSub: token.sub });
      
      if (account) {
        console.log("Setting token from account");
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
      }

      // If the token is expired, try to refresh it
      if (token.expiresAt && Date.now() >= token.expiresAt * 1000) {
        console.log("Token expired, attempting refresh");
        try {
          const response = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              client_id: process.env.GOOGLE_CLIENT_ID!,
              client_secret: process.env.GOOGLE_CLIENT_SECRET!,
              grant_type: "refresh_token",
              refresh_token: token.refreshToken!,
            }),
          });

          const tokens = await response.json();

          if (!response.ok) {
            console.error("Token refresh failed:", tokens);
            throw tokens;
          }

          console.log("Token refreshed successfully");
          return {
            ...token,
            accessToken: tokens.access_token,
            expiresAt: Math.floor(Date.now() / 1000 + tokens.expires_in),
          };
        } catch (error) {
          console.error("Error refreshing access token:", error);
          return { ...token, error: "RefreshAccessTokenError" };
        }
      }

      return token;
    },

    async session({
      session,
      token,
    }: {
      session: Session;
      token: JWT;
    }): Promise<Session> {
      console.log("Session callback triggered", { hasToken: !!token, sessionUser: !!session.user });
      session.accessToken = token.accessToken;
      session.refreshToken = token.refreshToken;
      session.expiresAt = token.expiresAt;
      return session;
    },
  },
};

export async function getAuthServerSession() {
  return await getServerSession(authOptions);
} 