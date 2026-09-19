import { describe, it, expect } from 'vitest';
import {
  API_ENDPOINTS,
  createEndpoints,
  generateEndpointMarkdownForLlm,
  generateFullApiReferenceMarkdown,
} from '@/app/docs/docs-data';

describe('API Reference Documentation Data & LLM Generators', () => {
  it('defines all required endpoints', () => {
    const ids = API_ENDPOINTS.map((ep) => ep.id);
    expect(ids).toContain('openid-configuration');
    expect(ids).toContain('jwks');
    expect(ids).toContain('authorize');
    expect(ids).toContain('token');
    expect(ids).toContain('userinfo');
    expect(ids).toContain('revoke');
    expect(ids).not.toContain('token-exchange');
  });

  it('provides parameters, responses, and examples for each endpoint', () => {
    for (const ep of API_ENDPOINTS) {
      expect(ep.path).toMatch(/^\//);
      expect(ep.title).toBeTruthy();
      expect(ep.summary).toBeTruthy();
      expect(ep.description).toBeTruthy();
      expect(ep.responses.length).toBeGreaterThan(0);
      expect(ep.curlSample).toBeTruthy();
      expect(ep.fetchSample).toBeTruthy();
      expect(ep.pythonSample).toBeTruthy();

      // Ensure every response has a status code and description
      for (const resp of ep.responses) {
        expect(resp.status).toBeGreaterThanOrEqual(200);
        expect(resp.status).toBeLessThan(600);
        expect(resp.statusText).toBeTruthy();
        expect(resp.description).toBeTruthy();
      }
    }
  });

  it('formats single endpoint into LLM-friendly markdown with Copy for LLM', () => {
    const tokenEp = API_ENDPOINTS.find((ep) => ep.id === 'token');
    expect(tokenEp).toBeDefined();

    const md = generateEndpointMarkdownForLlm(tokenEp!);
    expect(md).toContain('# API Reference: Token Issuance & Refresh');
    expect(md).toContain('`POST /oauth2/token`');
    expect(md).toContain('## Request Headers');
    expect(md).toContain('## Parameters');
    expect(md).toContain('`grant_type`');
    expect(md).toContain('`code_verifier`');
    expect(md).toContain('## Responses');
    expect(md).toContain('### `200 OK`');
    expect(md).toContain('## Request Example (cURL)');
    expect(md).toContain('## Request Example (TypeScript / Fetch)');
    expect(md).toContain('## Request Example (Python / requests)');
  });

  it('handles optional fields without default or examples in generateEndpointMarkdownForLlm', () => {
    const customEp = {
      id: 'custom',
      title: 'Custom Endpoint',
      method: 'GET' as const,
      path: '/custom',
      auth: 'None',
      summary: 'Custom',
      description: 'Custom desc',
      category: 'Authentication & Tokens' as const,
      headers: [{ name: 'X-Optional', location: 'header' as const, type: 'string', required: false, description: 'Optional header' }],
      params: [{ name: 'opt_param', location: 'query' as const, type: 'string', required: false, description: 'Optional param' }],
      responses: [],
      curlSample: 'curl ...',
      fetchSample: 'fetch ...',
      pythonSample: 'requests ...',
    };

    const md = generateEndpointMarkdownForLlm(customEp);
    expect(md).toContain('No');
    expect(md).toContain('-');
  });

  it('formats the full API reference markdown for LLM export', () => {
    const fullMd = generateFullApiReferenceMarkdown();
    expect(fullMd).toContain('# PESU OAuth2 / OpenID Connect Complete API Reference');
    expect(fullMd).toContain('POST /oauth2/token');
    expect(fullMd).toContain('GET / POST /api/v1/userinfo');
    expect(fullMd).toContain('POST /oauth2/revoke');
    expect(fullMd).toContain('GET /oauth2/authorize');
    expect(fullMd).toContain('GET /.well-known/openid-configuration');
  });

  it('respects configured base URL when generating endpoints and samples', () => {
    const customBase = 'https://oauth2-staging-66snrlj46a-uc.a.run.app';
    const customEndpoints = createEndpoints(customBase);
    const tokenEp = customEndpoints.find((ep) => ep.id === 'token')!;
    expect(tokenEp.curlSample).toContain(customBase);
    expect(tokenEp.fetchSample).toContain(customBase);
    expect(tokenEp.pythonSample).toContain(customBase);

    const md = generateEndpointMarkdownForLlm(tokenEp, customBase);
    expect(md).toContain(`**Full URL:** \`${customBase}/oauth2/token\``);
  });

  it('respects configured apiVersion when generating resource server endpoints', () => {
    const customEndpoints = createEndpoints(undefined, 'v2');
    const userinfoEp = customEndpoints.find((ep) => ep.id === 'userinfo')!;
    expect(userinfoEp.path).toBe('/api/v2/userinfo');
    expect(userinfoEp.curlSample).toContain('/api/v2/userinfo');
    expect(userinfoEp.fetchSample).toContain('/api/v2/userinfo');
    expect(userinfoEp.pythonSample).toContain('/api/v2/userinfo');
    expect(userinfoEp.description).toContain('(v2)');
  });
});
