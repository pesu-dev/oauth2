import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { ThemeProvider } from '@/components/ui/theme-provider';
import { ThemeToggle } from '@/components/ui/theme-toggle';

export const metadata: Metadata = {
  title: 'PESU OAuth2 — Sign in with PESU',
  description:
    'Unofficial OpenID Connect identity provider and developer portal for PESU accounts.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="min-h-full flex flex-col bg-[#fbfbfd] dark:bg-black text-zinc-900 dark:text-zinc-100 transition-colors duration-200">
        <ThemeProvider>
          {/* Apple-style floating translucent header */}
          <header className="sticky top-0 z-40 w-full border-b border-black/[0.06] dark:border-white/[0.08] bg-white/70 dark:bg-zinc-900/70 backdrop-blur-xl transition-colors">
            <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <Link
                  href="/"
                  className="font-semibold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 hover:opacity-80 transition-opacity flex items-center gap-2"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600 inline-block" />
                  PESU OAuth2
                </Link>
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
                </nav>
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
              </div>
            </div>
          </header>

          <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8">
            {children}
          </main>

          <footer className="border-t border-black/[0.06] dark:border-white/[0.08] py-8 text-center text-xs text-zinc-400 dark:text-zinc-500">
            <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
              <p>© {new Date().getFullYear()} PESU Developer Community. Open Source under MIT.</p>
              <div className="flex items-center gap-4">
                <Link href="/privacy" className="hover:underline">
                  Privacy Policy
                </Link>
                <Link href="/docs" className="hover:underline">
                  Developer API
                </Link>
                <a
                  href="https://github.com/pesu-dev/oauth2"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  GitHub
                </a>
              </div>
            </div>
          </footer>
        </ThemeProvider>
      </body>
    </html>
  );
}
