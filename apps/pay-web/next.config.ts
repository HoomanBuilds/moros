import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  transpilePackages: ["@moros/payments-client", "@moros/payments-crypto-web"],
  async redirects() {
    const paymentRoutes = ["send", "receive", "request", "activity", "contacts", "deposit", "withdraw", "settings"].map((route) => ({
      source: `/${route}`,
      destination: `/app/${route}`,
      permanent: false,
    }));
    return [
      ...["www.moros.fun"].map((host) => ({
        source: "/:path*",
        has: [{ type: "host" as const, value: host }],
        destination: "https://moros.fun/:path*",
        permanent: true,
      })),
      ...paymentRoutes,
    ];
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
