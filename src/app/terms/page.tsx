import { Card } from '@/components/ui/card';
import { ShieldAlert, Scale, Ban, Code, AlertTriangle } from 'lucide-react';

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto py-6 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Terms of Service
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Last updated: September 2026 • PESU OAuth2 Identity Service
        </p>
      </div>

      <div className="space-y-6 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            1. Unofficial Community Project & Non-Affiliation
          </div>
          <p>
            PESU OAuth2 is an independent, community-driven identity provider developed by and for student developers. This service is <strong>not affiliated with, maintained, authorized, or endorsed by PES University or PESU Academy</strong>. By registering an application or signing in with this service, you acknowledge and agree that you are using an unofficial student project.
          </p>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <ShieldAlert className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            2. Developer Obligations & Acceptable Use
          </div>
          <p>
            Developers registering OAuth2 client applications on this platform agree to strictly adhere to the following obligations:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <li><strong>Minimal Scopes:</strong> Only request scopes and user data strictly necessary for your application&apos;s features.</li>
            <li><strong>Credential Safety:</strong> Never harvest, phish, log, or store plain-text student credentials or circumvent authentication safeguards.</li>
            <li><strong>Infrastructure Respect:</strong> Do not subject the identity provider, upstream university APIs, or authentication endpoints to denial-of-service, automated abuse, or rate-limit circumvention.</li>
            <li><strong>Secret Protection:</strong> Secure your Client ID and Client Secret. Promptly rotate your secret and notify maintainers if compromised.</li>
            <li><strong>Data Respect & Deletion:</strong> Honor user consent revocation and delete all cached profile data upon user request.</li>
          </ul>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <Scale className="w-5 h-5 text-purple-600 dark:text-purple-400 shrink-0" />
            3. Disclaimer of Warranties & Limitation of Liability
          </div>
          <p>
            PESU OAuth2 is provided strictly on an <strong>&ldquo;AS IS&rdquo; and &ldquo;AS AVAILABLE&rdquo; basis</strong>, without warranties of any kind, whether express, statutory, or implied, including but not limited to the implied warranties of merchantability, fitness for a particular purpose, or uninterrupted availability.
          </p>
          <p>
            To the fullest extent permitted by law, under no circumstances shall the maintainers, contributors, or developers of this project be liable for any direct, indirect, incidental, special, or consequential damages, academic penalties, loss of data, or operational disruptions arising from your use of or inability to use this service.
          </p>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <Ban className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
            4. Client Suspension & Service Revocation
          </div>
          <p>
            We reserve the unconditional right to suspend, rate-limit, revoke client secrets, or delete any registered application or developer account at our sole discretion, without prior notice, if we determine that the application violates these terms, compromises user privacy, or endangers university or student systems.
          </p>
        </Card>

        <Card className="p-6 space-y-3">
          <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-base">
            <Code className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            5. Intellectual Property & Trademarks
          </div>
          <p>
            The software codebase powering PESU OAuth2 is open source under the MIT License. &ldquo;PES University&rdquo;, &ldquo;PESU&rdquo;, &ldquo;PESU Academy&rdquo;, and all related names, logos, and emblems are trademarks of their respective owners and are used here solely for nominative and identification purposes.
          </p>
        </Card>
      </div>
    </div>
  );
}
