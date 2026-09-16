// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Navbar } from '@/components/navbar';
import { Drawer, DrawerTrigger, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';

const mockPush = vi.fn();
const mockRefresh = vi.fn();

let currentPathname = '/';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

describe('UI Primitives & Navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Input', () => {
    it('renders with label and helper text', () => {
      render(<Input label="Username" helperText="Enter PRN or SRN" placeholder="PES1..." />);
      expect(screen.getByLabelText('Username')).toBeDefined();
      expect(screen.getByText('Enter PRN or SRN')).toBeDefined();
    });

    it('renders with error message', () => {
      render(<Input label="Password" error="Password is required" />);
      expect(screen.getByText('Password is required')).toBeDefined();
    });
  });

  describe('Card Components', () => {
    it('renders CardHeader, CardTitle, and CardDescription', () => {
      render(
        <Card>
          <CardHeader>
            <CardTitle>Header Title</CardTitle>
            <CardDescription>Header Desc</CardDescription>
          </CardHeader>
        </Card>
      );
      expect(screen.getByText('Header Title')).toBeDefined();
      expect(screen.getByText('Header Desc')).toBeDefined();
    });
  });

  describe('Drawer Components', () => {
    it('renders Drawer trigger and content when open', () => {
      render(
        <Drawer open={true}>
          <DrawerTrigger>Open Drawer</DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Drawer Title</DrawerTitle>
              <DrawerDescription>Drawer Description</DrawerDescription>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
      );
      expect(screen.getByText('Open Drawer')).toBeDefined();
      expect(screen.getByText('Drawer Title')).toBeDefined();
      expect(screen.getByText('Drawer Description')).toBeDefined();
    });
  });

  describe('Navbar', () => {
    it('renders navigation links and fetches auth status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: false, isAdmin: false }),
      } as Response);

      await React.act(async () => {
        render(<Navbar />);
      });

      expect(screen.getAllByText('Portal').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Documentation').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Sign In').length).toBeGreaterThan(0);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/auth/status');
      });
    });

    it('renders admin links and handles logout when authenticated as admin', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/auth/status') {
          return {
            ok: true,
            json: async () => ({ authenticated: true, isAdmin: true }),
          } as Response;
        }
        if (url === '/api/auth/logout') {
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      await React.act(async () => {
        render(<Navbar />);
      });

      await waitFor(() => {
        expect(screen.getByText('Admin')).toBeDefined();
        expect(screen.getByText('Sign Out')).toBeDefined();
      });

      // Click sign out
      await React.act(async () => {
        fireEvent.click(screen.getByText('Sign Out'));
      });

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST' });
        expect(mockPush).toHaveBeenCalledWith('/');
        expect(mockRefresh).toHaveBeenCalled();
      });
    });

    it('toggles mobile menu dropdown', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: false, isAdmin: false }),
      } as Response);

      await React.act(async () => {
        render(<Navbar />);
      });

      const toggleBtn = screen.getByLabelText('Toggle navigation menu');
      fireEvent.click(toggleBtn);

      // Now mobile dropdown is visible
      expect(screen.getAllByText('Sign In').length).toBeGreaterThan(1);

      // Click toggle again to close
      fireEvent.click(toggleBtn);
    });

    it('handles mobile menu links click and logout in mobile menu', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/auth/status') {
          return {
            ok: true,
            json: async () => ({ authenticated: true, isAdmin: true }),
          } as Response;
        }
        if (url === '/api/auth/logout') {
          return { ok: true } as Response;
        }
        return { ok: false } as Response;
      });

      await React.act(async () => {
        render(<Navbar />);
      });

      const toggleBtn = screen.getByLabelText('Toggle navigation menu');
      fireEvent.click(toggleBtn);

      // Click Admin Dashboard in mobile menu
      const adminLinks = screen.getAllByText('Admin Dashboard');
      expect(adminLinks.length).toBeGreaterThan(0);
      fireEvent.click(adminLinks[0]);

      // Open again and click mobile Sign Out
      fireEvent.click(toggleBtn);
      const signoutBtns = screen.getAllByText('Sign Out');
      expect(signoutBtns.length).toBeGreaterThan(1);
      await React.act(async () => {
        fireEvent.click(signoutBtns[1]); // the mobile button
      });

      expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('handles logout network error gracefully', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/auth/status') {
          return {
            ok: true,
            json: async () => ({ authenticated: true, isAdmin: false }),
          } as Response;
        }
        if (url === '/api/auth/logout') {
          throw new Error('Network error');
        }
        return { ok: false } as Response;
      });

      await React.act(async () => {
        render(<Navbar />);
      });

      await waitFor(() => {
        expect(screen.getByText('Sign Out')).toBeDefined();
      });

      await React.act(async () => {
        fireEvent.click(screen.getByText('Sign Out'));
      });

      expect(mockPush).toHaveBeenCalledWith('/');
    });

    it('clicks mobile menu links when unauthenticated', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: false, isAdmin: false }),
      } as Response);

      await React.act(async () => {
        render(<Navbar />);
      });

      const toggleBtn = screen.getByLabelText('Toggle navigation menu');
      fireEvent.click(toggleBtn);

      // Click Portal, Settings, Documentation, FAQ, Sign In
      const portalLinks = screen.getAllByText('Portal');
      fireEvent.click(portalLinks[portalLinks.length - 1]);

      fireEvent.click(toggleBtn);
      const settingsLinks = screen.getAllByText('Settings');
      fireEvent.click(settingsLinks[settingsLinks.length - 1]);

      fireEvent.click(toggleBtn);
      const docLinks = screen.getAllByText('Documentation');
      fireEvent.click(docLinks[docLinks.length - 1]);

      fireEvent.click(toggleBtn);
      const faqLinks = screen.getAllByText('FAQ');
      fireEvent.click(faqLinks[faqLinks.length - 1]);

      fireEvent.click(toggleBtn);
      const signinLinks = screen.getAllByText('Sign In');
      fireEvent.click(signinLinks[signinLinks.length - 1]);
    });

    it('closes mobile menu when pathname changes on rerender', async () => {
      currentPathname = '/';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: false, isAdmin: false }),
      } as Response);

      const { rerender } = render(<Navbar />);
      const toggleBtn = screen.getByLabelText('Toggle navigation menu');
      fireEvent.click(toggleBtn);

      // Change pathname and rerender
      currentPathname = '/docs';
      rerender(<Navbar />);
    });

    it('handles /api/auth/status returning non-ok response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
      } as Response);

      await React.act(async () => {
        render(<Navbar />);
      });

      expect(screen.getAllByText('Sign In').length).toBeGreaterThan(0);
    });

    it('handles logout network error by redirecting to home', async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url === '/api/auth/status') {
          return { ok: true, json: async () => ({ authenticated: true }) } as Response;
        }
        if (url === '/api/auth/logout') {
          throw new Error('Network error');
        }
        return { ok: false } as Response;
      });

      await React.act(async () => {
        render(<Navbar />);
      });

      await React.act(async () => {
        fireEvent.click(screen.getByText('Sign Out'));
      });

      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });
});
