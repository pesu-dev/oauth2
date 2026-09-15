import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { HelpCircle } from 'lucide-react';

const FAQS = [
  {
    q: 'Is this an official PESU / PESU Academy product?',
    a: 'No. This is an unofficial community project built by student developers. It is not owned, operated, or endorsed by PES University or PESU Academy. The code is entirely open source (MIT) on GitHub.',
  },
  {
    q: 'Does "Sign in with PESU" store my password?',
    a: 'For identity-only sign-ins, no — your password is verified against Academy and immediately discarded; nothing is stored in the credential vault. If you explicitly grant delegated access to an authorized client, an encrypted credential vault entry is created so an internal first-party API can refresh Academy sessions. Third-party applications never see your password either way.',
  },
  {
    q: 'What is Testing vs Production for apps?',
    a: 'All newly registered apps start in Testing (or pending production). Only the application owner and designated allowlisted testers can complete sign-in until the application is reviewed and published to Production by an administrator. This gate protects users during active development.',
  },
  {
    q: 'What is delegated access / the credential vault?',
    a: 'Delegated access is an optional consent mode beyond standard identity. With explicit approval, envelope-encrypted Academy credentials (AES-256-GCM) are stored in an isolated vault so an internal token-exchange path can obtain short-lived Academy sessions for first-party APIs on your behalf, without disclosing passwords. Standard identity consents never create a vault record.',
  },
  {
    q: 'How is this different from pesu-auth?',
    a: 'This repository is a standalone OpenID Connect authorization server providing standard OIDC flows (authorize, PKCE, token, userinfo, discovery, revocation, hosted login/consent, and developer portal). It does not replace or modify pesu-auth; that project remains independent. Campus applications integrate with this authorization server via standard OAuth 2.0 / OIDC protocol endpoints.',
  },
];

export default function FaqPage() {
  return (
    <div className="max-w-3xl mx-auto py-6 space-y-8">
      <div className="space-y-2 text-center sm:text-left">
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
          <HelpCircle className="w-4 h-4" /> Frequently Asked Questions
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Everything you need to know.
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Answers to common questions about security, privacy, and development.
        </p>
      </div>

      <div className="space-y-4">
        {FAQS.map((faq, idx) => (
          <Card key={idx} className="p-6">
            <CardTitle className="text-base font-semibold">{faq.q}</CardTitle>
            <CardDescription className="text-sm mt-2 text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {faq.a}
            </CardDescription>
          </Card>
        ))}
      </div>
    </div>
  );
}
