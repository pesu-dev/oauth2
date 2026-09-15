import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, BookOpen, KeyRound, HelpCircle, ShieldCheck } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[65vh] text-center px-4">
      <div className="max-w-md w-full space-y-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            404 Error
          </p>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Page not found
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Sorry, we couldn&apos;t find the page you&apos;re looking for. It may have moved or no longer exists.
          </p>
        </div>

        <Card className="p-4 text-left divide-y divide-black/[0.06] dark:divide-white/[0.06]">
          <Link
            href="/docs"
            className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
          >
            <div className="p-2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <BookOpen className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                Documentation
              </div>
              <div className="text-[11px] text-zinc-500">
                Integration guide and API reference
              </div>
            </div>
          </Link>

          <Link
            href="/portal"
            className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
          >
            <div className="p-2 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <KeyRound className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                Developer Portal
              </div>
              <div className="text-[11px] text-zinc-500">
                Register and manage OAuth 2.0 clients
              </div>
            </div>
          </Link>

          <Link
            href="/faq"
            className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
          >
            <div className="p-2 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <HelpCircle className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                Frequently Asked Questions
              </div>
              <div className="text-[11px] text-zinc-500">
                Common inquiries and troubleshooting
              </div>
            </div>
          </Link>

          <Link
            href="/privacy"
            className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
          >
            <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                Privacy & Data Security
              </div>
              <div className="text-[11px] text-zinc-500">
                Learn about credential encryption and zero-knowledge storage
              </div>
            </div>
          </Link>
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
