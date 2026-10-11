import React, { useState } from 'react';
import { 
  Plus, 
  Search, 
  Filter, 
  Calendar, 
  ArrowUpRight, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Activity, 
  RefreshCw, 
  ExternalLink, 
  ShieldCheck, 
  FileCode, 
  Pause, 
  Play, 
  MoreHorizontal,
  ChevronRight,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { RegisteredApi, MetricCardData, EnvironmentType, Incident } from '../../types';
import { MetricCards } from '../MetricCards';
import { ChartsSection } from '../ChartsSection';

interface DashboardViewProps {
  apis: RegisteredApi[];
  metricCards: MetricCardData[];
  incidents: Incident[];
  onOpenAddApi: () => void;
  onNavigateSection: (section: 'Incidents' | 'Recovery' | 'Reports' | 'Audit Log') => void;
  onProbeApi: (apiId: string) => void;
  onTogglePauseApi: (apiId: string) => void;
  showToast: (msg: string) => void;
  trafficData: any[];
  responseTimeData: any[];
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  apis,
  metricCards,
  incidents,
  onOpenAddApi,
  onNavigateSection,
  onProbeApi,
  onTogglePauseApi,
  showToast,
  trafficData,
  responseTimeData,
}) => {
  const [selectedEnv, setSelectedEnv] = useState<string>('All');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('7d');
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

  const handleManualProbe = (api: RegisteredApi) => {
    setProbingId(api.id);
    setTimeout(() => {
      setProbingId(null);
      onProbeApi(api.id);
      showToast(`Probed ${api.name}: Received HTTP 200 in ${api.responseTime}`);
    }, 700);
  };

  const openIncidentsCount = incidents.filter(i => i.status !== 'Resolved').length;

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

          {/* Date Range Dropdown */}
          <select
            value={selectedDateRange}
            onChange={(e) => setSelectedDateRange(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200/90 rounded-xl text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:border-blue-500"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

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
                <h4 className="text-xs sm:text-sm font-bold text-slate-900">Needs Attention: Schema Drift Detected</h4>
                <span className="px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-900 text-[11px] font-bold">
                  {openIncidentsCount} Open Incidents
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
                User Profile API changed <code className="font-mono text-amber-900 bg-amber-100 px-1 py-0.5 rounded">name → display_name</code>. Potentially affects User Profile Card.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onNavigateSection('Incidents')}
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
                      {api.hasIncident ? (
                        <button
                          onClick={() => onNavigateSection('Incidents')}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 text-[11px] font-semibold transition-colors"
                        >
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          <span>{api.incidentId}</span>
                        </button>
                      ) : api.baselineApproved ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          Baseline Locked
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">No baseline</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleManualProbe(api)}
                          disabled={isProbing}
                          title="Run safe check now"
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isProbing ? 'animate-spin text-blue-600' : ''}`} />
                        </button>

                        <button
                          onClick={() => onTogglePauseApi(api.id)}
                          title={isPaused ? "Resume checking" : "Pause monitoring"}
                          className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                          {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                        </button>

                        {api.hasIncident && (
                          <button
                            onClick={() => onNavigateSection('Incidents')}
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
            {[
              {
                time: '12:15 UTC',
                title: 'Staging Contract Test Passed (VAL-RUN-804)',
                desc: 'User Profile API adapter verified: $.name = "Aman Gupta"',
                badge: 'Validation',
                badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200'
              },
              {
                time: '11:48 UTC',
                title: 'Recovery Proposal Created (PROP-001)',
                desc: 'Backwards-compatible adapter proposed for name -> display_name',
                badge: 'Proposal',
                badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
              },
              {
                time: '11:42 UTC',
                title: 'Drift Detected on User Profile API',
                desc: 'Field `name` removed in latest HTTP 200 response payload',
                badge: 'Incident',
                badgeColor: 'bg-rose-50 text-rose-700 border-rose-200'
              },
              {
                time: '10:30 UTC',
                title: 'Baseline Approved for Orders API',
                desc: 'Payload committed by Alex Rivera as golden schema reference',
                badge: 'Baseline',
                badgeColor: 'bg-purple-50 text-purple-700 border-purple-200'
              }
            ].map((activity, idx) => (
              <div key={idx} className="p-3 rounded-xl bg-slate-50/70 border border-slate-100 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="w-2 h-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                  <div>
                    <h5 className="text-xs font-semibold text-slate-900">{activity.title}</h5>
                    <p className="text-[11px] text-slate-500 mt-0.5">{activity.desc}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${activity.badgeColor}`}>
                    {activity.badge}
                  </span>
                  <div className="text-[10px] text-slate-400 mt-1 font-mono">{activity.time}</div>
                </div>
              </div>
            ))}
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
