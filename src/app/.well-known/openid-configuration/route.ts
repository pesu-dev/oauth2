import { NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { buildOpenIdConfiguration } from '@/lib/oidc/discovery';

export async function GET() {
  const config = getConfig();
  const discovery = buildOpenIdConfiguration(config.issuerUrl);
  return NextResponse.json(discovery);
}
