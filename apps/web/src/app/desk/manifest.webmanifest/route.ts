/**
 * PWA manifest for the desk tablet, scoped to /book/desk so installing the
 * desk app never claims the public booking surface. Next's manifest.ts file
 * convention is app-root-only (and the root layout is shared surface), so this
 * is a plain route handler instead.
 */

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0a0a0a"/><text x="256" y="316" font-family="ui-sans-serif,system-ui,sans-serif" font-size="176" font-weight="700" letter-spacing="8" text-anchor="middle" fill="#fafafa">PJ</text></svg>`

export function GET() {
  return Response.json(
    {
      name: 'PLUNJ Desk',
      short_name: 'PLUNJ Desk',
      description: 'Front-desk roster, check-in, and walk-ins for PLUNJ staff.',
      id: '/book/desk',
      start_url: '/book/desk',
      scope: '/book/desk',
      display: 'standalone',
      orientation: 'any',
      background_color: '#fafafa',
      theme_color: '#0a0a0a',
      icons: [
        {
          src: `data:image/svg+xml,${encodeURIComponent(ICON_SVG)}`,
          sizes: 'any',
          type: 'image/svg+xml',
          purpose: 'any',
        },
      ],
    },
    { headers: { 'content-type': 'application/manifest+json' } },
  )
}
