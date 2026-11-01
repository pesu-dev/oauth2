'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';

const linkBase = 'font-mono text-[10px] uppercase tracking-[0.02em] transition-colors';

function NavLink({
  href,
  pathname,
  children,
  onClick,
}: {
  href: string;
  pathname: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`${linkBase} ${active ? 'text-fg' : 'text-muted hover:text-fg'}`}
    >
      {children}
    </Link>
  );
}

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

  const close = () => setMobileMenuOpen(false);
  const links = (
    <>
      <NavLink href="/docs" pathname={pathname} onClick={close}>Docs</NavLink>
      <NavLink href="/portal" pathname={pathname} onClick={close}>Portal</NavLink>
      <NavLink href="/settings" pathname={pathname} onClick={close}>Settings</NavLink>
      <NavLink href="/faq" pathname={pathname} onClick={close}>FAQ</NavLink>
      {isAdmin && (
        <NavLink href="/admin" pathname={pathname} onClick={close}>
          <span className="text-warning">Admin</span>
        </NavLink>
      )}
      {isAuthenticated ? (
        <button
          type="button"
          onClick={() => {
            close();
            handleLogout();
          }}
          className={`${linkBase} text-muted hover:text-fg cursor-pointer text-left`}
        >
          Sign Out
        </button>
      ) : (
        <NavLink href="/login" pathname={pathname} onClick={close}>Sign In</NavLink>
      )}
    </>
  );

  return (
    <>
      {/* Desktop Navigation */}
      <nav aria-label="Primary" className="hidden min-[701px]:flex items-center gap-[22px]">
        {links}
      </nav>

      {/* Mobile Menu Trigger */}
      <div className="flex min-[701px]:hidden items-center">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="grid place-items-center h-8 w-8 rounded-[5px] text-muted hover:text-fg cursor-pointer"
          aria-label="Toggle navigation menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <nav
          aria-label="Primary mobile"
          className="fixed inset-x-0 top-[62px] z-50 flex flex-col gap-4 p-5 bg-bg border-b border-line min-[701px]:hidden"
        >
          {links}
        </nav>
      )}
    </>
  );
}
