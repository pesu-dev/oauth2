'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  createEndpoints,
  DEFAULT_PROD_ISSUER_URL,
  CURRENT_API_VERSION,
  AVAILABLE_API_VERSIONS,
  generateEndpointMarkdownForLlm,
  generateFullApiReferenceMarkdown,
} from './docs-data';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import {
  Check,
  Copy,
  Sparkles,
  Search,
  Code2,
  Key,
  BookOpen,
  ArrowRight,
  ArrowLeft,
  Layers,
  ExternalLink,
  ChevronRight,
  Menu,
  X,
  Server,
  Database,
} from 'lucide-react';

interface GuideDoc {
  id: string;
  title: string;
  category: 'Guides';
  summary: string;
}

const GUIDES: GuideDoc[] = [
  {
    id: 'overview',
    title: 'Overview & Quickstart',
    category: 'Guides',
    summary: 'OIDC architecture, issuer URL, and client authentication models.',
  },
  {
    id: 'versioning',
    title: 'API Versioning',
    category: 'Guides',
    summary: 'Resource route versioning, unversioned aliases, and breaking change policy.',
  },
  {
    id: 'pkce',
    title: 'Mandatory PKCE (S256)',
    category: 'Guides',
    summary: 'Cryptographic proof key verification preventing authorization code interception.',
  },
  {
    id: 'scopes',
    title: 'Scopes & Student Claims',
    category: 'Guides',
    summary: 'Available OpenID scopes and user profile claims sourced from PESU Academy.',
  },
  {
    id: 'nextauth',
    title: 'NextAuth.js Integration',
    category: 'Guides',
    summary: 'Production-ready NextAuth.js / Auth.js configuration snippet for Next.js App Router.',
  },
];

function getMethodBadgeClass(method: string, isActive: boolean): string {
  if (isActive) return 'bg-white/20 text-white';
  if (method.includes('GET / POST')) return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
  if (method.includes('POST')) return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
  return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
}


interface DocsClientProps {
  issuerUrl?: string;
  defaultSelectedId?: string;
}

