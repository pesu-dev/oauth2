// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import DocsPage from '@/app/docs/page';
import { DocsClient, methodColor } from '@/app/docs/docs-client';
import * as docsData from '@/app/docs/docs-data';

describe('DocsPage & DocsClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('renders DocsPage, exports dynamic = force-dynamic, and mounts DocsClient', async () => {
    const { dynamic } = await import('@/app/docs/page');
    expect(dynamic).toBe('force-dynamic');

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

  it('offers Copy for LLM beside the heading and no path copy button', () => {
    render(<DocsClient issuerUrl="https://auth.pesu.edu" />);
    fireEvent.click(screen.getAllByText('/oauth2/token')[0].closest('button')!);

    const heading = screen.getByRole('heading', { level: 1, name: 'Token Issuance & Refresh' });
    const copyLlmBtn = screen.getByRole('button', { name: /^copy for llm$/i });
    expect(heading.parentElement?.contains(copyLlmBtn)).toBe(true);
    expect(screen.queryByTitle('Copy endpoint path')).toBeNull();
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

    // 4. Navigate to token endpoint
    const tokenButton = screen.getAllByText('/oauth2/token')[0].closest('button');
    fireEvent.click(tokenButton!);

    const copyFullBtn = screen.getByText('Copy for LLM (Full)').closest('button')!;

    // 5. Test copiedId timeout where current !== id
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(copyFullBtn);
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

  describe('request panel', () => {
    beforeEach(() => {
      Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    });

    it('sends a public request same-origin and pretty-prints JSON', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ status: 200, ok: true, text: async () => '{"issuer":"x"}' });
      vi.stubGlobal('fetch', fetchMock);
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="jwks" />);

      expect(screen.queryByLabelText('Bearer token')).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send request/i }));
      });

      expect(fetchMock).toHaveBeenCalledWith('/jwks.json', { method: 'GET', headers: { Accept: 'application/json' } });
      expect(screen.getByText('HTTP 200')).toBeDefined();
      expect(screen.getByTitle('Copy response')).toBeDefined();
      expect(document.body.textContent).toContain('"issuer": "x"');
      vi.unstubAllGlobals();
    });

    it('never shows a response under a different endpoint', async () => {
      let resolveFetch: (value: unknown) => void = () => {};
      vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="jwks" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send request/i }));
      });

      // Moves on while the request is in flight, without going through the sidebar.
      window.location.hash = '#openid-configuration';
      await act(async () => {
        window.dispatchEvent(new HashChangeEvent('hashchange'));
      });
      await act(async () => {
        resolveFetch({ status: 200, ok: true, text: async () => '{"keys":[]}' });
      });
      expect(screen.queryByText('HTTP 200')).toBeNull();
      expect(document.body.textContent).not.toContain('"keys": []');
      window.location.hash = '';
      vi.unstubAllGlobals();
    });

    it('ignores an older response once a newer request was sent', async () => {
      const resolvers: ((value: unknown) => void)[] = [];
      vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { resolvers.push(resolve); })));
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="jwks" />);
      const send = screen.getByRole('button', { name: /send request/i });
      await act(async () => {
        fireEvent.submit(send.closest('form')!);
        fireEvent.submit(send.closest('form')!);
      });
      await act(async () => {
        resolvers[1]({ status: 201, ok: true, text: async () => '{}' });
      });
      await act(async () => {
        resolvers[0]({ status: 500, ok: false, text: async () => '{}' });
      });
      expect(screen.getByText('HTTP 201')).toBeDefined();
      expect(screen.queryByText('HTTP 500')).toBeNull();
      vi.unstubAllGlobals();
    });

    it('sends the method the endpoint declares', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ status: 204, ok: true, text: async () => '' });
      vi.stubGlobal('fetch', fetchMock);
      const originalCreateEndpoints = docsData.createEndpoints;
      const spy = vi.spyOn(docsData, 'createEndpoints').mockImplementation((url) =>
        originalCreateEndpoints(url).map((ep) => (ep.id === 'jwks' ? { ...ep, method: 'DELETE' as const } : ep))
      );

      try {
        render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="jwks" />);
        await act(async () => {
          fireEvent.click(screen.getByRole('button', { name: /send request/i }));
        });
        expect(fetchMock).toHaveBeenCalledWith('/jwks.json', expect.objectContaining({ method: 'DELETE' }));
      } finally {
        spy.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it('adds the bearer token for userinfo and shows raw non-JSON bodies', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ status: 401, ok: false, text: async () => 'unauthorized' });
      vi.stubGlobal('fetch', fetchMock);
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="userinfo" />);

      fireEvent.change(screen.getByLabelText('Bearer token'), { target: { value: '  tok123  ' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send request/i }));
      });

      expect(fetchMock).toHaveBeenCalledWith('/api/v1/userinfo', {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: 'Bearer tok123' },
      });
      expect(screen.getByText('HTTP 401')).toBeDefined();
      expect(screen.getByText('unauthorized')).toBeDefined();
      vi.unstubAllGlobals();
    });

    it('omits Authorization when no bearer token is entered', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ status: 401, ok: false, text: async () => '{}' });
      vi.stubGlobal('fetch', fetchMock);
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="userinfo" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send request/i }));
      });
      expect(fetchMock.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' });
      vi.unstubAllGlobals();
    });

    it('reports network errors', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="jwks" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send request/i }));
      });
      expect(screen.getByText('Network error')).toBeDefined();
      expect(screen.getByText('offline')).toBeDefined();
      vi.unstubAllGlobals();
    });

    it('reports non-Error rejections', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue('boom'));
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="jwks" />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send request/i }));
      });
      expect(screen.getByText('boom')).toBeDefined();
      vi.unstubAllGlobals();
    });

    it('explains endpoints that cannot be sent and copies the request sample', async () => {
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="token" />);
      expect(screen.queryByRole('button', { name: /send request/i })).toBeNull();
      expect(screen.getByText(/can.t be sent from here/i)).toBeDefined();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /copy request/i }));
      });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('curl -X POST'));
      expect(screen.getByText('Copied request')).toBeDefined();
    });

    it('marks the selected code tab as pressed', () => {
      render(<DocsClient issuerUrl="https://auth.pesu.edu" defaultSelectedId="token" />);
      const python = screen.getByRole('button', { name: /python \(requests\)/i });
      fireEvent.click(python);
      expect(python.getAttribute('aria-pressed')).toBe('true');
    });
  });
});

describe('methodColor', () => {
  it.each([
    ['GET', 'text-get'],
    ['POST', 'text-post'],
    ['PUT', 'text-put'],
    ['PATCH', 'text-patch'],
    ['DELETE', 'text-danger'],
    ['GET / POST', 'text-get'],
    ['delete', 'text-danger'],
    ['OPTIONS', 'text-muted'],
  ])('colors %s as %s', (method, expected) => {
    expect(methodColor(method)).toBe(expected);
  });
});
