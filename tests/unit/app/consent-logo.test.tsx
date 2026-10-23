// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConsentClient } from '@/app/oauth2/authorize/consent-client';

describe('consent logo', () => {
  it('shows an approved logo with alt text, and nothing otherwise', () => {
    const props = {
      userName: 'Student',
      requestedScopes: ['openid'],
      mode: 'identity' as const,
      redirectUri: 'https://x/cb',
      codeChallenge: 'c',
      codeChallengeMethod: 'S256',
    };
    const { unmount } = render(
      <ConsentClient
        {...props}
        client={{ clientId: 'cli_1', name: 'Robo', publishingStatus: 'production', delegatedAllowed: false, logoUrl: '/img/img_1', publisher: 'Robotics Club' }}
      />
    );
    expect(screen.getByAltText('Robo logo').getAttribute('src')).toBe('/img/img_1');
    expect(screen.getByText('Published by')).toBeDefined();
    unmount();

    render(<ConsentClient {...props} client={{ clientId: 'cli_1', name: 'Robo', publishingStatus: 'production', delegatedAllowed: false }} />);
    expect(screen.queryByAltText('Robo logo')).toBeNull();
  });
});
