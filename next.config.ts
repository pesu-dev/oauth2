import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  async redirects() {
    return [
      { source: '/docs/discovery', destination: '/docs#openid-configuration', permanent: true },
      { source: '/docs/jwks', destination: '/docs#jwks', permanent: true },
      { source: '/docs/authorize', destination: '/docs#authorize', permanent: true },
      { source: '/docs/token', destination: '/docs#token', permanent: true },
      { source: '/docs/userinfo', destination: '/docs#userinfo', permanent: true },
      { source: '/docs/revoke', destination: '/docs#revoke', permanent: true },
      { source: '/docs/scopes', destination: '/docs#scopes', permanent: true },
      { source: '/docs/quick-start', destination: '/docs#overview', permanent: true },
    ];
  },
};

export default nextConfig;
