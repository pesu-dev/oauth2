import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/faq', '/privacy', '/terms', '/docs'],
      disallow: [
        '/oauth2/',
        '/login',
        '/settings',
        '/portal',
        '/admin',
        '/api/',
      ],
    },
  };
}
