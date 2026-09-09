import { Card } from '@/components/ui/card';
import { ShieldCheck, Lock, EyeOff, Server } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto py-6 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Privacy Policy & Data Security
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Last updated: September 2026 • PESU OAuth2 Identity Service
        </p>
      </div>

      <div className="space-y-6 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <EyeOff className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            1. Zero-Exposure Credential Policy
          </div>
          <p>
            When authenticating through Sign in with PESU in standard Identity mode, your password is transmitted over TLS to authenticate directly against the university mobile service. Once authentication succeeds, your password is immediately purged from memory and is never written to disk or database logs.
          </p>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <Lock className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            2. Delegated Credential Vault
          </div>
          <p>
            Certain applications require delegated access to execute campus services on your behalf. These applications must explicitly declare delegated capabilities and require your affirmative consent on the authorization screen. In this mode, your credentials are encrypted using AES-256-GCM envelope encryption with unique per-row Data Encryption Keys (DEKs) wrapped by a master key.
          </p>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <Server className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            3. Data Minimization & Scopes
          </div>
          <p>
            We adhere strictly to data minimization principles. Applications only receive the specific claims you grant:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <li><strong>openid:</strong> Opaque user identifier (<code className="font-mono">usr_...</code>).</li>
            <li><strong>profile:</strong> Name, PRN, SRN, program, branch, semester, section, and campus.</li>
            <li><strong>email:</strong> Official university email address (only if granted).</li>
            <li><strong>phone:</strong> Contact phone number (only if granted).</li>
          </ul>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <ShieldCheck className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            4. User Control & Consent Revocation
          </div>
          <p>
            You retain absolute sovereignty over your permissions. You can inspect all active applications in your Settings and instantly revoke any authorization. You can also delete your entire vault document at any moment.
          </p>
        </Card>
      </div>
    </div>
  );
}
