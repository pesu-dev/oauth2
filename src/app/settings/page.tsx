'use client';

import * as React from 'react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { useRouter } from 'next/navigation';
import { Lock, Trash2, KeyRound, User, CheckCircle2 } from 'lucide-react';

interface UserData {
  name: string;
  prn: string;
  srn: string;
  program: string;
  branch: string;
  semester: string;
  section: string;
  campus: string;
  email?: string;
  phone?: string;
}

interface ConsentItem {
  client_id: string;
  client_name: string;
  scopes: string[];
  mode: string;
  granted_at: string;
}

export default function SettingsPage() {
  const router = useRouter();
  const [user, setUser] = React.useState<UserData | null>(null);
  const [hasVault, setHasVault] = React.useState(false);
  const [vaultUpdatedAt, setVaultUpdatedAt] = React.useState<string | null>(null);
  const [consents, setConsents] = React.useState<ConsentItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Account deletion state
  const [deleteConfirm, setDeleteConfirm] = React.useState('');
  const [isDeletingAccount, setIsDeletingAccount] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  // Update password drawer state
  const [isPasswordDrawerOpen, setIsPasswordDrawerOpen] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState('');
  const [updatingPassword, setUpdatingPassword] = React.useState(false);
  const [passwordMessage, setPasswordMessage] = React.useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (res.ok) {
        setUser(data.user);
        setHasVault(data.hasVault);
        setVaultUpdatedAt(data.vaultUpdatedAt);
        setConsents(data.consents || []);
      }
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchSettings();
  }, []);

  const handleDeleteVault = async () => {
    if (!confirm('Are you sure you want to delete your stored vault credentials? Any delegated applications will not be able to execute actions on your behalf until re-authenticated.')) {
      return;
    }
    const res = await fetch('/api/settings?action=vault', { method: 'DELETE' });
    if (res.ok) {
      fetchSettings();
    }
  };

  const handleRevokeConsent = async (clientId: string) => {
    const res = await fetch(`/api/settings?action=consent&client_id=${encodeURIComponent(clientId)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      fetchSettings();
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingPassword(true);
    setPasswordMessage(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update credentials');

      setNewPassword('');
      setIsPasswordDrawerOpen(false);
      fetchSettings();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error updating password';
      setPasswordMessage(msg);
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm.trim() !== 'DELETE') {
      setDeleteError('Type DELETE to confirm account deletion');
      return;
    }

    setIsDeletingAccount(true);
    setDeleteError(null);
    try {
      const res = await fetch('/api/settings?action=account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to delete account');
      }
      router.push('/login');
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Error deleting account');
      setIsDeletingAccount(false);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-zinc-400">Loading settings...</div>;
  }

  return (
    <div className="space-y-8 py-4 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Account & Privacy Settings
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Review your student identity profile, delegated credential vault, and third-party app permissions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Summary Card */}
        <Card>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <User className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg">{user?.name}</CardTitle>
              <CardDescription className="text-xs">{user?.prn} • {user?.srn}</CardDescription>
            </div>
          </div>

          <div className="space-y-2 pt-2 text-xs text-zinc-600 dark:text-zinc-300">
            <div className="flex justify-between py-1.5 border-b border-black/5 dark:border-white/5">
              <span className="text-zinc-400">Program</span>
              <span className="font-medium">{user?.program || 'N/A'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-black/5 dark:border-white/5">
              <span className="text-zinc-400">Branch</span>
              <span className="font-medium">{user?.branch || 'N/A'}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-black/5 dark:border-white/5">
              <span className="text-zinc-400">Semester / Section</span>
              <span className="font-medium">{user?.semester} - {user?.section}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-black/5 dark:border-white/5">
              <span className="text-zinc-400">Campus</span>
              <span className="font-medium">{user?.campus} Campus</span>
            </div>
          </div>
        </Card>

        {/* Delegated Vault Card */}
        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-600/10 text-purple-600 dark:text-purple-400 flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-lg">Credential Vault</CardTitle>
                  <CardDescription className="text-xs">Delegated API permissions</CardDescription>
                </div>
              </div>
              <Badge variant={hasVault ? 'delegated' : 'neutral'}>
                {hasVault ? 'Active Vault' : 'No Vault'}
              </Badge>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              {hasVault
                ? `Your PESU Academy credentials are encrypted with AES-256-GCM envelope encryption. Last updated on ${new Date(vaultUpdatedAt!).toLocaleDateString()}.`
                : 'You have not granted delegated credential storage to any application. Your password is not stored.'}
            </p>
          </div>

          <div className="pt-6 flex flex-wrap items-center gap-3">
            {hasVault ? (
              <>
                <Drawer open={isPasswordDrawerOpen} onOpenChange={setIsPasswordDrawerOpen}>
                  <DrawerTrigger asChild>
                    <Button variant="secondary" size="sm">
                      <KeyRound className="w-3.5 h-3.5 mr-1" /> Update Password
                    </Button>
                  </DrawerTrigger>
                  <DrawerContent className="max-w-md mx-auto">
                    <DrawerHeader>
                      <DrawerTitle>Update Vault Password</DrawerTitle>
                      <DrawerDescription>
                        Re-authenticate with your updated PESU Academy password to refresh your vault.
                      </DrawerDescription>
                    </DrawerHeader>

                    <form onSubmit={handleUpdatePassword} className="space-y-4 px-4 pb-6">
                      {passwordMessage ? (
                        <div className="p-3 rounded-xl bg-red-500/10 text-red-600 text-xs">
                          {passwordMessage}
                        </div>
                      ) : null}

                      <Input
                        label="New Academy Password"
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        required
                        disabled={updatingPassword}
                      />

                      <div className="pt-2 flex gap-3">
                        <Button
                          type="button"
                          variant="secondary"
                          className="flex-1"
                          onClick={() => setIsPasswordDrawerOpen(false)}
                        >
                          Cancel
                        </Button>
                        <Button type="submit" className="flex-1" loading={updatingPassword}>
                          Update Vault
                        </Button>
                      </div>
                    </form>
                  </DrawerContent>
                </Drawer>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteVault}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete Vault
                </Button>
              </>
            ) : (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Identity-only mode active
              </span>
            )}
          </div>
        </Card>
      </div>

      {/* Granted Applications Card */}
      <Card>
        <CardTitle className="text-lg">Authorized Applications</CardTitle>
        <CardDescription className="mt-1">
          Third-party apps you have granted permission to access your profile or resources.
        </CardDescription>

        <div className="mt-6 divide-y divide-black/5 dark:divide-white/5">
          {consents.length === 0 ? (
            <p className="text-xs text-zinc-400 py-6 text-center">
              You haven&apos;t authorized any third-party applications yet.
            </p>
          ) : (
            consents.map((c) => (
              <div
                key={c.client_id}
                className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                      {c.client_name}
                    </span>
                    <Badge variant={c.mode === 'delegated' ? 'delegated' : 'identity'}>
                      {c.mode}
                    </Badge>
                  </div>
                  <div className="text-xs text-zinc-400">
                    Granted scopes: {c.scopes.join(', ')} • Granted on{' '}
                    {new Date(c.granted_at).toLocaleDateString()}
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRevokeConsent(c.client_id)}
                >
                  Revoke Access
                </Button>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* Danger Zone: Account Deletion */}
      <Card className="border-red-500/20 bg-red-500/[0.02]">
        <CardTitle className="text-lg text-red-600 dark:text-red-400">Danger Zone</CardTitle>
        <CardDescription className="mt-1 text-zinc-500">
          Permanently delete your PESU OAuth2 account, revoke all application grants, and wipe all stored credentials. Your account identifier will be permanently tombstoned and never reused.
        </CardDescription>

        <div className="mt-6 space-y-4 max-w-md">
          {deleteError && (
            <div className="text-xs text-red-500 font-medium">
              {deleteError}
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">
              Type <span className="font-mono font-bold text-zinc-800 dark:text-zinc-200">DELETE</span> to confirm:
            </label>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="DELETE"
              className="font-mono text-xs"
            />
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDeleteAccount}
            disabled={deleteConfirm.trim() !== 'DELETE' || isDeletingAccount}
          >
            {isDeletingAccount ? 'Deleting Account...' : 'Delete Account Permanently'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
