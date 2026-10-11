import React, { useState } from 'react';
import { 
  Settings as SettingsIcon, 
  Shield, 
  Lock, 
  Bell, 
  Clock, 
  User, 
  Key, 
  Copy, 
  Check, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle2, 
  Sliders, 
  LogOut 
} from 'lucide-react';
import { MonitoringSettings, UserProfile, EnvironmentType } from '../../types';

interface SettingsPageProps {
  settings: MonitoringSettings;
  user: UserProfile;
  onUpdateSettings: (newSettings: MonitoringSettings) => void;
  onUpdateUser: (newUser: UserProfile) => void;
  onSignOut: () => void;
  showToast: (msg: string) => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  user,
  onUpdateSettings,
  onUpdateUser,
  onSignOut,
  showToast,
}) => {
  // Form states
  const [formData, setFormData] = useState<MonitoringSettings>(settings);
  const [displayName, setDisplayName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [copiedKey, setCopiedKey] = useState(false);
  const [apiToken, setApiToken] = useState('ag_live_sec_78912ef093a10bc');

  const handleCopyKey = () => {
    navigator.clipboard.writeText(apiToken);
    setCopiedKey(true);
    showToast('Copied API Guardian secret token to clipboard');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleRegenerateKey = () => {
    const newToken = `ag_live_sec_${Math.random().toString(36).substring(2, 12)}${Date.now().toString(36)}`;
    setApiToken(newToken);
    showToast('Regenerated live API access token');
  };

  const handleSaveMonitoring = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.defaultTimeout < 500) {
      showToast('Timeout cannot be less than 500ms');
      return;
    }
    onUpdateSettings(formData);
    showToast('Monitoring defaults successfully saved');
  };

  const handleSaveAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      showToast('Display name cannot be empty');
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      showToast('Passwords do not match');
      return;
    }
    onUpdateUser({
      ...user,
      name: displayName,
      email: email,
    });
    setNewPassword('');
    setConfirmPassword('');
    showToast('Account profile preferences updated');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Settings</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure monitoring defaults, account profile, security rules, and alert channels.
          </p>
        </div>
      </div>

      {/* 1. Monitoring Settings Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Monitoring Defaults</h2>
            <p className="text-xs text-slate-500">Global defaults preselected when registering new API dependencies.</p>
          </div>
        </div>

        <form onSubmit={handleSaveMonitoring} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Default Check Interval
              </label>
              <select
                value={formData.defaultInterval}
                onChange={(e) => setFormData({ ...formData, defaultInterval: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
              >
                <option value="1m">1 minute</option>
                <option value="5m">5 minutes (Standard)</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Default Request Timeout (ms)
              </label>
              <input
                type="number"
                min="500"
                max="30000"
                step="500"
                value={formData.defaultTimeout}
                onChange={(e) => setFormData({ ...formData, defaultTimeout: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Default Environment
              </label>
              <select
                value={formData.defaultEnvironment}
                onChange={(e) => setFormData({ ...formData, defaultEnvironment: e.target.value as EnvironmentType })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800"
              >
                <option value="Production">Production</option>
                <option value="Staging">Staging</option>
                <option value="Development">Development</option>
              </select>
            </div>
          </div>

          {/* Alert Toggles */}
          <div className="pt-3 border-t border-slate-100 space-y-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Alert Notification Channels</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={formData.alertSlack}
                  onChange={(e) => setFormData({ ...formData, alertSlack: e.target.checked })}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
                <div>
                  <span className="font-semibold text-slate-900 block">Slack Webhook</span>
                  <span className="text-[11px] text-slate-500">#incident-room</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={formData.alertEmail}
                  onChange={(e) => setFormData({ ...formData, alertEmail: e.target.checked })}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
                <div>
                  <span className="font-semibold text-slate-900 block">Email Alerts</span>
                  <span className="text-[11px] text-slate-500">Team digest</span>
                </div>
              </label>

              <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer text-xs">
                <input
                  type="checkbox"
                  checked={formData.alertPagerDuty}
                  onChange={(e) => setFormData({ ...formData, alertPagerDuty: e.target.checked })}
                  className="w-4 h-4 accent-blue-600 rounded"
                />
                <div>
                  <span className="font-semibold text-slate-900 block">PagerDuty API</span>
                  <span className="text-[11px] text-slate-500">P1 on-call rotation</span>
                </div>
              </label>
            </div>
          </div>

          <div className="pt-2 text-right">
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
            >
              Save Monitoring Settings
            </button>
          </div>
        </form>
      </div>

      {/* 2. Access, Security & SSRF Protection */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Security & SSRF Guard</h2>
            <p className="text-xs text-slate-500">Protect backend probes against unauthorized internal network access.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
            <div>
              <span className="font-bold text-xs text-slate-900 block">Block RFC1918 Private Subnets</span>
              <span className="text-xs text-slate-500">Prevents probes to 127.0.0.1, 10.0.0.0/8, 192.168.0.0/16, and cloud metadata IPs (169.254.169.254).</span>
            </div>
            <input
              type="checkbox"
              checked={formData.ssrfProtection}
              onChange={(e) => {
                const updated = { ...formData, ssrfProtection: e.target.checked };
                setFormData(updated);
                onUpdateSettings(updated);
                showToast(e.target.checked ? 'SSRF Guard activated' : 'Warning: SSRF Guard disabled');
              }}
              className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
            />
          </div>

          {/* API Secret Key */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              API Live Secret Token
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={apiToken}
                className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-700"
              />
              <button
                type="button"
                onClick={handleCopyKey}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors"
              >
                {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                onClick={handleRegenerateKey}
                className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Rotate</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Bearer token required for programmatic check ingestion and webhooks</p>
          </div>
        </div>
      </div>

      {/* 3. Account Settings Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
            <User className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Account Preferences</h2>
            <p className="text-xs text-slate-500">Manage identity credentials and session access.</p>
          </div>
        </div>

        <form onSubmit={handleSaveAccount} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Display Name
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Change Password (Optional)
              </label>
              <input
                type="password"
                placeholder="New password..."
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                placeholder="Confirm new password..."
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={onSignOut}
              className="px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out to Landing Page</span>
            </button>

            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
            >
              Update Account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
