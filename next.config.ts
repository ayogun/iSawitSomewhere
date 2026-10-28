import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  serverExternalPackages: ["@elastic/elasticsearch", "jsdom", "@mozilla/readability", "undici", "robots-parser"],
  async headers() {
    const development = process.env.NODE_ENV !== "production";
    return [{
      source: "/:path*", headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: `default-src 'self'; script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${development ? " ws://127.0.0.1:* ws://localhost:*" : ""}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` },
      ]
    }];
  },
};

export default nextConfig;
