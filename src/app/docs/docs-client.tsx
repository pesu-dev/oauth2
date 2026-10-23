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
  type EndpointDoc,
  type HttpMethod,
  type ParamDoc,
} from './docs-data';
import { GUIDES, GuideView } from './docs-guides';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { controlStyles, labelStyles } from '@/components/ui/input';
import { Check, Copy, Search, ArrowRight, ArrowLeft, Menu, X } from 'lucide-react';

type CodeTab = 'curl' | 'fetch' | 'python';

const CODE_TABS: { id: CodeTab; label: string }[] = [
  { id: 'curl', label: 'cURL' },
  { id: 'fetch', label: 'TypeScript (Fetch)' },
  { id: 'python', label: 'Python (requests)' },
];

const CATEGORIES: EndpointDoc['category'][] = ['Discovery & Keys', 'Authentication & Tokens', 'Resource Server'];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-get',
  POST: 'text-post',
  PUT: 'text-put',
  PATCH: 'text-patch',
  DELETE: 'text-danger',
};

/** The first method of an endpoint, so "GET / POST" reads as GET. */
export function primaryMethod(method: string): string {
  return method.split('/')[0].trim().toUpperCase();
}

export function methodColor(method: string): string {
  return METHOD_COLORS[primaryMethod(method) as HttpMethod] ?? 'text-muted';
}

