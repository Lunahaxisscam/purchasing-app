/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/kabineku-invoice/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Content-Security-Policy', value: "default-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src data:; form-action 'none'; base-uri 'none'" },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, max-age=0, must-revalidate',
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
