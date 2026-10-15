import type { NextConfig } from "next";

// In development the browser talks only to Next.js, which forwards /api to the Go API, so
// cookies stay first-party and no CORS is needed. In production a reverse proxy does the
// same routing in front of both services.
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:8100";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
