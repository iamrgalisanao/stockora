/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @iw/contracts ships prebuilt CommonJS + type declarations, so it is consumed as a
  // normal dependency. It must NOT be transpiled: Next's dev react-refresh loader would
  // inject import.meta into the CJS module and fail to parse it.
  eslint: {
    // ESLint wiring is a follow-up task; do not fail the build on it yet.
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;
