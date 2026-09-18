import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/faq', '/privacy', '/terms', '/docs'],
      disallow: [
        '/authorize',
        '/login',
        '/consent',
        '/settings',
        '/portal',
        '/admin',
        '/token',
        '/userinfo',
        '/oauth/token-exchange',
        '/revoke',
        '/api/',
      ],
    },
  };
}
