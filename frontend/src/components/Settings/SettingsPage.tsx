import React, { useEffect, useState } from 'react';
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
import type { MonitoringSettings, UserProfile, EnvironmentType } from '../../types';
import type { Session } from '../../api/session';
import { guardian } from '../../api/guardian';
import type { DemoCatalogDto } from '../../api/types';
import { describeError } from '../../api/client';

interface SettingsPageProps {
  settings: MonitoringSettings;
  user: UserProfile;
  runtime: { allowPrivateNetworks: boolean; schedulerEnabled: boolean; secretsConfigured: boolean; nodeEnv: string } | null;
  session: Session;
  onSaveSession: (s: Session) => void;
  onUpdateSettings: (newSettings: MonitoringSettings) => Promise<void>;
  onUpdateUser: (newUser: UserProfile) => Promise<void>;
  onSignOut: () => void;
  showToast: (msg: string, kind?: 'ok' | 'error') => void;
}

const PROVIDERS = ['payments', 'shipping'] as const;

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  user,
  runtime,
  session,
  onSaveSession,
  onUpdateSettings,
  onUpdateUser,
  onSignOut,
  showToast,
}) => {
  // Form states
  const [formData, setFormData] = useState<MonitoringSettings>(settings);
  const [displayName, setDisplayName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [organization, setOrganization] = useState(user.organization);
  const [copiedKey, setCopiedKey] = useState(false);
  const [apiToken, setApiToken] = useState(session.token ?? '');
  const [showToken, setShowToken] = useState(false);
  const [scenarioToken, setScenarioToken] = useState('');
  const [scenarios, setScenarios] = useState<{ active: Record<string, string>; catalog: Array<{ scenario: string; providers: string[] | 'all' }> } | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoCatalogDto | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const loadDemo = async () => {
    try {
      setDemo(await guardian.demo.catalog());
    } catch (err) {
      showToast(describeError(err), 'error');
    }
  };
  useEffect(() => {
    void loadDemo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const demoAction = async (fn: () => Promise<unknown>, msg: string) => {
    setDemoBusy(true);
    try {
      await fn();
      showToast(msg);
      await loadDemo();
    } catch (err) {
      showToast(describeError(err), 'error');
    } finally {
      setDemoBusy(false);
    }
  };

  const handleCopyKey = () => {
    if (!apiToken) return;
    void navigator.clipboard.writeText(apiToken);
    setCopiedKey(true);
    showToast('Copied operator token to clipboard');
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleSaveToken = () => {
    onSaveSession({ ...session, token: apiToken.trim() || null });
    showToast(apiToken.trim() ? 'Operator token saved for this browser session' : 'Operator token cleared; session is read-only');
  };

  const handleSaveMonitoring = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.defaultTimeout < 500) {
      showToast('Timeout cannot be less than 500ms', 'error');
      return;
    }
    await onUpdateSettings(formData);
    showToast('Monitoring defaults saved on the backend');
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) {
      showToast('Display name cannot be empty', 'error');
      return;
    }
    await onUpdateUser({ ...user, name: displayName, email, role, organization });
    showToast('Profile updated');
  };

  const loadScenarios = async () => {
    setScenarioError(null);
    try {
      const r = await guardian.simulations.list(scenarioToken);
      const active: Record<string, string> = {};
      for (const a of r.active) active[a.provider] = a.scenario;
      setScenarios({ active, catalog: r.catalog });
    } catch (err) {
      setScenarios(null);
      setScenarioError(describeError(err));
    }
  };
  const setScenario = async (provider: string, scenario: string) => {
    try {
      await guardian.simulations.set(scenarioToken, provider, scenario);
      showToast(`${provider}: ${scenario}`);
      await loadScenarios();
    } catch (err) {
      showToast(describeError(err), 'error');
    }
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

        <form onSubmit={(e) => void handleSaveMonitoring(e)} className="space-y-4">
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
                <option value="30s">30 seconds (demo)</option>
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

          <label className="flex items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 cursor-pointer text-xs">
            <input type="checkbox" checked={formData.autoBaseline} onChange={(e) => setFormData({ ...formData, autoBaseline: e.target.checked })} className="w-4 h-4 accent-blue-600 rounded" />
            <div>
              <span className="font-semibold text-slate-900 block">Auto-approve first successful response as baseline (default for new APIs)</span>
              <span className="text-[11px] text-slate-500">When off, the first response is captured and waits for your approval on the dashboard.</span>
            </div>
          </label>

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
              disabled={runtime ? !runtime.allowPrivateNetworks : false}
              title={runtime && !runtime.allowPrivateNetworks ? 'Enforced by the backend (MONITOR_ALLOW_PRIVATE_NETWORKS=false)' : ''}
              onChange={(e) => {
                const updated = { ...formData, ssrfProtection: e.target.checked };
                setFormData(updated);
                void onUpdateSettings(updated).then(() => showToast(e.target.checked ? 'SSRF Guard activated' : 'Warning: SSRF Guard disabled (local/private URLs allowed)'));
              }}
              className="w-5 h-5 accent-emerald-600 rounded cursor-pointer"
            />
          </div>
          {runtime && (
            <p className="text-[11px] text-slate-500">
              Backend runtime: {runtime.nodeEnv} · scheduler {runtime.schedulerEnabled ? 'on' : 'off'} · credential encryption {runtime.secretsConfigured ? 'configured' : 'NOT configured (set MONITOR_SECRET_KEY to store auth secrets)'} · private networks {runtime.allowPrivateNetworks ? 'allowed by environment' : 'blocked by environment'}
            </p>
          )}

          {/* API Secret Key */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Operator token (this browser session)
            </label>
            <div className="flex items-center gap-2">
              <input
                type={showToken ? 'text' : 'password'}
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="paste OPERATOR_TOKEN from the backend .env"
                autoComplete="off"
                className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-700"
              />
              <button type="button" onClick={() => setShowToken((v) => !v)} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-semibold text-slate-700">{showToken ? 'Hide' : 'Show'}</button>
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
                onClick={handleSaveToken}
                className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Save</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Sent as a bearer header on every write. Kept in sessionStorage only; the token itself is configured on the backend, never generated here.</p>
          </div>
        </div>
      </div>

      {/* 2a. Showcase problem APIs */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
        <div className="flex items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Showcase APIs that go wrong</h2>
              <p className="text-xs text-slate-500">Built into the backend: some always correct, some that change {demo ? Math.round(demo.driftAfterMs / 60000) : '…'} minutes after their first call, some that flap, some always failing. Paste their URLs into Add API by hand, or register them all here.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={demoBusy || !demo} onClick={() => void demoAction(() => guardian.demo.registerAll(session.actor || 'demo', 30), 'Registered showcase APIs (30s interval); first checks are healthy, drift starts after a few checks')} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold disabled:opacity-50">Register all</button>
            <button type="button" disabled={demoBusy || !demo} onClick={() => void demoAction(() => guardian.demo.reset(), 'Counters reset: all showcase APIs are healthy again')} className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold disabled:opacity-50">Reset all</button>
          </div>
        </div>
        {!demo ? <p className="text-xs text-slate-400">Showcase APIs are available only when the backend runs with mock providers enabled (development).</p> : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {[...demo.endpoints].sort((a, b) => ['healthy', 'drifts', 'flaky', 'broken'].indexOf(a.mode) - ['healthy', 'drifts', 'flaky', 'broken'].indexOf(b.mode)).map((e) => (
              <div key={e.key} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900">{e.name}</span>
                    <span className={`ml-2 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${e.mode === 'healthy' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : e.mode === 'broken' ? 'bg-rose-50 border-rose-200 text-rose-700' : e.mode === 'flaky' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>{e.mode === 'healthy' ? 'always correct' : e.mode === 'broken' ? 'always failing' : e.mode === 'flaky' ? 'flapping' : 'changes later'}</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded font-bold text-[10px] shrink-0 ${e.mode === 'drifts' && e.state.drifted ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>{e.state.calls} calls{e.mode === 'drifts' ? e.state.drifted ? ' · misbehaving' : e.state.driftsAt ? ` · changes at ${new Date(e.state.driftsAt).toLocaleTimeString()}` : ' · not called yet' : ''}</span>
                </div>
                <p className="text-slate-600 leading-relaxed">{e.demonstrates}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed"><span className="font-semibold">Expected:</span> {e.expectedDetection}</p>
                <p className="font-mono text-[10px] text-slate-400 break-all">{e.method} {e.url}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  {e.monitorId ? <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">registered · {e.health}</span> : <button type="button" disabled={demoBusy} onClick={() => void demoAction(() => guardian.demo.registerAll(session.actor || 'demo', 30, [e.key]), `Registered ${e.name}`)} className="px-2.5 py-1 bg-blue-600 text-white rounded-lg text-[11px] font-semibold disabled:opacity-50">Register</button>}
                  <button type="button" onClick={() => void navigator.clipboard.writeText(e.url).then(() => showToast(`Copied ${e.url}`))} className="px-2.5 py-1 bg-white text-slate-700 border border-slate-200 rounded-lg text-[11px] font-semibold">Copy URL</button>
                  {e.mode === 'drifts' && (
                    <>
                      <button type="button" disabled={demoBusy} onClick={() => void demoAction(() => guardian.demo.drift(e.key), `${e.name} now misbehaves`)} className="px-2.5 py-1 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-semibold disabled:opacity-50">Break now</button>
                      <button type="button" disabled={demoBusy} onClick={() => void demoAction(() => guardian.demo.restore(e.key), `${e.name} restored`)} className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-[11px] font-semibold disabled:opacity-50">Restore</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2b. Sandbox providers (development only) */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
        <div className="flex items-center gap-2.5 pb-4 mb-4 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Sandbox providers (development only)</h2>
            <p className="text-xs text-slate-500">The backend ships mock Payments and Shipping APIs under <code className="font-mono">/mock</code>. Switch their behaviour to see detection, impact and recovery end to end.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <input type="password" value={scenarioToken} onChange={(e) => setScenarioToken(e.target.value)} placeholder="SCENARIO_CONTROL_TOKEN" autoComplete="off" className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-700" />
          <button type="button" onClick={() => void loadScenarios()} disabled={!scenarioToken} className="px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold disabled:opacity-50">Connect</button>
        </div>
        {scenarioError && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5">{scenarioError}</p>}
        {scenarios && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PROVIDERS.map((p) => (
              <div key={p} className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-900 capitalize">{p}</span>
                  <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${scenarios.active[p] && scenarios.active[p] !== 'baseline' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>{scenarios.active[p] ?? 'baseline'}</span>
                </div>
                <select value={scenarios.active[p] ?? 'baseline'} onChange={(e) => void setScenario(p, e.target.value)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs">
                  {scenarios.catalog.filter((c) => c.providers === 'all' || c.providers.includes(p)).map((c) => <option key={c.scenario} value={c.scenario}>{c.scenario}</option>)}
                </select>
                <p className="text-[11px] text-slate-500 mt-2 font-mono break-all">Monitor URL: {window.location.origin}/api/../mock/{p}/{p === 'payments' ? 'charges (POST)' : 'shipments (GET)'}</p>
              </div>
            ))}
          </div>
        )}
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

        <form onSubmit={(e) => void handleSaveAccount(e)} className="space-y-4">
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
                Role
              </label>
              <input
                type="text"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Organization
              </label>
              <input
                type="text"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
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