export function DocsClient({
  issuerUrl = DEFAULT_PROD_ISSUER_URL,
  defaultSelectedId = 'overview',
}: DocsClientProps) {
  const [selectedId, setSelectedId] = React.useState<string>(defaultSelectedId);
  const [searchQuery, setSearchQuery] = React.useState('');
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [activeResponseTab, setActiveResponseTab] = React.useState<Record<string, number>>({});
  const [activeCodeTab, setActiveCodeTab] = React.useState<
    Record<string, 'curl' | 'fetch' | 'python'>
  >({});
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [selectedApiVersion, setSelectedApiVersion] = React.useState<string>(CURRENT_API_VERSION);

  const endpoints = React.useMemo(
    () => createEndpoints(issuerUrl, selectedApiVersion),
    [issuerUrl, selectedApiVersion]
  );

  // Sync hash on mount and when hash changes
  React.useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (hash) {
        const matchGuide = GUIDES.find((g) => g.id === hash);
        const matchEndpoint = endpoints.find((ep) => ep.id === hash);
        if (matchGuide || matchEndpoint) {
          setSelectedId(hash);
        }
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [endpoints]);

  const selectItem = (id: string) => {
    setSelectedId(id);
    setMobileMenuOpen(false);
    window.history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 2000);
  };

  // Filter items based on search query
  const filteredGuides = React.useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return GUIDES;
    return GUIDES.filter(
      (g) => g.title.toLowerCase().includes(q) || g.summary.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const filteredEndpoints = React.useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return endpoints;
    return endpoints.filter(
      (ep) =>
        ep.path.toLowerCase().includes(q) ||
        ep.path.replace(/\/api\/v\d+\//, '/api/').toLowerCase().includes(q) ||
        ep.title.toLowerCase().includes(q) ||
        ep.summary.toLowerCase().includes(q) ||
        ep.method.toLowerCase().includes(q) ||
        ep.params.some((p) => p.name.toLowerCase().includes(q))
    );
  }, [searchQuery, endpoints]);

  const allNavItems = React.useMemo(() => {
    return [
      ...GUIDES.map((g) => ({ id: g.id, title: g.title, type: 'guide' as const })),
      ...endpoints.map((ep) => ({
        id: ep.id,
        title: `${ep.method} ${
          ep.category === 'Resource Server' ? ep.path.replace(/\/api\/v\d+\//, '/api/') : ep.path
        }`,
        type: 'endpoint' as const,
      })),
    ];
  }, [endpoints]);

  const currentIndex = allNavItems.findIndex((item) => item.id === selectedId);
  const prevItem = currentIndex > 0 ? allNavItems[currentIndex - 1] : null;
  const nextItem =
    currentIndex >= 0 && currentIndex < allNavItems.length - 1
      ? allNavItems[currentIndex + 1]
      : null;

  const currentEndpoint = endpoints.find((ep) => ep.id === selectedId);

  const getMethodBadgeVariant = (method: string) => {
    if (method.includes('POST') && !method.includes('GET')) return 'pending';
    if (method.includes('GET') && !method.includes('POST')) return 'production';
    return 'identity';
  };

  return (
    <div className="py-4">
      {/* Mobile Selector Header */}
      <div className="lg:hidden mb-6 flex items-center justify-between p-3 rounded-xl bg-white/80 dark:bg-zinc-900/80 border border-black/10 dark:border-white/10 shadow-xs">
        <div className="flex items-center gap-2 truncate">
          <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Current:</span>
          <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate">
            {allNavItems.find((item) => item.id === selectedId)?.title || 'Overview'}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="gap-1.5 text-xs h-8"
        >
          {mobileMenuOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          <span>{mobileMenuOpen ? 'Close Menu' : 'Browse Docs'}</span>
        </Button>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Left Sidebar */}
        <aside
          className={`${
            mobileMenuOpen ? 'block' : 'hidden'
          } lg:block w-full lg:w-72 shrink-0 lg:sticky lg:top-20 max-h-[calc(100vh-6rem)] overflow-y-auto space-y-6 pr-1`}
        >
          {/* Search Box */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Search guides & endpoints..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-zinc-900 border border-black/10 dark:border-white/10 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-blue-500/50 text-zinc-800 dark:text-zinc-200 placeholder:text-zinc-400"
            />
          </div>

          {/* Copy Full Spec for LLM Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              copyToClipboard(generateFullApiReferenceMarkdown(endpoints, issuerUrl), 'full-spec-sidebar')
            }
            className="w-full justify-between border-blue-500/20 bg-blue-500/5 hover:bg-blue-500/10 text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300"
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-500" />
              <span className="font-semibold">
                {copiedId === 'full-spec-sidebar' ? 'Copied Full Spec!' : 'Copy for LLM (Full)'}
              </span>
            </div>
            {copiedId === 'full-spec-sidebar' ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3 h-3 text-blue-500 opacity-60 group-hover:opacity-100" />
            )}
          </Button>

          {/* Section: Guides */}
          <div className="space-y-1.5">
            <div className="px-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
              <BookOpen className="w-3 h-3" /> Guides & Setup
            </div>
            <nav className="space-y-0.5">
              {filteredGuides.map((guide) => {
                const isActive = selectedId === guide.id;
                return (
                  <Button
                    key={guide.id}
                    variant="ghost"
                    size="sm"
                    onClick={() => selectItem(guide.id)}
                    className={`w-full h-auto justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                      isActive
                        ? 'bg-blue-600 text-white hover:bg-blue-600 shadow-xs font-semibold'
                        : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <span>{guide.title}</span>
                    {isActive && <ChevronRight className="w-3 h-3 text-white/80" />}
                  </Button>
                );
              })}
            </nav>
          </div>

          {/* Section: Endpoints */}
          <div className="space-y-4">
            {/* Discovery & Keys Group */}
            <div className="space-y-1.5">
              <div className="px-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <Layers className="w-3 h-3" /> Discovery & Keys
              </div>
              <nav className="space-y-0.5">
                {filteredEndpoints
                  .filter((ep) => ep.category === 'Discovery & Keys')
                  .map((ep) => {
                    const isActive = selectedId === ep.id;
                    return (
                      <Button
                        key={ep.id}
                        variant="ghost"
                        size="sm"
                        onClick={() => selectItem(ep.id)}
                        className={`w-full h-auto justify-start gap-2 px-2 py-1.5 rounded-lg text-xs font-mono ${
                          isActive
                            ? 'bg-blue-600 text-white hover:bg-blue-600 shadow-xs font-semibold'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${getMethodBadgeClass(
                            ep.method,
                            isActive
                          )}`}
                        >
                          {ep.method}
                        </span>
                        <span className="truncate">{ep.path}</span>
                      </Button>
                    );
                  })}
              </nav>
            </div>

            {/* Authentication & Tokens Group */}
            <div className="space-y-1.5">
              <div className="px-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center gap-1.5">
                <Key className="w-3 h-3" /> Authentication & Tokens
              </div>
              <nav className="space-y-0.5">
                {filteredEndpoints
                  .filter((ep) => ep.category === 'Authentication & Tokens')
                  .map((ep) => {
                    const isActive = selectedId === ep.id;

                    return (
                      <Button
                        key={ep.id}
                        variant="ghost"
                        size="sm"
                        onClick={() => selectItem(ep.id)}
                        className={`w-full h-auto justify-start gap-2 px-2 py-1.5 rounded-lg text-xs font-mono ${
                          isActive
                            ? 'bg-blue-600 text-white hover:bg-blue-600 shadow-xs font-semibold'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${getMethodBadgeClass(
                            ep.method,
                            isActive
                          )}`}
                        >
                          {ep.method}
                        </span>
                        <span className="truncate">{ep.path}</span>
                      </Button>
                    );
                  })}
              </nav>
            </div>

            {/* Resource Server Group */}
            <div className="space-y-1.5">
              <div className="px-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Database className="w-3 h-3" />
                  <span>Resource Server</span>
                </div>
                <select
                  value={selectedApiVersion}
                  onChange={(e) => setSelectedApiVersion(e.target.value)}
                  aria-label="Select API version"
                  className="text-[10px] font-mono font-semibold py-0.5 px-1.5 rounded-md bg-black/5 dark:bg-white/10 text-zinc-700 dark:text-zinc-300 border border-black/10 dark:border-white/10 focus:outline-hidden focus:ring-1 focus:ring-blue-500 cursor-pointer"
                >
                  {AVAILABLE_API_VERSIONS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <nav className="space-y-0.5">
                {filteredEndpoints
                  .filter((ep) => ep.category === 'Resource Server')
                  .map((ep) => {
                    const isActive = selectedId === ep.id;
                    const displayPath = ep.path.replace(/\/api\/v\d+\//, '/api/');

                    return (
                      <Button
                        key={ep.id}
                        variant="ghost"
                        size="sm"
                        onClick={() => selectItem(ep.id)}
                        className={`w-full h-auto justify-start gap-2 px-2 py-1.5 rounded-lg text-xs font-mono ${
                          isActive
                            ? 'bg-blue-600 text-white hover:bg-blue-600 shadow-xs font-semibold'
                            : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9px] font-bold uppercase ${getMethodBadgeClass(
                            ep.method,
                            isActive
                          )}`}
                        >
                          {ep.method}
                        </span>
                        <span className="truncate">{displayPath}</span>
                      </Button>
                    );
                  })}
              </nav>
            </div>
          </div>

          {/* Useful Developer Info Box */}
          <div className="p-3.5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-2.5 text-xs text-zinc-500 dark:text-zinc-400">
            <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-blue-500" />
              <span>OIDC Server Info</span>
            </div>
            <div className="space-y-1 font-mono text-[11px]">
              <div className="break-all leading-tight">
                <span className="text-zinc-400">Issuer:</span> {issuerUrl}
              </div>
              <div>
                <span className="text-zinc-400">Signing:</span> RS256 (RSA 2048)
              </div>
              <div>
                <span className="text-zinc-400">PKCE:</span> S256 (Strict)
              </div>
            </div>
            <div className="pt-2 border-t border-black/5 dark:border-white/5 flex flex-col gap-1 text-[11px]">
              <Link
                href="/portal"
                className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-medium"
              >
                <span>Manage Apps in Portal</span>
                <ExternalLink className="w-3 h-3" />
              </Link>
              <Link
                href="/faq"
                className="text-zinc-600 dark:text-zinc-400 hover:underline"
              >
                Frequently Asked Questions
              </Link>
            </div>
          </div>
        </aside>

        {/* Right Main Content Area */}
        <main className="flex-1 min-w-0 space-y-8">
          {/* Guide Views */}
          {selectedId === 'overview' && (
            <div className="space-y-8">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="production" className="text-xs">
                    Overview
                  </Badge>
                  <span className="text-xs text-zinc-400">RFC 6749 / OpenID Connect Core 1.0</span>
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Getting Started with Sign in with PESU
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Sign in with PESU is an OpenID Connect (OIDC) identity provider enabling student
                  developers to authenticate PES University students reliably, retrieve verified academic
                  profile attributes, and eliminate the need for storing raw passwords.
                </p>
              </div>

              {/* Architecture Diagram / Overview Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-4 space-y-2 bg-white/70 dark:bg-zinc-900/70 border border-black/5 dark:border-white/10">
                  <div className="font-semibold text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    1. Register Client
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Create an application in the{' '}
                    <Link href="/portal" className="underline font-medium text-blue-500">
                      Developer Portal
                    </Link>{' '}
                    to receive your unique <code className="font-mono">client_id</code> and register callback URIs.
                  </p>
                </Card>
                <Card className="p-4 space-y-2 bg-white/70 dark:bg-zinc-900/70 border border-black/5 dark:border-white/10">
                  <div className="font-semibold text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    2. Initiate PKCE Flow
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Redirect users to <code className="font-mono">/oauth2/authorize</code> with a SHA-256 PKCE code challenge.
                    Users consent to scopes requested by your client.
                  </p>
                </Card>
                <Card className="p-4 space-y-2 bg-white/70 dark:bg-zinc-900/70 border border-black/5 dark:border-white/10">
                  <div className="font-semibold text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                    3. Mint & Verify Tokens
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Exchange the single-use code at <code className="font-mono">/oauth2/token</code> for signed RS256 ID tokens and
                    access tokens, or query <code className="font-mono">/api/v1/userinfo</code>.
                  </p>
                </Card>
              </div>

              {/* Issuer URL & Discovery */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                  <Server className="w-4 h-4 text-blue-500" />
                  <span>Issuer URL & Discovery</span>
                </h3>
                <Card className="p-4 space-y-3 bg-white dark:bg-zinc-950 border border-black/10 dark:border-white/10">
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    Configure your OIDC client or authentication library with the following Issuer URL. All discovery endpoints, signing keys, and token handlers are resolved automatically from this base.
                  </p>
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] font-mono text-xs border border-black/5 dark:border-white/5">
                    <span className="text-zinc-800 dark:text-zinc-200 font-semibold break-all">{issuerUrl}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(issuerUrl, 'issuer-url')}
                      className="text-[11px] h-7 px-2.5 shrink-0 font-sans"
                    >
                      {copiedId === 'issuer-url' ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3 text-zinc-500" />
                          <span>Copy Issuer</span>
                        </>
                      )}
                    </Button>
                  </div>
                  <div className="text-xs text-zinc-500 flex items-center gap-1.5 flex-wrap">
                    <span>OpenID Discovery:</span>
                    <a
                      href={`${issuerUrl}/.well-known/openid-configuration`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 dark:text-blue-400 hover:underline font-mono inline-flex items-center gap-1"
                    >
                      <span>{issuerUrl}/.well-known/openid-configuration</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </Card>
              </div>

              {/* Publishing States Notice */}
              <Card className="p-4 space-y-2 bg-amber-500/5 border border-amber-500/20 text-xs text-amber-900 dark:text-amber-200">
                <div className="font-semibold text-amber-800 dark:text-amber-100">
                  Client Publishing Lifecycle
                </div>
                <p>
                  Newly created applications begin in <strong>testing</strong> status and can only authenticate
                  the owner and designated testers listed in your portal. Submit a verification request from your client
                  portal once ready for campus-wide production release.
                </p>
              </Card>
            </div>
          )}

          {selectedId === 'versioning' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge variant="identity" className="text-xs">
                    Architecture & Standards
                  </Badge>
                  <span className="text-xs text-zinc-400">Resource Server Routing</span>
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  API Versioning
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  PESU OAuth2 uses path-based API versioning for all Resource Server endpoints to guarantee
                  backward compatibility and predictable developer upgrades. Protocol endpoints remain unversioned per OIDC specifications.
                </p>
              </div>

              {/* Versioning Schemes Comparison Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="p-5 space-y-3 bg-white/70 dark:bg-zinc-900/70 border border-black/10 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                      Explicit Version Route
                    </span>
                    <Badge variant="production" className="text-[10px]">
                      Recommended for Production
                    </Badge>
                  </div>
                  <div className="p-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] font-mono text-xs text-zinc-800 dark:text-zinc-200 border border-black/5 dark:border-white/5 break-all">
                    GET {issuerUrl}/api/v1/userinfo
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    Pinned to an explicit version number (<code className="font-mono">v1</code>). Production applications should always specify the API version to guarantee immunity against breaking changes when future API versions are deployed.
                  </p>
                </Card>

                <Card className="p-5 space-y-3 bg-white/70 dark:bg-zinc-900/70 border border-black/10 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                      Unversioned Route Alias
                    </span>
                    <Badge variant="optional" className="text-[10px]">
                      Aliases to Latest (v1)
                    </Badge>
                  </div>
                  <div className="p-2.5 rounded-lg bg-black/[0.03] dark:bg-white/[0.03] font-mono text-xs text-zinc-800 dark:text-zinc-200 border border-black/5 dark:border-white/5 break-all">
                    GET {issuerUrl}/api/userinfo
                  </div>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
                    Requests to unversioned paths are automatically rewritten at the edge proxy to the current default/latest API version (<code className="font-mono">v1</code>). Ideal for rapid prototyping and interactive testing.
                  </p>
                </Card>
              </div>

              {/* Protocol Endpoints vs Resource Endpoints */}
              <Card className="p-5 space-y-3 bg-white/70 dark:bg-zinc-900/70 border border-black/10 dark:border-white/10 text-xs">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                  Authorization Server vs. Resource Server
                </h3>
                <p className="text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Only <strong>Resource Server</strong> endpoints follow API versioning. Core OAuth 2.0 and OpenID Connect 1.0 protocol endpoints follow RFC standards and remain unversioned.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-1.5">
                    <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-blue-500" />
                      <span>Protocol Endpoints (RFC-Governed)</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Unversioned standard paths defined by OAuth 2.0 & OIDC specifications:
                    </p>
                    <ul className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 space-y-0.5 list-disc list-inside">
                      <li>/oauth2/authorize</li>
                      <li>/oauth2/token</li>
                      <li>/oauth2/revoke</li>
                      <li>/.well-known/openid-configuration</li>
                      <li>/jwks.json</li>
                    </ul>
                  </div>

                  <div className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-1.5">
                    <div className="font-semibold text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Resource Server Endpoints (Versioned)</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      Domain resource routes delivering student academic records and profile claims:
                    </p>
                    <ul className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 space-y-0.5 list-disc list-inside">
                      <li>/api/v1/userinfo (pinned version)</li>
                      <li>/api/userinfo (unversioned alias)</li>
                    </ul>
                  </div>
                </div>
              </Card>

              {/* API Versions Table */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Supported API Versions
                </h3>
                <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] text-zinc-500 dark:text-zinc-400">
                        <th className="py-2.5 px-3 font-semibold">Version</th>
                        <th className="py-2.5 px-3 font-semibold">Status</th>
                        <th className="py-2.5 px-3 font-semibold">Default</th>
                        <th className="py-2.5 px-3 font-semibold">Description</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/5 dark:divide-white/5">
                      <tr>
                        <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                          v1
                        </td>
                        <td className="py-2.5 px-3">
                          <Badge variant="production" className="text-[10px] px-1.5 py-0.5">
                            Available
                          </Badge>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-zinc-600 dark:text-zinc-300">
                          Yes
                        </td>
                        <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 leading-relaxed">
                          Initial stable release of the PESU OIDC Resource Server, providing verified student profile claims via <code className="font-mono">/api/v1/userinfo</code>.
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Backward Compatibility & Evolution Policy */}
              <div className="p-4 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 space-y-2 text-xs text-zinc-600 dark:text-zinc-400">
                <div className="font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5 text-sm">
                  <Sparkles className="w-4 h-4 text-blue-500" />
                  <span>Breaking Changes & Evolution Policy</span>
                </div>
                <ul className="list-disc list-inside space-y-1.5 leading-relaxed">
                  <li>
                    <strong>Non-Breaking Changes:</strong> Additive changes (e.g. adding new optional claims, new response headers, or new non-mandatory parameters) are introduced directly into the current version without breaking existing integrations.
                  </li>
                  <li>
                    <strong>Breaking Changes:</strong> Structural changes (e.g. removing claims, renaming keys, altering parameter types, or changing status codes) will always increment the API version (e.g. <code className="font-mono">v2</code>).
                  </li>
                  <li>
                    <strong>Deprecation Schedule:</strong> Whenever a new major version is released, previous versions enter a deprecation transition period to allow developers adequate time to upgrade.
                  </li>
                </ul>
              </div>
            </div>
          )}

          {selectedId === 'pkce' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Badge variant="identity" className="text-xs">Security Protocol</Badge>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Mandatory PKCE (RFC 7636)
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Proof Key for Code Exchange (PKCE) is strictly mandatory on PESU OAuth2. All authorization
                  requests must supply a SHA-256 code challenge with <code className="font-mono">code_challenge_method=S256</code>.
                  Plain challenge methods are rejected.
                </p>
              </div>

              <Card className="p-5 space-y-3 bg-white/70 dark:bg-zinc-900/70 border border-black/10 dark:border-white/10 text-xs">
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 text-sm">
                  How PKCE Protects Your Application
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  <li>
                    <strong>Generate Code Verifier:</strong> Generate a high-entropy cryptographically random string
                    between 43 and 128 characters using <code className="font-mono">A-Z, a-z, 0-9, -, ., _, ~</code>.
                  </li>
                  <li>
                    <strong>Compute Code Challenge:</strong> Calculate the SHA-256 hash of the verifier and encode it using
                    Base64URL: <code className="font-mono">BASE64URL(SHA256(code_verifier))</code>.
                  </li>
                  <li>
                    <strong>Authorization Request:</strong> Send <code className="font-mono">code_challenge</code> and{' '}
                    <code className="font-mono">code_challenge_method=S256</code> to <code className="font-mono">/oauth2/authorize</code>.
                  </li>
                  <li>
                    <strong>Token Exchange:</strong> Submit the original plaintext <code className="font-mono">code_verifier</code> in
                    the <code className="font-mono">POST /oauth2/token</code> request. The authorization server hashes it and matches the
                    original challenge before issuing tokens.
                  </li>
                </ol>
              </Card>

              {/* Code Generation Sample */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-zinc-500">TypeScript / Browser PKCE Generator</span>
                <pre className="overflow-x-auto p-4 rounded-xl bg-black/5 dark:bg-black/60 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 border border-black/5 dark:border-white/5">
{`function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

async function generatePkcePair() {
  const codeVerifier = generateRandomString(64);
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\\+/g, "-")
    .replace(/\\//g, "_")
    .replace(/=+$/, "");

  return { codeVerifier, codeChallenge };
}`}
                </pre>
              </div>
            </div>
          )}

          {selectedId === 'scopes' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Badge variant="identity" className="text-xs">User Identity</Badge>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  Scopes & Student Profile Claims
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  PESU OAuth2 maps verified academic credentials from PESU Academy into standardized OpenID Connect
                  claims. Request only the scopes your application requires.
                </p>
              </div>

              <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] text-zinc-500 dark:text-zinc-400">
                      <th className="py-2.5 px-3 font-semibold">Scope</th>
                      <th className="py-2.5 px-3 font-semibold">Claims Returned</th>
                      <th className="py-2.5 px-3 font-semibold">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5 dark:divide-white/5">
                    <tr>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                        openid
                      </td>
                      <td className="py-2.5 px-3 font-mono text-zinc-600 dark:text-zinc-300">sub</td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                        Mandatory for OpenID Connect. Issues an RS256-signed ID token containing the stable user identifier.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                        profile
                      </td>
                      <td className="py-2.5 px-3 font-mono text-zinc-600 dark:text-zinc-300">
                        name, prn, srn, program, branch, semester, section, campus
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                        Student academic registration attributes synced directly with PESU Academy records.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                        email
                      </td>
                      <td className="py-2.5 px-3 font-mono text-zinc-600 dark:text-zinc-300">email</td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                        Official verified student PES University email address (e.g. name@pesu.pes.edu).
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                        phone
                      </td>
                      <td className="py-2.5 px-3 font-mono text-zinc-600 dark:text-zinc-300">
                        phone_number
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                        Student contact telephone number registered on file.
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                        offline_access
                      </td>
                      <td className="py-2.5 px-3 font-mono text-zinc-600 dark:text-zinc-300">
                        refresh_token
                      </td>
                      <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400">
                        Issues a long-lived refresh token supporting automatic family rotation and reuse detection.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedId === 'nextauth' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Badge variant="identity" className="text-xs">Quickstart</Badge>
                <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                  NextAuth.js / Auth.js Integration
                </h1>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  Integrating Sign in with PESU into Next.js App Router takes fewer than 20 lines of code with Auth.js.
                </p>
              </div>

              <Card className="p-6 bg-black/[0.02] dark:bg-zinc-950/60 border-black/10 dark:border-white/10 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-blue-500" />
                    <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                      auth.ts (Root Config)
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(
                        `import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "pesu",
      name: "PESU",
      type: "oidc",
      issuer: process.env.PESU_OIDC_ISSUER || "${issuerUrl}",
      clientId: process.env.PESU_CLIENT_ID!,
      clientSecret: process.env.PESU_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid profile email offline_access",
        },
      },
      checks: ["pkce", "state"],
    },
  ],
});`,
                        'nextauth-code'
                      )
                    }
                    className="h-7 text-xs gap-1"
                  >
                    {copiedId === 'nextauth-code' ? (
                      <Check className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedId === 'nextauth-code' ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>

                <pre className="overflow-x-auto p-4 rounded-xl bg-black/5 dark:bg-black/60 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
{`import NextAuth from "next-auth";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "pesu",
      name: "PESU",
      type: "oidc",
      issuer: process.env.PESU_OIDC_ISSUER || "${issuerUrl}",
      clientId: process.env.PESU_CLIENT_ID!,
      clientSecret: process.env.PESU_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid profile email offline_access",
        },
      },
      checks: ["pkce", "state"],
    },
  ],
});`}
                </pre>
              </Card>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-zinc-500">Route Handler: app/api/auth/[...nextauth]/route.ts</span>
                <pre className="overflow-x-auto p-4 rounded-xl bg-black/5 dark:bg-black/60 font-mono text-xs leading-relaxed text-zinc-800 dark:text-zinc-200 border border-black/5 dark:border-white/5">
{`import { handlers } from "@/auth";
export const { GET, POST } = handlers;`}
                </pre>
              </div>
            </div>
          )}

          {/* Endpoint View */}
          {currentEndpoint && (
            <div className="space-y-8">
              {/* Endpoint Header */}
              <div className="space-y-3 pb-6 border-b border-black/10 dark:border-white/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <Badge
                      variant={getMethodBadgeVariant(currentEndpoint.method)}
                      className="font-mono font-bold text-xs px-2.5 py-0.5"
                    >
                      {currentEndpoint.method}
                    </Badge>
                    <code className="font-mono text-base font-semibold text-zinc-900 dark:text-zinc-100 bg-black/5 dark:bg-white/5 px-2.5 py-0.5 rounded-md">
                      {currentEndpoint.path}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Copy endpoint path"
                      onClick={() => copyToClipboard(currentEndpoint.path, `path-${currentEndpoint.id}`)}
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      {copiedId === `path-${currentEndpoint.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  </div>

                  {/* Stedi-style "Copy for LLM" Button */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      copyToClipboard(
                        generateEndpointMarkdownForLlm(currentEndpoint, issuerUrl),
                        `llm-${currentEndpoint.id}`
                      )
                    }
                    className="gap-1.5 text-xs font-medium bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 shadow-xs"
                  >
                    {copiedId === `llm-${currentEndpoint.id}` ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          Copied Markdown!
                        </span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
                        <span>Copy for LLM</span>
                      </>
                    )}
                  </Button>
                </div>

                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 dark:text-zinc-100">
                    {currentEndpoint.title}
                  </h1>
                  <p className="text-sm text-zinc-600 dark:text-zinc-400 mt-1 leading-relaxed">
                    {currentEndpoint.description}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400 pt-1">
                  <div className="flex items-center gap-1.5">
                    <Key className="w-3.5 h-3.5 text-zinc-400" />
                    <span>
                      Authentication:{' '}
                      <strong className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {currentEndpoint.auth}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-zinc-400" />
                    <span>
                      Category:{' '}
                      <strong className="text-zinc-700 dark:text-zinc-300 font-medium">
                        {currentEndpoint.category}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Headers Section */}
              {currentEndpoint.headers.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Request Headers
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] text-zinc-500 dark:text-zinc-400">
                          <th className="py-2.5 px-3 font-semibold">Header</th>
                          <th className="py-2.5 px-3 font-semibold">Type</th>
                          <th className="py-2.5 px-3 font-semibold">Required</th>
                          <th className="py-2.5 px-3 font-semibold">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5 dark:divide-white/5">
                        {currentEndpoint.headers.map((h, i) => (
                          <tr key={i} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                            <td className="py-2 px-3 font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                              {h.name}
                            </td>
                            <td className="py-2 px-3 text-zinc-500 font-mono">{h.type}</td>
                            <td className="py-2 px-3">
                              <Badge variant={h.required ? 'required' : 'optional'} className="text-[10px] px-1.5 py-0.5">
                                {h.required ? 'Required' : 'Optional'}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-zinc-600 dark:text-zinc-400 leading-relaxed">
                              {h.description}
                              {h.example && (
                                <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                                  Example: <code>{h.example}</code>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Parameters Section (Query / Body) */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Parameters{' '}
                  {currentEndpoint.params.length > 0 &&
                    `(${currentEndpoint.params[0].location === 'query' ? 'Query String' : 'Request Body'})`}
                </h3>

                {currentEndpoint.params.length > 0 ? (
                  <div className="overflow-x-auto rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-950">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] text-zinc-500 dark:text-zinc-400">
                          <th className="py-2.5 px-3 font-semibold">Name</th>
                          <th className="py-2.5 px-3 font-semibold">Location</th>
                          <th className="py-2.5 px-3 font-semibold">Type</th>
                          <th className="py-2.5 px-3 font-semibold">Status</th>
                          <th className="py-2.5 px-3 font-semibold">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/5 dark:divide-white/5">
                        {currentEndpoint.params.map((p, i) => (
                          <tr key={i} className="hover:bg-black/[0.01] dark:hover:bg-white/[0.01]">
                            <td className="py-2.5 px-3 font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                              {p.name}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 text-zinc-600 dark:text-zinc-400">
                                {p.location}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-zinc-500">{p.type}</td>
                            <td className="py-2.5 px-3">
                              <Badge variant={p.required ? 'required' : 'optional'} className="text-[10px] px-1.5 py-0.5">
                                {p.required ? 'Required' : 'Optional'}
                              </Badge>
                            </td>
                            <td className="py-2.5 px-3 text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-md">
                              <div>{p.description}</div>
                              {p.allowedValues && (
                                <div className="mt-1 text-[11px]">
                                  <span className="text-zinc-400">Allowed: </span>
                                  {p.allowedValues.map((val) => (
                                    <code
                                      key={val}
                                      className="font-mono bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded mr-1 text-zinc-700 dark:text-zinc-300"
                                    >
                                      {val}
                                    </code>
                                  ))}
                                </div>
                              )}
                              {p.defaultValue && (
                                <div className="mt-0.5 text-[11px] text-zinc-400">
                                  Default: <code>{p.defaultValue}</code>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 text-xs text-zinc-400 italic">
                    No query or request body parameters required for this endpoint.
                  </div>
                )}
              </div>

              {/* Responses Section */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                  Responses
                </h3>

                <div className="rounded-xl border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-zinc-900/50 overflow-hidden">
                  {/* Status Code Tabs */}
                  <div className="flex items-center gap-1 p-1.5 border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] overflow-x-auto">
                    {currentEndpoint.responses.map((r, rIdx) => {
                      const currentRespTab = activeResponseTab[currentEndpoint.id] ?? 0;
                      const isSelected = currentRespTab === rIdx;
                      const isSuccess = r.status >= 200 && r.status < 300;
                      const isRedirect = r.status >= 300 && r.status < 400;

                      return (
                        <Button
                          key={rIdx}
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setActiveResponseTab((prev) => ({ ...prev, [currentEndpoint.id]: rIdx }))
                          }
                          className={`h-auto px-2.5 py-1 rounded-lg text-xs font-medium font-mono gap-1.5 ${
                            isSelected
                              ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-zinc-800 shadow-xs'
                              : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-transparent'
                          }`}
                        >
                          <span
                            className={`w-2 h-2 rounded-full ${
                              isSuccess
                                ? 'bg-emerald-500'
                                : isRedirect
                                ? 'bg-sky-500'
                                : 'bg-amber-500'
                            }`}
                          />
                          <span>
                            {r.status} {r.statusText}
                          </span>
                        </Button>
                      );
                    })}
                  </div>

                  {/* Active Response Body */}
                  {(() => {
                    const currentRespTab = activeResponseTab[currentEndpoint.id] ?? 0;
                    const resp = currentEndpoint.responses[currentRespTab];
                    if (!resp) return null;

                    return (
                      <div className="p-4 space-y-3">
                        <p className="text-xs text-zinc-600 dark:text-zinc-400">
                          {resp.description}
                        </p>
                        <CodeBlock
                          code={JSON.stringify(resp.sample, null, 2)}
                          copyId={`resp-${currentEndpoint.id}-${currentRespTab}`}
                          copied={copiedId === `resp-${currentEndpoint.id}-${currentRespTab}`}
                          onCopy={(id) => copyToClipboard(JSON.stringify(resp.sample, null, 2), id)}
                          title="Copy JSON payload"
                        />
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Request Examples Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                    Request Example
                  </h3>
                  {/* Tab Switcher: Curl vs Fetch vs Python */}
                  <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/5 dark:bg-white/5 text-[11px] font-medium overflow-x-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setActiveCodeTab((prev) => ({ ...prev, [currentEndpoint.id]: 'curl' }))
                      }
                      className={`h-auto px-2 py-0.5 rounded-md text-[11px] font-medium ${
                        (activeCodeTab[currentEndpoint.id] ?? 'curl') === 'curl'
                          ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-zinc-800 shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-transparent'
                      }`}
                    >
                      cURL
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setActiveCodeTab((prev) => ({ ...prev, [currentEndpoint.id]: 'fetch' }))
                      }
                      className={`h-auto px-2 py-0.5 rounded-md text-[11px] font-medium ${
                        (activeCodeTab[currentEndpoint.id] ?? 'curl') === 'fetch'
                          ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-zinc-800 shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-transparent'
                      }`}
                    >
                      TypeScript (Fetch)
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setActiveCodeTab((prev) => ({ ...prev, [currentEndpoint.id]: 'python' }))
                      }
                      className={`h-auto px-2 py-0.5 rounded-md text-[11px] font-medium ${
                        (activeCodeTab[currentEndpoint.id] ?? 'curl') === 'python'
                          ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 hover:bg-white dark:hover:bg-zinc-800 shadow-xs'
                          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-transparent'
                      }`}
                    >
                      Python (requests)
                    </Button>
                  </div>
                </div>

                {(() => {
                  const tab = activeCodeTab[currentEndpoint.id] ?? 'curl';
                  const code =
                    tab === 'curl'
                      ? currentEndpoint.curlSample
                      : tab === 'fetch'
                      ? currentEndpoint.fetchSample
                      : currentEndpoint.pythonSample;

                  return (
                    <CodeBlock
                      code={code}
                      copyId={`code-${currentEndpoint.id}-${tab}`}
                      copied={copiedId === `code-${currentEndpoint.id}-${tab}`}
                      onCopy={(id) => copyToClipboard(code, id)}
                    />
                  );
                })()}
              </div>
            </div>
          )}

          {/* Bottom Pagination Links */}
          <div className="pt-8 border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-4">
            {prevItem ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectItem(prevItem.id)}
                className="group h-auto text-left flex-col items-start space-y-0.5 p-2"
              >
                <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                  <ArrowLeft className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" />
                  <span>Previous</span>
                </div>
                <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  {prevItem.title}
                </div>
              </Button>
            ) : (
              <div />
            )}

            {nextItem ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectItem(nextItem.id)}
                className="group h-auto text-right flex-col items-end space-y-0.5 p-2"
              >
                <div className="flex items-center justify-end gap-1 text-[11px] text-zinc-400">
                  <span>Next</span>
                  <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
                <div className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                  {nextItem.title}
                </div>
              </Button>
            ) : (
              <div />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
