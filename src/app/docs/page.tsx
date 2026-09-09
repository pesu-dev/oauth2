import { Metadata } from 'next';
import { getConfig } from '@/lib/config';
import { DocsClient } from './docs-client';

export const metadata: Metadata = {
  title: 'API Reference & Documentation | Sign in with PESU',
  description:
    'Complete OpenID Connect & OAuth 2.0 API reference, parameter specifications, response schemas, and code examples for PESU OAuth2.',
};

export default function DocsPage() {
  const config = getConfig();
  return <DocsClient issuerUrl={config.issuerUrl} />;
}