function displayPath(ep: EndpointDoc): string {
  return ep.category === 'Resource Server' ? ep.path.replace(/\/api\/v\d+\//, '/api/') : ep.path;
}

interface SendResult {
  path: string;
  status: number;
  ok: boolean;
  body: string;
}

function FieldRows({ fields }: { fields: ParamDoc[] }) {
  return (
    <div className="border-t border-line">
      {fields.map((p) => (
        <div
          key={`${p.location}-${p.name}`}
          className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] max-[700px]:grid-cols-2 gap-x-6 gap-y-1 py-4 border-b border-line"
        >
          <div className="space-y-1 min-w-0">
            <code className="font-mono text-[13px] text-fg break-all">{p.name}</code>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[10px] text-muted">{p.type}</span>
              <span className="font-mono text-[10px] text-muted">· {p.location}</span>
            </div>
            <Badge variant={p.required ? 'required' : 'optional'}>{p.required ? 'Required' : 'Optional'}</Badge>
          </div>
          <div className="text-sm text-soft leading-[1.65] max-[700px]:col-span-2 [overflow-wrap:anywhere]">
            <p>{p.description}</p>
            {p.allowedValues && (
              <p className="mt-1 text-xs">
                <span className="eyebrow">Allowed </span>
                {p.allowedValues.map((val) => (
                  <code key={val} className="font-mono bg-code border border-line px-1 py-0.5 rounded mr-1 text-fg">
                    {val}
                  </code>
                ))}
              </p>
            )}
            {p.defaultValue && (
              <p className="mt-1 text-xs text-muted">
                Default: <code className="font-mono">{p.defaultValue}</code>
              </p>
            )}
            {p.example && (
              <p className="mt-1 text-xs text-muted">
                Example: <code className="font-mono">{p.example}</code>
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
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
  const [activeCodeTab, setActiveCodeTab] = React.useState<Record<string, CodeTab>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [selectedApiVersion, setSelectedApiVersion] = React.useState<string>(CURRENT_API_VERSION);
  const [bearerToken, setBearerToken] = React.useState('');
  const [sendingPath, setSendingPath] = React.useState<string | null>(null);
  const [lastResult, setSendResult] = React.useState<SendResult | null>(null);
  const latestSend = React.useRef(0);

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
    setSendResult(null);
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
        displayPath(ep).toLowerCase().includes(q) ||
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
        title: `${ep.method} ${displayPath(ep)}`,
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
  const codeTab: CodeTab = currentEndpoint ? activeCodeTab[currentEndpoint.id] ?? 'curl' : 'curl';
  const code = currentEndpoint
    ? codeTab === 'curl'
      ? currentEndpoint.curlSample
      : codeTab === 'fetch'
      ? currentEndpoint.fetchSample
      : currentEndpoint.pythonSample
    : '';

  // Results belong to one path, so they never show under another endpoint or API version.
  const sending = sendingPath !== null && sendingPath === currentEndpoint?.path;
  const sendResult = lastResult?.path === currentEndpoint?.path ? lastResult : null;

  const sendRequest = async (ep: EndpointDoc) => {
    const sendId = ++latestSend.current;
    const finish = (result: Omit<SendResult, 'path'>) => {
      if (sendId === latestSend.current) setSendResult({ ...result, path: ep.path });
    };
    setSendingPath(ep.path);
    setSendResult(null);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (ep.tryIt === 'bearer' && bearerToken.trim()) {
        headers.Authorization = `Bearer ${bearerToken.trim()}`;
      }
      // Same-origin only: the explorer is served by the issuer itself.
      const res = await fetch(ep.path, { method: primaryMethod(ep.method), headers });
      const contentType = res.headers?.get?.('content-type') ?? '';
      if (contentType.startsWith('image/')) {
        const size = (await res.arrayBuffer()).byteLength;
        setSendResult({ status: res.status, ok: res.ok, body: `Binary ${contentType} response (${size} bytes)` });
        return;
      }
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // not JSON; show raw text
      }
      finish({ status: res.status, ok: res.ok, body });
    } catch (err: unknown) {
      finish({ status: 0, ok: false, body: err instanceof Error ? err.message : String(err) });
    } finally {
      if (sendId === latestSend.current) setSendingPath(null);
    }
  };

  const sidebarItem = (id: string, label: React.ReactNode, method?: string) => {
    const isActive = selectedId === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => selectItem(id)}
        aria-current={isActive ? 'page' : undefined}
        className={`w-full grid ${method ? 'grid-cols-[52px_1fr]' : 'grid-cols-1'} gap-2 items-center text-left px-2.5 py-2 rounded-md border cursor-pointer transition-colors ${
          isActive ? 'bg-surface-soft border-line-strong' : 'border-transparent hover:bg-surface-soft'
        }`}
      >
        {method && <span className={`font-mono text-[10px] font-bold ${methodColor(method)}`}>{method}</span>}
        <span className={`${method ? 'font-mono text-[12px]' : 'text-[13px]'} text-fg truncate`}>{label}</span>
      </button>
    );
  };

  return (
    <div className="-mx-[clamp(18px,4vw,56px)] -my-10">
      {/* Mobile Selector Header */}
      <div className="min-[701px]:hidden flex items-center justify-between gap-3 px-[18px] py-3 border-b border-line bg-surface">
        <span className="font-mono text-[12px] text-fg truncate">
          {allNavItems.find((item) => item.id === selectedId)?.title || 'Overview'}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="shrink-0"
        >
          {mobileMenuOpen ? <X className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          <span>{mobileMenuOpen ? 'Close Menu' : 'Browse Docs'}</span>
        </Button>
      </div>

      <div
        className={`grid min-h-[calc(100vh-62px)] max-[700px]:block ${
          currentEndpoint
            ? 'grid-cols-[220px_minmax(420px,1fr)_minmax(340px,0.75fr)] max-[1040px]:grid-cols-[210px_1fr]'
            : 'grid-cols-[220px_minmax(0,1fr)] max-[1040px]:grid-cols-[210px_1fr]'
        }`}
      >
        {/* Left Sidebar */}
        <aside
          aria-label="Documentation navigation"
          className={`${mobileMenuOpen ? 'block' : 'hidden'} min-[701px]:block bg-surface border-r border-line max-[700px]:border-r-0 max-[700px]:border-b px-4 py-7 max-[700px]:py-4`}
        >
          <div className="min-[701px]:sticky min-[701px]:top-[90px] space-y-6">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
              <input
                type="text"
                aria-label="Search guides and endpoints"
                placeholder="Search docs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`${controlStyles} pl-8 py-1.5 text-xs`}
              />
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                copyToClipboard(generateFullApiReferenceMarkdown(endpoints, issuerUrl), 'full-spec-sidebar')
              }
              className="w-full justify-between"
            >
              <span>{copiedId === 'full-spec-sidebar' ? 'Copied Full Spec!' : 'Copy for LLM (Full)'}</span>
              {copiedId === 'full-spec-sidebar' ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>

            <div className="space-y-2">
              <div className="eyebrow">Guides</div>
              <nav className="grid gap-1">
                {filteredGuides.map((guide) => sidebarItem(guide.id, guide.title))}
              </nav>
            </div>

            {CATEGORIES.map((category) => (
              <div key={category} className="space-y-2">
                <div className="eyebrow flex items-center justify-between gap-2">
                  <span>{category}</span>
                  {category === 'Resource Server' && (
                    <select
                      value={selectedApiVersion}
                      onChange={(e) => setSelectedApiVersion(e.target.value)}
                      aria-label="Select API version"
                      className="font-mono text-[10px] py-0.5 px-1.5 rounded-[5px] bg-surface text-fg border border-line cursor-pointer"
                    >
                      {AVAILABLE_API_VERSIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <nav className="grid gap-1">
                  {filteredEndpoints
                    .filter((ep) => ep.category === category)
                    .map((ep) => sidebarItem(ep.id, displayPath(ep), ep.method))}
                </nav>
              </div>
            ))}

            <div className="border-t border-line pt-4 grid gap-2.5">
              <div className="font-mono text-[11px] text-muted break-all">Issuer: {issuerUrl}</div>
              <div className="font-mono text-[11px] text-muted">Signing: RS256 · PKCE: S256</div>
              <Link href="/portal" className="font-mono text-[11px] text-muted hover:text-fg no-underline">
                Manage Apps in Portal →
              </Link>
              <Link href="/faq" className="font-mono text-[11px] text-muted hover:text-fg no-underline">
                Frequently Asked Questions
              </Link>
            </div>
          </div>
        </aside>

        {/* Center: reference */}
        <main className="min-w-0 px-[clamp(25px,4vw,56px)] py-[38px] max-[700px]:px-[18px] max-[700px]:py-7 space-y-8">
          {!currentEndpoint && (
            <GuideView id={selectedId} issuerUrl={issuerUrl} copiedId={copiedId} onCopy={copyToClipboard} />
          )}

          {currentEndpoint && (
            <div className="space-y-8">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 max-[700px]:flex-wrap">
                  <h1 className="display text-fg min-w-0">{currentEndpoint.title}</h1>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    onClick={() =>
                      copyToClipboard(
                        generateEndpointMarkdownForLlm(currentEndpoint, issuerUrl),
                        `llm-${currentEndpoint.id}`
                      )
                    }
                  >
                    {copiedId === `llm-${currentEndpoint.id}` ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-success" />
                        <span className="text-success">Copied Markdown!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy for LLM</span>
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-soft leading-[1.65]">{currentEndpoint.description}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span>
                    <span className="eyebrow">Authentication</span>{' '}
                    <span className="text-soft">{currentEndpoint.auth}</span>
                  </span>
                  <span>
                    <span className="eyebrow">Category</span>{' '}
                    <span className="text-soft">{currentEndpoint.category}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={`px-2 py-1 border border-line-strong rounded-[5px] bg-surface font-mono text-[11px] font-bold ${methodColor(currentEndpoint.method)}`}
                >
                  {currentEndpoint.method}
                </span>
                <h2 className="font-serif text-[27px] font-normal break-all">{currentEndpoint.path}</h2>
              </div>

              <hr className="border-0 border-t border-line" />

              {currentEndpoint.headers.length > 0 && (
                <section className="space-y-3">
                  <h3 className="eyebrow">Request Headers</h3>
                  <FieldRows fields={currentEndpoint.headers} />
                </section>
              )}

              <section className="space-y-3">
                <h3 className="eyebrow">
                  Parameters{' '}
                  {currentEndpoint.params.length > 0 &&
                    `(${currentEndpoint.params[0].location === 'query' ? 'Query String' : 'Request Body'})`}
                </h3>
                {currentEndpoint.params.length > 0 ? (
                  <FieldRows fields={currentEndpoint.params} />
                ) : (
                  <p className="text-xs text-muted">No query or request body parameters required for this endpoint.</p>
                )}
              </section>

              <hr className="border-0 border-t border-line" />

              <section className="space-y-3">
                <h3 className="eyebrow">Responses</h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  {currentEndpoint.responses.map((r, rIdx) => {
                    const isSelected = (activeResponseTab[currentEndpoint.id] ?? 0) === rIdx;
                    const tone = r.status < 300 ? 'text-success' : r.status < 400 ? 'text-get' : 'text-warning';
                    return (
                      <button
                        key={rIdx}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() =>
                          setActiveResponseTab((prev) => ({ ...prev, [currentEndpoint.id]: rIdx }))
                        }
                        className={`px-2.5 py-1 rounded-[5px] border font-mono text-[11px] cursor-pointer ${
                          isSelected ? 'bg-surface border-line-strong text-fg' : 'border-line text-muted hover:text-fg'
                        }`}
                      >
                        <span className={tone}>{r.status}</span> {r.statusText}
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const currentRespTab = activeResponseTab[currentEndpoint.id] ?? 0;
                  const resp = currentEndpoint.responses[currentRespTab];
                  if (!resp) return null;
                  return (
                    <div className="space-y-3">
                      <p className="text-sm text-soft">{resp.description}</p>
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
              </section>
            </div>
          )}

          {/* Bottom Pagination Links */}
          <nav aria-label="Pagination" className="pt-8 border-t border-line flex items-center justify-between gap-4">
            {prevItem ? (
              <button
                type="button"
                onClick={() => selectItem(prevItem.id)}
                className="group text-left space-y-1 cursor-pointer"
              >
                <span className="eyebrow flex items-center gap-1">
                  <ArrowLeft className="w-3 h-3" />
                  <span>Previous</span>
                </span>
                <span className="block font-mono text-xs text-fg">{prevItem.title}</span>
              </button>
            ) : (
              <div />
            )}
            {nextItem ? (
              <button
                type="button"
                onClick={() => selectItem(nextItem.id)}
                className="group text-right space-y-1 cursor-pointer"
              >
                <span className="eyebrow flex items-center justify-end gap-1">
                  <span>Next</span>
                  <ArrowRight className="w-3 h-3" />
                </span>
                <span className="block font-mono text-xs text-fg">{nextItem.title}</span>
              </button>
            ) : (
              <div />
            )}
          </nav>
        </main>

        {/* Right: request panel */}
        {currentEndpoint && (
          <aside
            aria-label="Request"
            className="bg-surface border-l border-line px-6 py-7 max-[1040px]:col-span-full max-[1040px]:border-l-0 max-[1040px]:border-t max-[700px]:px-[18px] space-y-5"
          >
            <strong className="block text-sm">Request</strong>

            <div className="flex flex-wrap gap-1" role="group" aria-label="Request example language">
              {CODE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  aria-pressed={codeTab === tab.id}
                  onClick={() => setActiveCodeTab((prev) => ({ ...prev, [currentEndpoint.id]: tab.id }))}
                  className={`px-2 py-1 rounded-[5px] border font-mono text-[10px] uppercase cursor-pointer ${
                    codeTab === tab.id ? 'bg-surface-soft border-line-strong text-fg' : 'border-transparent text-muted hover:text-fg'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <CodeBlock
              code={code}
              copyId={`code-${currentEndpoint.id}-${codeTab}`}
              copied={copiedId === `code-${currentEndpoint.id}-${codeTab}`}
              onCopy={(id) => copyToClipboard(code, id)}
            />

            <Button
              variant="secondary"
              className="w-full"
              onClick={() => copyToClipboard(code, `request-${currentEndpoint.id}`)}
            >
              {copiedId === `request-${currentEndpoint.id}` ? 'Copied request' : 'Copy request'}
            </Button>

            {currentEndpoint.tryIt ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  sendRequest(currentEndpoint);
                }}
              >
                {currentEndpoint.tryIt === 'bearer' && (
                  <div className="space-y-1.5">
                    <label htmlFor="docs-bearer" className={labelStyles}>Bearer token</label>
                    <input
                      id="docs-bearer"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                      className={controlStyles}
                      aria-describedby="docs-bearer-note"
                    />
                    <p id="docs-bearer-note" className="text-[11px] text-muted">
                      Sent only to this server in the Authorization header. Never paste someone else&apos;s token.
                    </p>
                  </div>
                )}
                <Button type="submit" className="w-full" loading={sending}>
                  Send request
                </Button>
              </form>
            ) : (
              <p className="text-[11px] text-muted">
                This endpoint needs client credentials or a browser redirect, so it can&apos;t be sent from here. Use the
                example above.
              </p>
            )}

            {sendResult && (
              <div className="space-y-2 border-t border-line pt-4">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Response</span>
                  <Badge variant={sendResult.ok ? 'production' : 'suspended'} role="status">
                    {sendResult.status === 0 ? 'Network error' : `HTTP ${sendResult.status}`}
                  </Badge>
                </div>
                <CodeBlock
                  code={sendResult.body}
                  copyId={`send-${currentEndpoint.id}`}
                  copied={copiedId === `send-${currentEndpoint.id}`}
                  onCopy={(id) => copyToClipboard(sendResult.body, id)}
                  title="Copy response"
                />
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
