import React, { useState } from 'react';
import { Plus, Search, AlertTriangle, CheckCircle2, RefreshCw, ShieldCheck, Pause, Play, ChevronRight, ArrowRight } from 'lucide-react';
import type { RegisteredApi, MetricCardData, Incident, AuditLogItem } from '../../types';
import { Trash2, ShieldCheck as ShieldIcon } from 'lucide-react';
import { MetricCards } from '../MetricCards';
import { ChartsSection } from '../ChartsSection';

interface DashboardViewProps {
  apis: RegisteredApi[];
  metricCards: MetricCardData[];
  incidents: Incident[];
  activity: AuditLogItem[];
  onOpenAddApi: () => void;
  onNavigateSection: (section: 'Incidents' | 'Recovery' | 'Reports' | 'Audit Log') => void;
  onProbeApi: (apiId: string) => Promise<void>;
  onTogglePauseApi: (apiId: string) => Promise<void>;
  onDeleteApi: (apiId: string) => Promise<void>;
  onEditUrl: (apiId: string, url: string) => Promise<void>;
  onApproveBaseline: (apiId: string, baselineId: string) => Promise<void>;
  onOpenIncident: (incidentId: string) => void;
  showToast: (msg: string, kind?: 'ok' | 'error') => void;
  trafficData: { date: string; label: string; volume: number }[];
  responseTimeData: { time: string; avgLatency: number; peakLatency: number }[];
  lastUpdated: number | null;
  live: boolean;
  onRefresh: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  apis,
  metricCards,
  incidents,
  activity,
  onOpenAddApi,
  onNavigateSection,
  onProbeApi,
  onTogglePauseApi,
  onDeleteApi,
  onEditUrl,
  onApproveBaseline,
  onOpenIncident,
  showToast,
  trafficData,
  responseTimeData,
  lastUpdated,
  live,
  onRefresh,
}) => {
  const [selectedEnv, setSelectedEnv] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [probingId, setProbingId] = useState<string | null>(null);

  // Filtered APIs
  const filteredApis = apis.filter((api) => {
    const matchesEnv = selectedEnv === 'All' || api.environment === selectedEnv;
    const matchesSearch = !searchQuery || 
      api.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
      api.url.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesEnv && matchesSearch;
  });

  const handleManualProbe = async (api: RegisteredApi) => {
    setProbingId(api.id);
    try {
      await onProbeApi(api.id);
    } finally {
      setProbingId(null);
    }
  };

  const openIncidents = incidents.filter(i => i.status !== 'Resolved');
  const openIncidentsCount = openIncidents.length;
  const topIncident = openIncidents[0];
  const topChange = topIncident?.diffs?.find((d) => d.changeType !== 'added');
  const badgeFor = (action: string) =>
    /Incident/.test(action) ? ['Incident', 'bg-rose-50 text-rose-700 border-rose-200']
    : /Baseline/.test(action) ? ['Baseline', 'bg-purple-50 text-purple-700 border-purple-200']
    : /Validation/.test(action) ? ['Validation', 'bg-emerald-50 text-emerald-700 border-emerald-200']
    : /proposal|Adapter/i.test(action) ? ['Proposal', 'bg-blue-50 text-blue-700 border-blue-200']
    : /SSRF/.test(action) ? ['Security', 'bg-amber-50 text-amber-700 border-amber-200']
    : ['Activity', 'bg-slate-50 text-slate-700 border-slate-200'];

  return (
    <div className="space-y-6">
      {/* Top Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Monitor API health, establish baselines, and investigate changes.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-2.5">
          {/* Environment Filter */}
          <div className="flex items-center bg-white border border-slate-200/90 rounded-xl p-1 shadow-xs text-xs">
            {['All', 'Production', 'Staging', 'Development'].map((env) => (
              <button
                key={env}
                onClick={() => setSelectedEnv(env)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  selectedEnv === env 
                    ? 'bg-blue-50 text-blue-600 font-semibold shadow-xs' 
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {env}
              </button>
            ))}
          </div>

          {/* Live status */}
          <button
            onClick={onRefresh}
            title="Refresh now"
            className="px-3 py-2 bg-white border border-slate-200/90 rounded-xl text-xs font-medium text-slate-700 shadow-xs flex items-center gap-2"
          >
            <span className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-500' : 'bg-slate-300'}`} />
            <span>{live ? 'Live' : 'Polling'}{lastUpdated ? ` · updated ${new Date(lastUpdated).toLocaleTimeString()}` : ''}</span>
            <RefreshCw className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {/* Add API Action Button */}
          <button
            onClick={onOpenAddApi}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-sm shadow-blue-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Add API</span>
          </button>
        </div>
      </div>

      {/* Needs Attention Alert Bar */}
      {openIncidentsCount > 0 && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/80 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-200">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-slate-900">Needs Attention: {topIncident?.issueType ?? 'Change'} Detected</h4>
                <span className="px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900 text-[11px] font-bold">
                  {openIncidentsCount} Open Incidents
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                {topIncident?.apiName}: {topChange ? <><code className="font-mono text-amber-900 bg-amber-100 px-1 py-0.5 rounded">{topChange.fieldName}</code> {topChange.changeType.replace('_', ' ')}.</> : topIncident?.title}
                {topIncident?.affectedFeatures?.length ? ` Potentially affects ${topIncident.affectedFeatures.map((f) => f.featureName).join(', ')}.` : ' No feature mappings registered yet.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => (topIncident ? onOpenIncident(topIncident.id) : onNavigateSection('Incidents'))}
              className="px-3.5 py-1.5 bg-white border border-amber-300 hover:bg-amber-100/50 text-amber-900 rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
            >
              <span>Investigate Impact</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onNavigateSection('Recovery')}
              className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5"
            >
              <span>Review Safe Fix</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 4 Summary Cards */}
      <MetricCards 
        cards={metricCards} 
        onOpenCardDetails={(card) => showToast(`Filter active for ${card.title}`)} 
      />

      {/* Response Time Trend & Traffic Charts */}
      <ChartsSection 
        trafficData={trafficData} 
        responseTimeData={responseTimeData} 
      />

      {/* Main Section: API Health Table */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Table Header Controls */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">API Health & Dependencies</h3>
            <p className="text-xs text-slate-500">
              Live status, latency measurements, and schema drift flags.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search registered APIs..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              onClick={onOpenAddApi}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register</span>
            </button>
          </div>
        </div>

        {/* Table View */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">API Name</th>
                <th className="py-3 px-4">Environment</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Response Time</th>
                <th className="py-3 px-4">Last Checked</th>
                <th className="py-3 px-4">Incident / Change</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {filteredApis.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    No APIs registered yet. Click <span className="font-semibold text-slate-600">Add API</span> and paste any JSON endpoint URL, or pick one of the built-in <span className="font-semibold text-slate-600">showcase APIs that go wrong</span> (also in Settings → Register all). The first successful response becomes the baseline.
                  </td>
                </tr>
              )}
              {filteredApis.map((api) => {
                const isProbing = probingId === api.id;
                const isFailing = api.status === 'Failing';
                const isReview = api.status === 'Review Needed';
                const isHealthy = api.status === 'Healthy';
                const isPaused = api.status === 'Paused';

                return (
                  <tr key={api.id} className="hover:bg-slate-50/60 transition-colors">
                    {/* API Name */}
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-slate-900">{api.name}</div>
                      <div className="font-mono text-[11px] text-slate-400 truncate max-w-xs sm:max-w-md">
                        <span className="text-blue-600 font-bold mr-1">{api.method}</span>
                        {api.url}
                      </div>
                    </td>

                    {/* Environment */}
                    <td className="py-3.5 px-4">
                      <span className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
                        api.environment === 'Production'
                          ? 'bg-purple-50 text-purple-700 border border-purple-200'
                          : api.environment === 'Staging'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                            : 'bg-slate-100 text-slate-700'
                      }`}>
                        {api.environment}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        isHealthy
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : isFailing
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : isReview
                              ? 'bg-amber-50 text-amber-700 border border-amber-200'
                              : 'bg-slate-100 text-slate-600'
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          isHealthy ? 'bg-emerald-500' : isFailing ? 'bg-rose-500' : isReview ? 'bg-amber-500' : 'bg-slate-400'
                        }`} />
                        {api.status}
                      </span>
                    </td>

                    {/* Response Time */}
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-900">
                      {api.responseTime}
                    </td>

                    {/* Last Checked */}
                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      {api.lastChecked}
                    </td>

                    {/* Incident / Change */}
                    <td className="py-3.5 px-4">
                      {api.hasIncident && api.incidentId ? (
                        <button
                          onClick={() => onOpenIncident(api.incidentId!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 text-[11px] font-semibold transition-colors"
                        >
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          <span>{api.openIncidentCount ?? 1} open incident{(api.openIncidentCount ?? 1) === 1 ? '' : 's'}</span>
                        </button>
                      ) : api.pendingBaselineId ? (
                        <button
                          onClick={() => void onApproveBaseline(api.id, api.pendingBaselineId!)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 text-[11px] font-semibold transition-colors"
                          title="Approve the captured first response as the baseline"
                        >
                          <ShieldIcon className="w-3 h-3" />
                          Approve baseline
                        </button>
                      ) : api.baselineApproved ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          Baseline Locked{api.activeProposalId ? ' · adapter active' : ''}
                        </span>
                      ) : api.statusOnly ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 font-medium" title="The endpoint answers successfully but not with JSON, so only status and latency are monitored">
                          <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
                          Status-only (non-JSON)
                        </span>
                      ) : api.lastError ? (
                        <span className="text-[11px] text-rose-500 truncate max-w-[200px] inline-block" title={api.lastError}>{api.lastError}</span>
                      ) : (
                        <span className="text-[11px] text-slate-400">No baseline</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => void handleManualProbe(api)}
                          disabled={isProbing}
                          title="Run safe check now"
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin text-blue-600' : ''}`} />
                        </button>

                        <button
                          onClick={() => void onTogglePauseApi(api.id)}
                          title={isPaused ? "Resume checking" : "Pause monitoring"}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          onClick={() => { const next = window.prompt(`Endpoint URL for ${api.name}`, api.url); if (next && next.trim() && next.trim() !== api.url) void onEditUrl(api.id, next.trim()); }}
                          title="Edit endpoint URL"
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors text-[11px] font-bold"
                        >
                          URL
                        </button>

                        <button
                          onClick={() => { if (window.confirm(`Remove monitor "${api.name}" and its history?`)) void onDeleteApi(api.id); }}
                          title="Remove monitor"
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        {api.hasIncident && api.incidentId && (
                          <button
                            onClick={() => onOpenIncident(api.incidentId!)}
                            className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-[11px] font-semibold transition-colors"
                          >
                            Details
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom Section: Recent Activity & Baseline Log */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Activity Feed */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Recent Telemetry Activity</h3>
              <p className="text-xs text-slate-500">Live checks, baseline approvals, and detected changes.</p>
            </div>
            <button 
              onClick={() => onNavigateSection('Audit Log')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <span>View Full Audit Log</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {activity.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">No activity yet. Register an API to start the audit trail.</p>}
            {activity.filter((a) => a.action !== 'Manual check executed').slice(0, 6).map((item) => {
              const [badge, badgeColor] = badgeFor(item.action);
              return (
              <div key={item.id} className="p-3 rounded-xl bg-slate-50/70 border border-slate-100 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${item.result === 'Failure' ? 'bg-rose-500' : 'bg-blue-500'}`} />
                  <div>
                    <h5 className="text-xs font-semibold text-slate-900">{item.action} · {item.target}</h5>
                    <p className="text-[11px] text-slate-500 mt-0.5">{item.details}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${badgeColor}`}>
                    {badge}
                  </span>
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">{item.timestamp}</div>
                </div>
              </div>
              );
            })}
          </div>
        </div>

        {/* Quick Actions & Help Widget */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center mb-4">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h4 className="text-base font-bold text-white">How API Guardian Works</h4>
            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              When an upstream API alters a JSON field or response type, API Guardian compares it against your baseline, flags the affected feature mappings, and produces a verifiable adapter proposal.
            </p>
          </div>

          <div className="mt-6 space-y-2.5">
            <button
              onClick={() => onNavigateSection('Reports')}
              className="w-full py-2 px-3 bg-white/10 hover:bg-white/15 text-white rounded-xl text-xs font-semibold flex items-center justify-between transition-colors"
            >
              <span>Export Reliability Report (PDF)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onNavigateSection('Recovery')}
              className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center justify-between transition-colors shadow-sm"
            >
              <span>Open Recovery Sandbox</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
