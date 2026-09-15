// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DocsPage from '@/app/docs/page';
import { DocsClient } from '@/app/docs/docs-client';

describe('DocsPage & DocsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders DocsPage and mounts DocsClient', () => {
    render(<DocsPage />);
    expect(screen.getByText('Getting Started with Sign in with PESU')).toBeDefined();
  });

  it('renders sidebar navigation items and guides', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    expect(screen.getAllByText('Overview & Quickstart').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mandatory PKCE (S256)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/token').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/userinfo').length).toBeGreaterThan(0);
  });

  it('allows searching documentation sections', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const searchInputs = screen.getAllByPlaceholderText(/search guides & endpoints/i);
    fireEvent.change(searchInputs[0], { target: { value: 'revoke' } });
    expect(screen.getAllByText('/revoke').length).toBeGreaterThan(0);
  });

  it('switches active section when clicked', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const tokenButton = screen.getAllByText('/token')[0].closest('button');
    expect(tokenButton).toBeDefined();
    fireEvent.click(tokenButton!);

    expect(screen.getByText('Token Issuance & Refresh')).toBeDefined();
    expect(screen.getAllByText('POST /token').length).toBeGreaterThan(0);
  });

  it('switches language tabs for sample code', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const tokenButton = screen.getAllByText('/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    const tsTabs = screen.getAllByRole('button', { name: /typescript/i });
    if (tsTabs.length > 0) {
      fireEvent.click(tsTabs[0]);
    }
  });

  it('copies endpoint markdown when clicking Copy for LLM button', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const tokenButton = screen.getAllByText('/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    const copyBtn = screen.getByRole('button', { name: /^copy for llm$/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalled();
  });

  it('toggles mobile menu drawer', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const toggleBtn = screen.getByRole('button', { name: /browse docs/i });
    fireEvent.click(toggleBtn);
    expect(screen.getByRole('button', { name: /close menu/i })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /close menu/i }));
    expect(screen.getByRole('button', { name: /browse docs/i })).toBeDefined();
  });

  it('navigates through guides: pkce, scopes, and nextauth', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);

    // Click PKCE guide
    const pkceBtn = screen.getAllByText('Mandatory PKCE (S256)')[0].closest('button');
    fireEvent.click(pkceBtn!);
    expect(screen.getByText('How PKCE Protects Your Application')).toBeDefined();

    // Click Scopes guide
    const scopesBtn = screen.getAllByText('Scopes & Student Claims')[0].closest('button');
    fireEvent.click(scopesBtn!);
    expect(screen.getByText('Scopes & Student Profile Claims')).toBeDefined();

    // Click NextAuth guide
    const nextAuthBtn = screen.getAllByText('NextAuth.js Integration')[0].closest('button');
    fireEvent.click(nextAuthBtn!);
    expect(screen.getByText('NextAuth.js / Auth.js Integration')).toBeDefined();

    // Click Copy in NextAuth guide
    const copyAuthBtn = screen.getByRole('button', { name: /^copy$/i });
    fireEvent.click(copyAuthBtn);
    expect(writeTextMock).toHaveBeenCalled();
  });

  it('copies full spec for LLM from sidebar', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const copyFullBtn = screen.getByRole('button', { name: /copy for llm \(full\)/i });
    fireEvent.click(copyFullBtn);
    expect(writeTextMock).toHaveBeenCalled();
  });

  it('supports python requests code tab, copy code, and next/prev pagination', () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    // Select /token endpoint
    const tokenButton = screen.getAllByText('/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    // Click Python tab
    const pythonTab = screen.getByRole('button', { name: /python \(requests\)/i });
    fireEvent.click(pythonTab);

    // Click copy code snippet
    const copyCodeBtn = screen.getByTitle('Copy code');
    fireEvent.click(copyCodeBtn);
    expect(writeTextMock).toHaveBeenCalled();

    // Test next/previous pagination
    const prevBtn = screen.getByText('Previous').closest('button');
    expect(prevBtn).toBeDefined();
    fireEvent.click(prevBtn!);

    const nextBtn = screen.getByText('Next').closest('button');
    expect(nextBtn).toBeDefined();
    fireEvent.click(nextBtn!);
  });
});

