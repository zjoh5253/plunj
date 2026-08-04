import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Served at plunj.co/book/* via Vercel rewrites from the marketing site
  basePath: '/book',
  transpilePackages: [
    '@plunj/api',
    '@plunj/availability',
    '@plunj/db',
    '@plunj/money',
    '@plunj/notifications',
    '@plunj/payments',
  ],
}

export default nextConfig
