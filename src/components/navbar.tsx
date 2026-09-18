'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Shield, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isAuthenticated, setIsAuthenticated] = React.useState(false);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  React.useEffect(() => {
    let isMounted = true;
    fetch('/api/internal/auth/status')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (isMounted && data) {
          setIsAuthenticated(Boolean(data.authenticated));
          setIsAdmin(Boolean(data.isAdmin));
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await fetch('/api/internal/auth/logout', { method: 'POST' });
      setIsAuthenticated(false);
      setIsAdmin(false);
      router.push('/');
      router.refresh();
    } catch {
      router.push('/');
    }
  };

  const [prevPathname, setPrevPathname] = React.useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
  }

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden sm:flex items-center gap-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        <Link
          href="/portal"
          className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          Portal
        </Link>
        <Link
          href="/settings"
          className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          Settings
        </Link>
        <Link
          href="/docs"
          className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          Documentation
        </Link>
        <Link
          href="/faq"
          className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
        >
          FAQ
        </Link>
        {isAdmin && (
          <Link
            href="/admin"
            className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-semibold transition-colors flex items-center gap-1"
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Admin</span>
          </Link>
        )}
        {isAuthenticated ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="h-auto p-0 font-normal text-sm hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-transparent"
          >
            Sign Out
          </Button>
        ) : (
          <Link
            href="/login"
            className="hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          >
            Sign In
          </Link>
        )}
      </nav>

      {/* Mobile Menu Trigger */}
      <div className="flex sm:hidden items-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="h-8 w-8 p-0 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          aria-label="Toggle navigation menu"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div className="fixed inset-x-0 top-14 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-xl border-b border-black/[0.08] dark:border-white/[0.08] p-4 flex flex-col gap-3 text-sm font-medium sm:hidden z-50 shadow-xl animate-in fade-in slide-in-from-top-2 duration-150">
          <Link
            href="/portal"
            onClick={() => setMobileMenuOpen(false)}
            className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white py-1"
          >
            Portal
          </Link>
          <Link
            href="/settings"
            onClick={() => setMobileMenuOpen(false)}
            className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white py-1"
          >
            Settings
          </Link>
          <Link
            href="/docs"
            onClick={() => setMobileMenuOpen(false)}
            className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white py-1"
          >
            Documentation
          </Link>
          <Link
            href="/faq"
            onClick={() => setMobileMenuOpen(false)}
            className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white py-1"
          >
            FAQ
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              onClick={() => setMobileMenuOpen(false)}
              className="text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 font-semibold py-1 flex items-center gap-1.5"
            >
              <Shield className="w-4 h-4" />
              <span>Admin Dashboard</span>
            </Link>
          )}
          {isAuthenticated ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setMobileMenuOpen(false);
              handleLogout();
            }}
            className="h-auto p-0 py-1 font-normal text-sm text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-transparent justify-start"
          >
            Sign Out
          </Button>
          ) : (
            <Link
              href="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white py-1"
            >
              Sign In
            </Link>
          )}
        </div>
      )}
    </>
  );
}
