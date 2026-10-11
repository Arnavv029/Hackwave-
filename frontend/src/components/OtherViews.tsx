import React, { useState } from 'react';
import { 
  ShieldCheck, 
  FileText, 
  Bell, 
  HelpCircle, 
  MessageSquare, 
  Settings, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink,
  Copy,
  Check,
  Send,
  Sliders,
  Users,
  Key
} from 'lucide-react';
import { NavSection, ServiceItem } from '../types';

interface OtherViewsProps {
  section: NavSection;
  services: ServiceItem[];
  onBackToDashboard: () => void;
}

export const OtherViews: React.FC<OtherViewsProps> = ({ section, services, onBackToDashboard }) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const handleCopy = () => {
    navigator.clipboard.writeText('sk_live_sitescope_892b1a83ef02');
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleSendFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;
    setFeedbackSent(true);
    setTimeout(() => {
      setFeedbackText('');
      setFeedbackSent(false);
    }, 3000);
  };

  if (section === 'Monitoring') {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Regional Monitoring Probes</h2>
              <p className="text-xs text-slate-500">Live multi-datacenter ping status & edge DNS resolution.</p>
            </div>
            <span className="px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full text-xs font-semibold border border-emerald-200">
              14/14 Regions Online
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { region: 'US East (N. Virginia)', latency: '18ms', status: 'Nominal', nodes: '8 nodes' },
              { region: 'US West (Oregon)', latency: '32ms', status: 'Nominal', nodes: '6 nodes' },
              { region: 'Europe (Frankfurt)', latency: '84ms', status: 'Nominal', nodes: '8 nodes' },
              { region: 'Europe (London)', latency: '79ms', status: 'Nominal', nodes: '6 nodes' },
              { region: 'Asia Pacific (Tokyo)', latency: '142ms', status: 'Nominal', nodes: '4 nodes' },
              { region: 'Asia Pacific (Singapore)', latency: '165ms', status: 'Nominal', nodes: '4 nodes' },
            ].map((probe) => (
              <div key={probe.region} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-white transition-colors">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800">{probe.region}</span>
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-xl font-bold font-mono text-slate-900">{probe.latency}</span>
                  <span className="text-[11px] text-slate-400 font-mono">{probe.nodes}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (section === 'Logs') {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Synthetic Probe Logs</h2>
              <p className="text-xs text-slate-500">Live immutable audit trail of endpoint pings and latency spikes.</p>
            </div>
            <div className="font-mono text-xs text-slate-400">Stream: Active (200ms)</div>
          </div>

          <div className="space-y-2 font-mono text-xs max-h-96 overflow-y-auto">
            {[
              { time: '15:30:12', level: 'INFO', msg: 'GET https://example.com [200 OK] 142ms — SSL: Valid' },
              { time: '15:29:44', level: 'WARN', msg: 'GET storage.example.com [200 OK] 256ms — Latency threshold (>200ms) exceeded' },
              { time: '15:29:10', level: 'INFO', msg: 'GET https://api.example.com [200 OK] 89ms — TLS 1.3 handshake OK' },
              { time: '15:28:30', level: 'INFO', msg: 'GET https://cdn.example.com [200 OK] 45ms — Edge cache HIT' },
              { time: '15:27:50', level: 'INFO', msg: 'TCP db.example.com:5432 [CONNECTED] 12ms — Pool utilization 42%' },
              { time: '15:27:00', level: 'INFO', msg: 'SMTP mail.example.com:587 [READY] 178ms — Queue clean' },
            ].map((log, i) => (
              <div key={i} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-3">
                <span className="text-slate-400 shrink-0">{log.time}</span>
                <span className={`font-semibold shrink-0 ${log.level === 'WARN' ? 'text-amber-600' : 'text-blue-600'}`}>
                  [{log.level}]
                </span>
                <span className="text-slate-700 truncate">{log.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (section === 'Alerts') {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Incident & Alert Triggers</h2>
              <p className="text-xs text-slate-500">Configure PagerDuty, Slack webhooks, and email escalation policies.</p>
            </div>
            <button className="px-3 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700">
              + New Rule
            </button>
          </div>

          <div className="space-y-3">
            <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/50 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-slate-900">Active Warning: Storage Service Latency</h4>
                  <span className="text-xs text-amber-700 font-mono">Triggered 24m ago</span>
                </div>
                <p className="text-xs text-slate-600 mt-1">Average response time exceeds 200ms threshold across 3 consecutive polling intervals.</p>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-slate-200/80 bg-white flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-slate-900">Slack Incident Bot (#devops-alerts)</h4>
                <p className="text-xs text-slate-500 mt-0.5">Notifies channel on HTTP 5xx responses or heartbeat timeout &gt; 60s</p>
              </div>
              <span className="px-2.5 py-1 bg-emerald-50 text-emerald-600 text-xs font-medium rounded-lg border border-emerald-200">
                Connected
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'Help Center') {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
          <h2 className="text-lg font-bold text-slate-900">SiteScope Documentation & Help</h2>
          <p className="text-xs text-slate-500 mt-1">Everything you need to integrate uptime monitoring into your stack.</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50">
              <h4 className="text-sm font-semibold text-slate-900">Fast Synthetic Ping CLI</h4>
              <p className="text-xs text-slate-500 mt-1">Run lightweight probes directly from your local terminal or CI/CD pipelines.</p>
              <div className="mt-3 p-2 bg-slate-900 text-emerald-400 font-mono text-xs rounded-lg">
                npx @sitescope/cli monitor add https://yourdomain.com
              </div>
            </div>
            <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/50">
              <h4 className="text-sm font-semibold text-slate-900">Webhook Integration Specs</h4>
              <p className="text-xs text-slate-500 mt-1">Receive signed HMAC-SHA256 payloads whenever an incident starts or resolves.</p>
              <button className="mt-3 text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1">
                Read Webhook Docs <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'Feedback') {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs animate-in fade-in duration-200">
        <h2 className="text-lg font-bold text-slate-900">Send Product Feedback</h2>
        <p className="text-xs text-slate-500 mt-1">Help us improve SiteScope. Your thoughts go directly to our engineering team.</p>

        {feedbackSent ? (
          <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2.5 text-emerald-700 text-sm font-medium">
            <CheckCircle2 className="w-5 h-5" />
            <span>Thank you! Your feedback has been recorded successfully.</span>
          </div>
        ) : (
          <form onSubmit={handleSendFeedback} className="mt-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Feedback & Feature Requests
              </label>
              <textarea
                rows={4}
                required
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What features or monitor types would you like to see next in SiteScope?"
                className="w-full p-3 bg-slate-50 border border-slate-200/90 rounded-xl text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Feedback</span>
            </button>
          </form>
        )}
      </div>
    );
  }

  if (section === 'Settings') {
    return (
      <div className="space-y-6 animate-in fade-in duration-200">
        <div className="bg-white rounded-2xl border border-slate-200/90 p-6 shadow-xs">
          <h2 className="text-lg font-bold text-slate-900">Organization Settings</h2>
          <p className="text-xs text-slate-500 mt-1">Manage API keys, telemetry preferences, and probe intervals.</p>

          <div className="mt-6 space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                API Live Token
              </label>
              <div className="flex items-center gap-2 max-w-md">
                <input
                  type="text"
                  readOnly
                  value="sk_live_sitescope_892b1a83ef02"
                  className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200/90 rounded-xl font-mono text-xs text-slate-700"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs font-medium text-slate-700 flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between max-w-md">
              <div>
                <p className="text-sm font-semibold text-slate-900">Automatic DNS Health Checks</p>
                <p className="text-xs text-slate-500">Probe nameserver authoritative response times</p>
              </div>
              <input type="checkbox" defaultChecked className="w-4 h-4 accent-blue-600 rounded" />
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between max-w-md">
              <div>
                <p className="text-sm font-semibold text-slate-900">SSL Expiration Warnings</p>
                <p className="text-xs text-slate-500">Alert 30 days prior to certificate expiry</p>
              </div>
              <input type="checkbox" defaultChecked className="w-4 h-4 accent-blue-600 rounded" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
