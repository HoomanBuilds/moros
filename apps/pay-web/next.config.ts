import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@moros/payments-client", "@moros/payments-crypto-web"],
  async redirects() {
    return ["send", "receive", "request", "activity", "contacts", "deposit", "withdraw", "settings"].map((route) => ({
      source: `/${route}`,
      destination: `/app/${route}`,
      permanent: false,
    }));
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
