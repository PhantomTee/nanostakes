/** @type {import('next').NextConfig} */
const wardenUrl = process.env.NEXT_PUBLIC_WARDEN_URL;

const nextConfig = {
  // When NEXT_PUBLIC_WARDEN_URL is unset (local dev), proxy API calls to the
  // Warden server on localhost so the pages can keep using relative fetch("/matches") etc.
  async rewrites() {
    if (wardenUrl) return [];
    const target = "http://localhost:4000";
    return [
      { source: "/matches", destination: `${target}/matches` },
      { source: "/ledger", destination: `${target}/ledger` },
      { source: "/health", destination: `${target}/health` },
      { source: "/events", destination: `${target}/events` },
      { source: "/match/:path*", destination: `${target}/match/:path*` },
      { source: "/agents", destination: `${target}/agents` },
      { source: "/agents/:path*", destination: `${target}/agents/:path*` },
      { source: "/mcp/:path*", destination: `${target}/mcp/:path*` },
    ];
  },
};

export default nextConfig;
