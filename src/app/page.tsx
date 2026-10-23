import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ArrowRight } from 'lucide-react';

const PRINCIPLES = [
  {
    label: 'Identity',
    title: 'Zero Password Exposure',
    body: 'Apps receive standard RS256 JWTs. They never see, touch, or handle your PESU Academy password, and an identity-only sign-in stores nothing about it.',
  },
  {
    label: 'Delegated',
    title: 'AES-256-GCM Vault',
    body: 'Only apps an admin approves for delegated access can ask to keep a session. Credentials are sealed with envelope encryption and a per-user data key.',
  },
  {
    label: 'Protocol',
    title: 'Strict PKCE Required',
    body: 'Every authorization uses Proof Key for Code Exchange (S256), so an intercepted authorization code is useless on its own.',
  },
];

const STEPS = [
  ['01', 'Register an app', 'Create a client in the portal and add your redirect URI. It starts in Testing, open to you and your testers.'],
  ['02', 'Point your OIDC library here', 'NextAuth, Lucia, Passport and AppAuth read everything from the discovery document.'],
  ['03', 'Request Production', 'When it works, an admin reviews it and opens sign-in to every PESU student.'],
];

export default function HomePage() {
  return (
    <div className="max-w-[1040px] space-y-16 py-6">
      <section className="space-y-6">
        <p className="eyebrow">OpenID Connect 1.0 Provider</p>
        <h1 className="display text-fg max-w-3xl">Sign in with PESU, without sharing your password.</h1>
        <p className="text-[17px] text-soft leading-[1.65] max-w-2xl">
          An open-source, unofficial OAuth 2.0 authorization server for student apps and club sites at PES University.
          Students sign in on this page; apps get a token, never the PESU Academy password.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Link href="/portal">
            <Button size="lg">
              Developer Portal <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <Link href="/docs">
            <Button variant="secondary" size="lg">Read the Docs</Button>
          </Link>
        </div>
      </section>

      <hr className="border-0 border-t border-line" />

      <section aria-labelledby="principles" className="space-y-6">
        <h2 id="principles" className="eyebrow">How it protects students</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 border border-line rounded-md bg-surface divide-y md:divide-y-0 md:divide-x divide-line">
          {PRINCIPLES.map((item) => (
            <div key={item.title} className="p-6 space-y-3">
              <p className="eyebrow">{item.label}</p>
              <h3 className="font-serif text-[22px] font-normal leading-tight text-fg">{item.title}</h3>
              <p className="text-sm text-soft leading-[1.65]">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="quick-start" className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-10 items-start">
        <div className="space-y-4">
          <h2 id="quick-start" className="font-serif text-[27px] font-normal">Standard OIDC. Works with the library you already use.</h2>
          <p className="text-soft leading-[1.65]">
            Configure your client ID and redirect URI in the portal, then point your library at the discovery document.
          </p>
          <pre className="p-4 rounded-md bg-code border border-line font-mono text-xs text-fg overflow-x-auto">
            <span className="text-get font-bold">GET</span> /.well-known/openid-configuration
          </pre>
          <Link href="/docs" className="eyebrow underline hover:text-fg">Integration examples →</Link>
        </div>
        <ol className="border border-line rounded-md bg-surface divide-y divide-line list-none p-0">
          {STEPS.map(([n, title, body]) => (
            <li key={n} className="grid grid-cols-[44px_1fr] gap-2 p-5">
              <span className="font-mono text-[11px] font-bold text-post pt-1">{n}</span>
              <div className="space-y-1">
                <p className="font-serif text-lg text-fg">{title}</p>
                <p className="text-sm text-soft leading-[1.65]">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-line pt-6 flex flex-wrap gap-x-6 gap-y-2 items-center">
        <p className="text-sm text-muted">
          Open source under MIT.{' '}
          <a href="https://github.com/pesu-dev/oauth2" target="_blank" rel="noreferrer" className="underline hover:text-fg">
            Read the code on GitHub
          </a>
          . Not affiliated with PES University or PESU Academy.
        </p>
        <Link href="/faq" className="eyebrow hover:text-fg">FAQ</Link>
        <Link href="/privacy" className="eyebrow hover:text-fg">Privacy</Link>
      </section>
    </div>
  );
}
