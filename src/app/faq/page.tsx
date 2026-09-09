import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { HelpCircle } from 'lucide-react';

const FAQS = [
  {
    q: 'What is Sign in with PESU?',
    a: 'Sign in with PESU is an unofficial OpenID Connect authorization server built by student developers at PES University. It allows student-built web applications and club platforms to authenticate students safely without requiring or storing their PESU Academy password.',
  },
  {
    q: 'Does this service store my PESU Academy password?',
    a: 'In standard Identity mode, NO. When you log in, your credentials are used solely to establish your profile and are immediately discarded. In Delegated mode (optional and only when explicitly asked for by an authorized app), your password and session are encrypted in an isolated vault using AES-256-GCM envelope encryption.',
  },
  {
    q: 'How does it work for student developers and clubs?',
    a: 'Developers register an application in the Developer Portal to receive a client_id and client_secret. They can then use standard OpenID Connect libraries (such as Auth.js / NextAuth, Passport, or generic OAuth2 client libraries) with our discovery endpoint.',
  },
  {
    q: 'What is the difference between Testing and Production publishing status?',
    a: 'When an application is created, it is in Testing mode. Only the app owner and approved testers can sign into it. Once tested, the developer submits a production request for verification, which opens sign-in to any authenticated PESU student.',
  },
  {
    q: 'Can I revoke access to apps I have signed into?',
    a: 'Yes! Visit the Settings page anytime to view all third-party applications you have granted permission to and revoke access with a single click. If you used delegated credentials, you can also delete your vault document at any time.',
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
