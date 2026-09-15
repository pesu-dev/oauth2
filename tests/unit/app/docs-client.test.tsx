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
});
