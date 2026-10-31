import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { ThemeProvider } from '@/components/ui/theme-provider';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { DotGrid } from '@/components/ui/dot-grid';
import { Navbar } from '@/components/navbar';
import pkg from '../../package.json';

export const metadata: Metadata = {
  title: 'PESU OAuth2 — Sign in with PESU',
  description:
    'Unofficial OpenID Connect identity provider and developer portal for PESU accounts.',
};

const GITHUB_URL = 'https://github.com/pesu-dev/oauth2';

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="w-6 h-6 block">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .3.2.66.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="min-h-full bg-bg text-fg font-sans antialiased">
        <ThemeProvider>
          <DotGrid />
          <div className="relative z-[1] min-h-screen flex flex-col">
            <header className="sticky top-0 z-40 h-[62px] flex items-center gap-7 max-[700px]:gap-3.5 border-b border-line bg-[color-mix(in_srgb,var(--bg)_94%,transparent)] backdrop-blur-[16px] px-[max(18px,calc((100vw-1380px)/2))] max-[700px]:px-3.5">
              <Link href="/" className="font-serif text-[22px] max-[700px]:text-[19px] text-fg whitespace-nowrap no-underline">
                PESU OAuth2
                <small className="font-mono text-[10px] text-muted ml-2">/ ID</small>
                <span className="ml-2.5 px-1.5 py-0.5 border border-line rounded-full font-mono text-[10px] text-muted align-middle max-[700px]:hidden">
                  v{pkg.version}
                </span>
              </Link>
              <Navbar />
              <div className="ml-auto flex items-center gap-4">
                <a
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub repository"
                  title="GitHub"
                  className="text-muted hover:text-fg transition-colors max-[700px]:hidden"
                >
                  <GitHubIcon />
                </a>
                <ThemeToggle />
              </div>
            </header>

            <main className="flex-1 w-full max-w-[1380px] mx-auto px-[clamp(18px,4vw,56px)] py-10">
              {children}
            </main>

            <footer className="border-t border-line bg-[color-mix(in_srgb,var(--bg)_94%,transparent)]">
              <div className="max-w-[1380px] mx-auto px-[clamp(18px,4vw,56px)] py-6 flex flex-col min-[701px]:flex-row min-[701px]:items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="eyebrow">Open source · MIT · © {new Date().getFullYear()} PESU Developer Community</p>
                  <p className="text-[11px] text-muted">
                    Unofficial community service. Not affiliated with or endorsed by PES University or PESU Academy.
                  </p>
                </div>
                <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {[
                    ['/', 'Home'],
                    ['/docs', 'Docs'],
                    ['/faq', 'FAQ'],
                    ['/privacy', 'Privacy'],
                    ['/terms', 'Terms'],
                  ].map(([href, label]) => (
                    <Link key={href} href={href} className="eyebrow hover:text-fg transition-colors">
                      {label}
                    </Link>
                  ))}
                  <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="eyebrow hover:text-fg transition-colors">
                    GitHub
                  </a>
                </nav>
              </div>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
