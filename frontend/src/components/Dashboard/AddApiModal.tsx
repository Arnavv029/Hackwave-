import React, { useState } from 'react';
import { 
  X, 
  Plus, 
  Globe, 
  Clock, 
  Lock, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  Server, 
  Play, 
  Check, 
  Info,
  Terminal
} from 'lucide-react';
import { RegisteredApi, HttpMethod, EnvironmentType, AuthType } from '../../types';

interface AddApiModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddApi: (newApi: RegisteredApi) => void;
  showToast: (msg: string) => void;
}

export const AddApiModal: React.FC<AddApiModalProps> = ({
  isOpen,
  onClose,
  onAddApi,
  showToast,
}) => {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [environment, setEnvironment] = useState<EnvironmentType>('Production');
  const [interval, setInterval] = useState('5m');
  const [timeout, setTimeoutVal] = useState(5000);
  const [authType, setAuthType] = useState<AuthType>('None');
  const [authSecret, setAuthSecret] = useState('');
  const [description, setDescription] = useState('');
  const [approveBaselineNow, setApproveBaselineNow] = useState(true);

  // Testing connection state
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    status: number;
    latency: number;
    preview: string;
    safe: boolean;
  } | null>(null);

  if (!isOpen) return null;

  const handleTestConnection = () => {
    if (!url || url === 'https://') {
      showToast('Please provide a valid endpoint URL to test.');
      return;
    }

    // SSRF validation simulation
    const isPrivate = url.includes('localhost') || url.includes('127.0.0.1') || url.includes('192.168.') || url.includes('10.');
    if (isPrivate) {
      setTestResult({
        status: 403,
        latency: 12,
        preview: JSON.stringify({ error: 'SSRF Guard Blocked Destination', reason: 'RFC1918 private IP destinations forbidden in cloud monitor' }, null, 2),
        safe: false
      });
      showToast('Security alert: SSRF Guard blocked local destination');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    setTimeout(() => {
      setIsTesting(false);
      const mockLatency = Math.floor(Math.random() * 50 + 65);
      const mockPayload = {
        status: 'ok',
        version: '1.4.0',
        endpoint: url,
        timestamp: new Date().toISOString(),
        data: {
          id: Math.floor(Math.random() * 900 + 100),
          service: name || 'monitored-service',
          healthy: true
        }
      };

      setTestResult({
        status: 200,
        latency: mockLatency,
        preview: JSON.stringify(mockPayload, null, 2),
        safe: true
      });
      showToast(`Test request successful: HTTP 200 (${mockLatency}ms)`);
    }, 600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      showToast('Please enter an API friendly name');
      return;
    }

    if (!url.trim() || url === 'https://') {
      showToast('Please enter a valid endpoint URL');
      return;
    }

    const newApi: RegisteredApi = {
      id: `api-${Date.now()}`,
      name,
      url,
      method,
      environment,
      status: 'Healthy',
      responseTime: testResult ? `${testResult.latency}ms` : '95ms',
      responseTimeNumeric: testResult ? testResult.latency : 95,
      lastChecked: 'Just now',
      hasIncident: false,
      baselineApproved: approveBaselineNow,
      interval,
      timeout,
      authType,
      description: description || 'Registered external dependency monitored by API Guardian.',
      uptime: '100%',
      history: [
        { time: 'Just now', latency: testResult ? testResult.latency : 95, status: 200 }
      ]
    };

    onAddApi(newApi);
    showToast(`Registered API dependency: ${name}`);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Add API for Monitoring</h2>
              <p className="text-xs text-slate-500">Register endpoint, define check interval, and establish baseline.</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* API Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                API Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. User Profile API"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <p className="text-[11px] text-slate-400 mt-1">Friendly identifier used in incident reports</p>
            </div>

            {/* Environment */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Environment *
              </label>
              <select
                value={environment}
                onChange={(e) => setEnvironment(e.target.value as EnvironmentType)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="Production">Production</option>
                <option value="Staging">Staging</option>
                <option value="Development">Development</option>
              </select>
              <p className="text-[11px] text-slate-400 mt-1">Scope for alerts and transformation rules</p>
            </div>
          </div>

          {/* Endpoint URL & Method */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Endpoint URL & Method *
            </label>
            <div className="flex gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as HttpMethod)}
                className="w-28 px-3 py-2.5 bg-slate-100 border border-slate-200 rounded-xl font-mono font-bold text-xs text-blue-700 focus:outline-none focus:border-blue-500"
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
                <option value="PUT">PUT</option>
              </select>

              <div className="relative flex-1">
                <Globe className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.domain.com/v1/resource"
                  className="w-full pl-10 pr-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Monitoring Interval & Timeout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Monitoring Interval
              </label>
              <select
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-blue-500"
              >
                <option value="1m">Every 1 minute (Critical)</option>
                <option value="5m">Every 5 minutes (Standard)</option>
                <option value="15m">Every 15 minutes</option>
                <option value="30m">Every 30 minutes</option>
                <option value="1h">Every 1 hour</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Request Timeout (ms)
              </label>
              <select
                value={timeout}
                onChange={(e) => setTimeoutVal(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-blue-500"
              >
                <option value={1000}>1,000 ms (Strict)</option>
                <option value={3000}>3,000 ms</option>
                <option value={5000}>5,000 ms (Recommended)</option>
                <option value={10000}>10,000 ms</option>
              </select>
            </div>
          </div>

          {/* Authentication & Secrets */}
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-slate-500" />
                Authentication Settings
              </span>
              <span className="text-[11px] text-slate-500">Stored securely with AES-256</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <select
                  value={authType}
                  onChange={(e) => setAuthType(e.target.value as AuthType)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-800"
                >
                  <option value="None">No Auth</option>
                  <option value="Bearer Token">Bearer Token</option>
                  <option value="API Key">API Key (Header)</option>
                  <option value="Basic Auth">Basic Auth</option>
                </select>
              </div>

              {authType !== 'None' && (
                <div className="sm:col-span-2">
                  <input
                    type="password"
                    value={authSecret}
                    onChange={(e) => setAuthSecret(e.target.value)}
                    placeholder="Enter secret token or key..."
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Account metadata and organization membership details"
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm text-slate-900 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Test Connection Button & Preview Box */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-xs transition-colors disabled:opacity-60"
              >
                {isTesting ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-blue-400 fill-blue-400" />
                )}
                <span>Test Connection</span>
              </button>

              <span className="text-[11px] text-slate-500">SSRF protected: private subnets blocked</span>
            </div>

            {testResult && (
              <div className={`p-3.5 rounded-2xl border text-xs font-mono animate-in fade-in ${
                testResult.safe 
                  ? 'bg-emerald-50/60 border-emerald-200 text-slate-800' 
                  : 'bg-rose-50/60 border-rose-200 text-rose-800'
              }`}>
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200/60">
                  <span className="font-bold flex items-center gap-1.5">
                    {testResult.safe ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    )}
                    HTTP {testResult.status} · Latency: {testResult.latency}ms
                  </span>
                  <span className="text-[10px] text-slate-500">Observation Captured</span>
                </div>
                <pre className="text-[11px] max-h-32 overflow-y-auto leading-relaxed bg-white/70 p-2 rounded-lg border border-slate-200/50">
                  {testResult.preview}
                </pre>
              </div>
            )}
          </div>

          {/* Baseline Approval checkbox */}
          <div className="p-3.5 rounded-2xl bg-blue-50/50 border border-blue-200/60 flex items-start gap-3">
            <input
              type="checkbox"
              id="baselineCheck"
              checked={approveBaselineNow}
              onChange={(e) => setApproveBaselineNow(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-blue-600 rounded"
            />
            <label htmlFor="baselineCheck" className="text-xs text-slate-700 cursor-pointer">
              <span className="font-semibold text-slate-900 block">Approve first successful response as baseline</span>
              Future checks will compare response JSON structure against this baseline to detect missing fields or type alterations.
            </label>
          </div>

          {/* Form Actions */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>Save API Configuration</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
