export interface OpenIdConfiguration {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint: string;
  response_types_supported: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
  grant_types_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

export function buildOpenIdConfiguration(issuerUrl: string): OpenIdConfiguration {
  const issuer = issuerUrl.replace(/\/+$/, '');
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth2/authorize`,
    token_endpoint: `${issuer}/oauth2/token`,
    userinfo_endpoint: `${issuer}/api/v1/userinfo`,
    jwks_uri: `${issuer}/jwks.json`,
    revocation_endpoint: `${issuer}/oauth2/revoke`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['openid', 'profile', 'email', 'phone', 'offline_access'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
  };
}
