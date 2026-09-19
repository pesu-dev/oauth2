// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '@/app/page';
import FaqPage from '@/app/faq/page';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import NotFound from '@/app/not-found';
import RootLayout from '@/app/layout';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

describe('Public Static Pages', () => {
  it('renders RootLayout with header, navigation, and footer', () => {
    render(
      <RootLayout>
        <div data-testid="page-child">Test Content</div>
      </RootLayout>
    );
    expect(screen.getByTestId('page-child')).toBeDefined();
    expect(screen.getByText('PESU OAuth2')).toBeDefined();
    expect(screen.getByText('Terms of Service')).toBeDefined();
    expect(screen.getByText(/PESU Developer Community/i)).toBeDefined();
  });
  it('renders HomePage with hero and features', () => {
    render(<HomePage />);
    expect(screen.getByText(/Sign in with PESU/i)).toBeDefined();
    expect(screen.getByText(/OpenID Connect 1.0 Provider/i)).toBeDefined();
    expect(screen.getByText(/Zero Password Exposure/i)).toBeDefined();
    expect(screen.getByText(/AES-256-GCM Vault/i)).toBeDefined();
  });

  it('renders FaqPage with questions', () => {
    render(<FaqPage />);
    expect(screen.getByText(/Frequently Asked Questions/i)).toBeDefined();
    expect(screen.getByText(/Is this an official PESU \/ PESU Academy product\?/i)).toBeDefined();
  });

  it('renders PrivacyPage with data policies', () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/Privacy Policy & Data Security/i)).toBeDefined();
    expect(screen.getByText(/1. Zero-Exposure Credential Policy/i)).toBeDefined();
  });

  it('renders TermsPage with terms and acceptable use', () => {
    render(<TermsPage />);
    expect(screen.getByText(/Terms of Service/i)).toBeDefined();
    expect(screen.getByText(/1. Unofficial Community Project & Non-Affiliation/i)).toBeDefined();
    expect(screen.getByText(/2. Developer Obligations & Acceptable Use/i)).toBeDefined();
    expect(screen.getByText(/3. Disclaimer of Warranties & Limitation of Liability/i)).toBeDefined();
    expect(screen.getByText(/4. Client Suspension & Service Revocation/i)).toBeDefined();
    expect(screen.getByText(/5. Intellectual Property & Trademarks/i)).toBeDefined();
  });

  it('renders NotFound page with navigation links', () => {
    render(<NotFound />);
    expect(screen.getByText(/Page not found/i)).toBeDefined();
    expect(screen.getByText(/404 Error/i)).toBeDefined();
    expect(screen.getByText(/Return to Home/i)).toBeDefined();
  });
});
