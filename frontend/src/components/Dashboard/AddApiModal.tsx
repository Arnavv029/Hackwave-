import React, { useEffect, useState } from 'react';
import { X, Plus, Globe, Lock, CheckCircle2, AlertTriangle, Play, Check } from 'lucide-react';
import type { HttpMethod, EnvironmentType, AuthType, MonitoringSettings } from '../../types';
import type { CreateMonitorInput, DemoEndpointDto, TestConnectionDto } from '../../api/types';
import { guardian } from '../../api/guardian';
import { describeError } from '../../api/client';
import { intervalToSeconds } from '../../api/mappers';

interface AddApiModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Returns true when the backend accepted the monitor. */
  onAddApi: (input: CreateMonitorInput) => Promise<boolean>;
  showToast: (msg: string, kind?: 'ok' | 'error') => void;
  defaults: MonitoringSettings;
  actor: string;
}

const AUTH_CODE: Record<AuthType, CreateMonitorInput['authType']> = { None: 'NONE', 'Bearer Token': 'BEARER', 'API Key': 'API_KEY', 'Basic Auth': 'BASIC' };

export const AddApiModal: React.FC<AddApiModalProps> = ({ isOpen, onClose, onAddApi, showToast, defaults, actor }) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [environment, setEnvironment] = useState<EnvironmentType>(defaults.defaultEnvironment);
  const [interval, setInterval] = useState(defaults.defaultInterval);
  const [timeout, setTimeoutVal] = useState(defaults.defaultTimeout);
  const [authType, setAuthType] = useState<AuthType>('None');
  const [authSecret, setAuthSecret] = useState('');
  const [authHeader, setAuthHeader] = useState('X-API-Key');
  const [bodyText, setBodyText] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [description, setDescription] = useState('');
  const [approveBaselineNow, setApproveBaselineNow] = useState(defaults.autoBaseline);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionDto | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [testedUrl, setTestedUrl] = useState<string | null>(null);
  const localHttps = (() => {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(u.hostname);
    } catch {
      return false;
    }
  })();
  const [demo, setDemo] = useState<DemoEndpointDto[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    guardian.demo.catalog().then((c) => { if (!cancelled) setDemo(Array.isArray(c?.endpoints) ? c.endpoints : []); }).catch(() => { if (!cancelled) setDemo([]); });
    return () => { cancelled = true; };
  }, [isOpen]);

  if (!isOpen) return null;

  const parseJsonField = (text: string, label: string): unknown => {
    if (!text.trim()) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new Error(`${label} must be valid JSON`);
    }
  };
  const buildPayload = (): CreateMonitorInput => {
    const headers = parseJsonField(headersText, 'Headers') as Record<string, string> | undefined;
    const body = method === 'GET' ? undefined : parseJsonField(bodyText, 'Request body');
    return {
      name: name.trim(),
      url: url.trim(),
      method,
      environment,
      description: description.trim(),
      intervalSec: intervalToSeconds(interval),
      timeoutMs: timeout,
      authType: AUTH_CODE[authType],
      ...(authType !== 'None' ? { authSecret } : {}),
      ...(authType === 'API Key' ? { authHeader } : {}),
      ...(headers ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
      autoBaseline: approveBaselineNow,
      createdBy: actor,
    };
  };

  const handleTestConnection = async () => {
    setFormError(null);
    if (!url || url === 'https://') {
      showToast('Please provide a valid endpoint URL to test.', 'error');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const p = buildPayload();
      const r = await guardian.monitors.test({ url: p.url, method: p.method, authType: p.authType, authSecret: p.authSecret, authHeader: p.authHeader, headers: p.headers, body: p.body, timeoutMs: p.timeoutMs }, actor);
      setTestResult(r);
      setTestedUrl(p.url);
      if (r.blocked) showToast(`Security alert: ${r.reason}`, 'error');
      else showToast(`Test request: ${r.outcome}${r.status ? ` HTTP ${r.status}` : ''} (${r.latencyMs}ms, ${r.fieldCount} fields)`, r.safe ? 'ok' : 'error');
    } catch (err) {
      const msg = describeError(err);
      setFormError(msg);
      showToast(msg, 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) return setFormError('Please enter an API friendly name');
    if (!url.trim() || url === 'https://') return setFormError('Please enter a valid endpoint URL');
    if (authType !== 'None' && !authSecret) return setFormError('Enter the credential for the selected auth type');
    const testedThisUrl = testedUrl === url.trim() && testResult;
    if (!testedThisUrl) {
      if (!window.confirm('You have not tested this exact URL yet. Register it anyway? (The first check runs immediately and its result becomes the baseline only if it succeeds.)')) return;
    } else if (!testResult.safe) {
      if (!window.confirm(`The last test of this URL failed (${testResult.blocked ? testResult.reason : `${testResult.outcome}: ${testResult.error ?? 'no JSON body'}`}). Register it anyway? It will show as Failing until the endpoint answers successfully.`)) return;
    }
    setIsSaving(true);
    try {
      const ok = await onAddApi(buildPayload());
      if (ok) {
        onClose();
        setName('');
        setUrl('https://');
        setTestResult(null);
        setAuthSecret('');
        setBodyText('');
      }
    } catch (err) {
      setFormError(describeError(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs"><Plus className="w-5 h-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Add API for Monitoring</h2>
              <p className="text-xs text-slate-500">Register endpoint, define check interval, and establish baseline.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {demo.length > 0 && (
            <details className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
              <summary className="text-xs font-semibold text-slate-700 cursor-pointer">Need a URL to try? Built-in demo APIs (copy one, paste it above, then Test Connection)</summary>
              <p className="text-[11px] text-slate-500 mt-2">Nothing is pre-filled: paste the URL yourself, test it, save it, and the first successful response becomes its baseline. Drifting APIs change on their own {Math.round((demo[0] ? 120000 : 120000) / 60000)} minutes after the first call.</p>
              {(['healthy', 'drifts', 'flaky', 'broken'] as const).map((mode) => (
                <div key={mode} className="mt-2.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{mode === 'healthy' ? 'Always correct' : mode === 'drifts' ? 'Correct now, changes later' : mode === 'flaky' ? 'Flapping' : 'Always failing'}</div>
                  <ul className="space-y-1">
                    {demo.filter((e) => e.mode === mode).map((e) => (
                      <li key={e.key} className="flex items-center gap-2 text-[11px]">
                        <button type="button" onClick={() => void navigator.clipboard.writeText(e.url).then(() => showToast(`Copied ${e.url}`))} className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] font-semibold text-slate-700 hover:bg-slate-100 shrink-0">Copy</button>
                        <span className="font-mono text-slate-700 break-all">{e.method} {e.url}</span>
                        {e.requestBody ? <span className="text-slate-400 shrink-0">body: <code>{JSON.stringify(e.requestBody)}</code></span> : null}
                        {e.monitorId ? <span className="text-emerald-600 shrink-0">registered</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </details>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="api-name">API Name *</label>
              <input id="api-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. User Profile API" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
              <p className="text-[11px] text-slate-400 mt-1">Friendly identifier used in incident reports</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="api-env">Environment *</label>
              <select id="api-env" value={environment} onChange={(e) => setEnvironment(e.target.value as EnvironmentType)} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500">
                <option value="Production">Production</option>
                <option value="Staging">Staging</option>
                <option value="Development">Development</option>
              </select>
              <p className="text-[11px] text-slate-400 mt-1">Scope for alerts and transformation rules</p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="api-url">Endpoint URL & Method *</label>
            {localHttps && (
              <p className="mb-1.5 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
                <span>Local servers such as the demo APIs on port 3000 speak plain HTTP; an <code>https://</code> URL will fail the TLS handshake.</span>
                <button type="button" onClick={() => setUrl(url.replace(/^https:\/\//, 'http://'))} className="px-2 py-0.5 bg-white border border-amber-300 rounded text-[10px] font-semibold shrink-0">Switch to http://</button>
              </p>
            )}
            <div className="flex gap-2">
              <select aria-label="HTTP method" value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} className="w-28 px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono font-bold text-xs text-blue-700 focus:outline-none focus:border-blue-500">
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="relative flex-1">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input id="api-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.domain.com/v1/resource" className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500" />
              </div>
            </div>
          </div>

          {method !== 'GET' && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="api-body">Request body (JSON)</label>
              <textarea id="api-body" value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={3} spellCheck={false} placeholder='{"amount": 1250, "currency": "USD"}' className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-500" />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="api-interval">Monitoring Interval</label>
              <select id="api-interval" value={interval} onChange={(e) => setInterval(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-blue-500">
                <option value="30s">Every 30 seconds (Demo)</option>
                <option value="1m">Every 1 minute (Critical)</option>
                <option value="5m">Every 5 minutes (Standard)</option>
                <option value="15m">Every 15 minutes</option>
                <option value="30m">Every 30 minutes</option>
                <option value="1h">Every 1 hour</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="api-timeout">Request Timeout (ms)</label>
              <select id="api-timeout" value={timeout} onChange={(e) => setTimeoutVal(Number(e.target.value))} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-blue-500">
                <option value={1000}>1,000 ms (Strict)</option>
                <option value={3000}>3,000 ms</option>
                <option value={5000}>5,000 ms (Recommended)</option>
                <option value={10000}>10,000 ms</option>
              </select>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5 text-slate-500" /> Authentication Settings</span>
              <span className="text-[11px] text-slate-500">Encrypted at rest (AES-256-GCM), never returned by the API</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select aria-label="Authentication type" value={authType} onChange={(e) => setAuthType(e.target.value as AuthType)} className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800">
                <option value="None">No Auth</option>
                <option value="Bearer Token">Bearer Token</option>
                <option value="API Key">API Key (Header)</option>
                <option value="Basic Auth">Basic Auth (user:password)</option>
              </select>
              {authType !== 'None' && (
                <input aria-label="Secret" type="password" value={authSecret} onChange={(e) => setAuthSecret(e.target.value)} placeholder={authType === 'Basic Auth' ? 'user:password' : 'Enter secret token or key...'} autoComplete="off" className={`${authType === 'API Key' ? '' : 'sm:col-span-2'} w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500`} />
              )}
              {authType === 'API Key' && <input aria-label="Header name" value={authHeader} onChange={(e) => setAuthHeader(e.target.value)} placeholder="X-API-Key" className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800" />}
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1" htmlFor="api-headers">Extra headers (JSON object, optional)</label>
              <input id="api-headers" value={headersText} onChange={(e) => setHeadersText(e.target.value)} placeholder='{"Accept-Language": "en"}' className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5" htmlFor="api-desc">Description</label>
            <input id="api-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Account metadata and organization membership details" className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-blue-500" />
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <button type="button" onClick={() => void handleTestConnection()} disabled={isTesting} className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors disabled:opacity-60">
                {isTesting ? <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Play className="w-3.5 h-3.5 text-blue-400 fill-blue-400" />}
                <span>Test Connection</span>
              </button>
              <span className="text-[11px] text-slate-500">Real request through the backend; SSRF guard applies</span>
            </div>
            {testResult && (
              <div className={`p-3.5 rounded-2xl border text-xs font-mono animate-in fade-in ${testResult.safe ? 'bg-emerald-50/60 border-emerald-200 text-slate-800' : 'bg-rose-50/60 border-rose-200 text-rose-800'}`} data-testid="test-result">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60">
                  <span className="font-bold flex items-center gap-1.5">
                    {testResult.safe ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />}
                    {testResult.blocked ? 'Blocked' : `${testResult.outcome}${testResult.status ? ` · HTTP ${testResult.status}` : ''}`} · {testResult.latencyMs}ms · {testResult.fieldCount} fields
                  </span>
                  <span className="text-[10px] text-slate-500">{testResult.contentType ?? testResult.parseOutcome}</span>
                </div>
                <pre className="text-[11px] max-h-40 overflow-y-auto leading-relaxed bg-white/70 p-2 rounded-lg border border-slate-200/50 whitespace-pre-wrap">{testResult.blocked || testResult.error ? (testResult.reason ?? testResult.error) : JSON.stringify(testResult.preview, null, 2)}</pre>
              </div>
            )}
          </div>

          <div className="p-3.5 rounded-2xl bg-blue-50/50 border border-blue-200/60 flex items-start gap-3">
            <input type="checkbox" id="baselineCheck" checked={approveBaselineNow} onChange={(e) => setApproveBaselineNow(e.target.checked)} className="mt-0.5 w-4 h-4 accent-blue-600 rounded" />
            <label htmlFor="baselineCheck" className="text-xs text-slate-700 cursor-pointer">
              <span className="font-semibold text-slate-900 block">Approve first successful response as baseline</span>
              Future checks will compare the response JSON structure against this baseline to detect missing, renamed or retyped fields. Untick to review and approve the first response manually.
            </label>
          </div>

          {formError && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-2.5" role="alert">{formError}</p>}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
            <button type="submit" disabled={isSaving} className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 disabled:opacity-60">
              <Check className="w-4 h-4" />
              <span>{isSaving ? 'Registering & running first check…' : 'Save API Configuration'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
