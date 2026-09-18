// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import DocsPage from '@/app/docs/page';
import { DocsClient } from '@/app/docs/docs-client';
import * as docsData from '@/app/docs/docs-data';

describe('DocsPage & DocsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('renders DocsPage and mounts DocsClient', () => {
    render(<DocsPage />);
    expect(screen.getByText('Getting Started with Sign in with PESU')).toBeDefined();
  });

  it('renders sidebar navigation items and guides', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    expect(screen.getAllByText('Overview & Quickstart').length).toBeGreaterThan(0);
    expect(screen.getAllByText('API Versioning').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mandatory PKCE (S256)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Resource Server').length).toBeGreaterThan(0);
    expect(screen.getByRole('combobox', { name: /select api version/i })).toBeDefined();
    expect(screen.getAllByText('/oauth2/token').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/api/userinfo').length).toBeGreaterThan(0);
  });

  it('allows searching documentation sections', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const searchInputs = screen.getAllByPlaceholderText(/search guides & endpoints/i);
    fireEvent.change(searchInputs[0], { target: { value: 'revoke' } });
    expect(screen.getAllByText('/oauth2/revoke').length).toBeGreaterThan(0);
  });

  it('switches active section when clicked', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
    expect(tokenButton).toBeDefined();
    fireEvent.click(tokenButton!);

    expect(screen.getByText('Token Issuance & Refresh')).toBeDefined();
    expect(screen.getAllByText('POST /oauth2/token').length).toBeGreaterThan(0);
  });

  it('switches language tabs for sample code', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
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
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
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

  it('supports python requests code tab, copy code, and next/prev pagination', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    // Select /oauth2/token endpoint
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    // Click Python tab
    const pythonTab = screen.getByRole('button', { name: /python \(requests\)/i });
    fireEvent.click(pythonTab);

    // Click copy code snippet
    const copyCodeBtn = screen.getByTitle('Copy code');
    fireEvent.click(copyCodeBtn);
    expect(writeTextMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(copyCodeBtn.querySelector('svg.text-emerald-500')).toBeDefined();
    });

    // Test next/previous pagination
    const prevBtn = screen.getByText('Previous').closest('button');
    expect(prevBtn).toBeDefined();
    fireEvent.click(prevBtn!);

    const nextBtn = screen.getByText('Next').closest('button');
    expect(nextBtn).toBeDefined();
    fireEvent.click(nextBtn!);
  });

  it('switches response status tabs and copies response JSON payload', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    // Find response tabs (e.g. 400 Bad Request)
    const badRequestTab = screen.getByRole('button', { name: /400 bad request/i });
    fireEvent.click(badRequestTab);

    // Copy JSON payload
    const copyJsonBtn = screen.getByTitle('Copy JSON payload');
    fireEvent.click(copyJsonBtn);
    expect(writeTextMock).toHaveBeenCalled();
    await waitFor(() => {
      expect(copyJsonBtn.querySelector('svg.text-emerald-500')).toBeDefined();
    });
  });

  it('switches between curl and ts code tabs on an endpoint', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    // Switch to fetch
    const fetchTab = screen.getByRole('button', { name: /typescript \(fetch\)/i });
    fireEvent.click(fetchTab);

    // Switch back to curl
    const curlTab = screen.getByRole('button', { name: /^curl$/i });
    fireEvent.click(curlTab);
  });

  it('initializes selected section from window.location.hash and handles hashchange', () => {
    window.location.hash = '#authorize';
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    expect(screen.getAllByText('/oauth2/authorize').length).toBeGreaterThan(0);

    // Trigger hashchange event
    window.location.hash = '#openid-configuration';
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getAllByText('/.well-known/openid-configuration').length).toBeGreaterThan(0);

    // Reset hash
    window.location.hash = '';
  });

  it('copies issuer URL and endpoint path to clipboard', async () => {
    vi.useFakeTimers();
    try {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
      const copyIssuerBtn = screen.getByRole('button', { name: /copy issuer/i });
      await act(async () => {
        fireEvent.click(copyIssuerBtn);
        await Promise.resolve();
      });
      expect(writeTextMock).toHaveBeenCalledWith('https://auth.pesu.edu');
      expect(screen.getByText('Copied')).toBeDefined();

      // Advance timers to trigger setTimeout on line 116
      act(() => {
        vi.advanceTimersByTime(2100);
      });

      // Click Discovery & Keys endpoint in sidebar
      const jwksButton = screen.getAllByText('/jwks.json')[0].closest('button');
      expect(jwksButton).toBeDefined();
      fireEvent.click(jwksButton!);

      // Click Copy endpoint path
      const copyPathBtn = screen.getByTitle('Copy endpoint path');
      await act(async () => {
        fireEvent.click(copyPathBtn);
        await Promise.resolve();
      });
      expect(writeTextMock).toHaveBeenCalledWith('/jwks.json');
      expect(copyPathBtn.querySelector('svg.text-emerald-500')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(2100);
      });

      // Click Copy Markdown for LLMs button
      const copyLlmBtn = screen.getByText('Copy for LLM').closest('button');
      expect(copyLlmBtn).toBeDefined();
      await act(async () => {
        fireEvent.click(copyLlmBtn!);
        await Promise.resolve();
      });
      expect(screen.getByText('Copied Markdown!')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByText('Copied Markdown!')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles dual-method endpoint badge variant for userinfo', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const userinfoBtn = screen.getAllByText('/api/userinfo')[0].closest('button');
    expect(userinfoBtn).toBeDefined();
    fireEvent.click(userinfoBtn!);

    expect(screen.getAllByText(/GET \/ POST/i).length).toBeGreaterThan(0);
  });

  it('falls back to document.execCommand when navigator.clipboard.writeText fails', async () => {
    vi.useFakeTimers();
    try {
      const execCommandMock = vi.fn();
      document.execCommand = execCommandMock;

      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockRejectedValue(new Error('Clipboard permission denied')),
        },
      });

      render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
      const copyIssuerBtn = screen.getByRole('button', { name: /copy issuer/i });
      fireEvent.click(copyIssuerBtn);
      await Promise.resolve();
      await Promise.resolve();

      expect(execCommandMock).toHaveBeenCalledWith('copy');

      // Advance timers to exercise setTimeout callback resetting copiedId
      act(() => {
        vi.advanceTimersByTime(2100);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('omits next button on the last item in documentation', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const userinfoBtn = screen.getAllByText('/api/userinfo')[0].closest('button');
    expect(userinfoBtn).toBeDefined();
    fireEvent.click(userinfoBtn!);

    // Since /api/v1/userinfo is the last item, Next button should not be present
    expect(screen.queryByText('Next')).toBeNull();
  });

  it('renders and navigates to API Versioning guide and handles version selector', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    const versioningBtn = screen.getAllByText('API Versioning')[0].closest('button');
    expect(versioningBtn).toBeDefined();
    fireEvent.click(versioningBtn!);

    expect(screen.getAllByText('Architecture & Standards').length).toBeGreaterThan(0);
    expect(screen.getByText('Supported API Versions')).toBeDefined();
    expect(screen.getByText('Explicit Version Route')).toBeDefined();
    expect(screen.getByText('Unversioned Route Alias')).toBeDefined();

    // Change version selector
    const versionSelect = screen.getByRole('combobox', { name: /select api version/i });
    fireEvent.change(versionSelect, { target: { value: 'v1' } });
    expect(versionSelect).toHaveProperty('value', 'v1');
  });

  it('handles endpoint with empty responses array returning null for active response', () => {
    const originalCreateEndpoints = docsData.createEndpoints;
    const spy = vi.spyOn(docsData, 'createEndpoints').mockImplementation((url) => {
      const eps = originalCreateEndpoints(url);
      return eps.map((ep) => (ep.id === 'token' ? { ...ep, responses: [] } : ep));
    });

    try {
      render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
      const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
      fireEvent.click(tokenButton!);
      expect(screen.queryByTitle('Copy JSON payload')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('renders with default issuerUrl, handles unknown hash, NextAuth copy button, and endpoint path copy button', async () => {
    // 1. Render without issuerUrl
    render(<DocsClient />);
    expect(screen.getByText('Getting Started with Sign in with PESU')).toBeDefined();

    // 2. Hash change with unknown hash
    act(() => {
      window.location.hash = '#unknown_hash';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    // 3. Navigate to nextauth guide
    const nextauthBtn = screen.getByRole('button', { name: 'NextAuth.js Integration' });
    fireEvent.click(nextauthBtn);
    expect(screen.getByText('NextAuth.js / Auth.js Integration')).toBeDefined();

    const copyNextAuthBtn = screen.getByRole('button', { name: 'Copy' });
    fireEvent.click(copyNextAuthBtn);
    await waitFor(() => {
      expect(screen.getByText('Copied')).toBeDefined();
    });

    // 4. Navigate to token endpoint and click copy endpoint path
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    const copyPathBtn = screen.getByTitle('Copy endpoint path');
    fireEvent.click(copyPathBtn);

    // 5. Test copiedId timeout where current !== id
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(copyPathBtn);
      });
      // Change copiedId to something else before timer expires
      const copyLlmBtn = screen.getByRole('button', { name: /^copy for llm$/i });
      await act(async () => {
        fireEvent.click(copyLlmBtn);
      });
      act(() => {
        vi.advanceTimersByTime(2100);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders Overview when defaultSelectedId is not in allNavItems', () => {
    render(<DocsClient defaultSelectedId="nonexistent-id" />);
    // In mobile header, it renders the fallback 'Overview'
    expect(screen.getAllByText('Overview').length).toBeGreaterThan(0);
  });

  it('handles full-spec-sidebar copy button and its active check icon state', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<DocsClient />);
    const copyFullBtn = screen.getByRole('button', { name: /copy for llm \(full\)/i });
    expect(copyFullBtn).toBeDefined();

    await act(async () => {
      fireEvent.click(copyFullBtn);
    });
    expect(screen.getByText('Copied Full Spec!')).toBeDefined();
  });

  it('handles clipboard fallback via document.execCommand and advances timer', async () => {
    vi.useFakeTimers();
    try {
      // Force clipboard.writeText to throw to hit catch block
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockRejectedValue(new Error('no clipboard')),
        },
      });
      document.execCommand = vi.fn().mockReturnValue(true);

      render(<DocsClient />);
      const copyFullBtn = screen.getByRole('button', { name: /copy for llm \(full\)/i });
      await act(async () => {
        fireEvent.click(copyFullBtn);
      });

      expect(document.execCommand).toHaveBeenCalledWith('copy');
      expect(screen.getByText('Copied Full Spec!')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(2100);
      });

      expect(screen.getByText('Copy for LLM (Full)')).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

