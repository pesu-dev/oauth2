import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { ArrowLeft, BookOpen, KeyRound, HelpCircle, ShieldCheck } from 'lucide-react';

const NAV_LINKS = [
  {
    href: '/docs',
    title: 'Documentation',
    subtitle: 'Integration guide and API reference',
    icon: <BookOpen className="w-4 h-4" />,
    iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    hoverText: 'group-hover:text-blue-600 dark:group-hover:text-blue-400',
  },
  {
    href: '/portal',
    title: 'Developer Portal',
    subtitle: 'Register and manage OAuth 2.0 clients',
    icon: <KeyRound className="w-4 h-4" />,
    iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    hoverText: 'group-hover:text-indigo-600 dark:group-hover:text-indigo-400',
  },
  {
    href: '/faq',
    title: 'Frequently Asked Questions',
    subtitle: 'Common inquiries and troubleshooting',
    icon: <HelpCircle className="w-4 h-4" />,
    iconBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    hoverText: 'group-hover:text-purple-600 dark:group-hover:text-purple-400',
  },
  {
    href: '/privacy',
    title: 'Privacy & Data Security',
    subtitle: 'Learn about credential encryption and zero-knowledge storage',
    icon: <ShieldCheck className="w-4 h-4" />,
    iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    hoverText: 'group-hover:text-emerald-600 dark:group-hover:text-emerald-400',
  },
];

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[65vh] text-center px-4">
      <div className="max-w-md w-full space-y-6">
        <PageHeader
          eyebrow={{ label: '404 Error' }}
          title="Page not found"
          description="Sorry, we couldn't find the page you're looking for. It may have moved or no longer exists."
          className="text-center"
        />

        <Card className="p-4 text-left divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
            >
              <div className={`p-2 rounded-md ${link.iconBg}`}>
                {link.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-medium text-zinc-900 dark:text-zinc-100 ${link.hoverText} transition-colors`}>
                  {link.title}
                </div>
                <div className="text-[11px] text-zinc-500">
                  {link.subtitle}
                </div>
              </div>
            </Link>
          ))}
        </Card>

        <div className="pt-2">
          <Link href="/">
            <Button variant="secondary" size="sm" className="gap-2">
              <ArrowLeft className="w-3.5 h-3.5" />
              Return to Home
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
