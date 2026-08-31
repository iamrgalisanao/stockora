/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@iw/contracts'],
  eslint: {
    // ESLint wiring is a follow-up task; do not fail the build on it yet.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
