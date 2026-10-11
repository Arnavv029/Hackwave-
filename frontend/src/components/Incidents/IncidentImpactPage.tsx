import React, { useState } from 'react';
import { 
  AlertTriangle, 
  ChevronRight, 
  Filter, 
  Search, 
  CheckCircle2, 
  ArrowRight, 
  ShieldAlert, 
  Code2, 
  Layers, 
  Plus, 
  ExternalLink,
  Clock,
  User,
  Activity,
  FileCode,
  Tag
} from 'lucide-react';
import type { Incident } from '../../types';

interface IncidentImpactPageProps {
  incidents: Incident[];
  selectedIncidentId?: string;
  onSelectIncident: (incidentId: string) => void;
  onSelectProposal: (proposalId: string) => void;
  onNavigateSection: (section: 'Recovery' | 'Dashboard') => void;
  onChangeStatus: (incidentId: string, status: Incident['status']) => Promise<void>;
  onAddMapping: (monitorId: string, feature: string, jsonPath: string, route?: string) => Promise<void>;
  onRequestProposal: (incidentId: string) => Promise<void>;
  showToast: (msg: string, kind?: 'ok' | 'error') => void;
}

export const IncidentImpactPage: React.FC<IncidentImpactPageProps> = ({
  incidents,
  selectedIncidentId: selectedFromParent,
  onSelectIncident,
  onSelectProposal,
  onNavigateSection,
  onChangeStatus,
  onAddMapping,
  onRequestProposal,
}) => {
  const [localSelectedId, setLocalSelectedId] = useState<string | undefined>(undefined);
  const selectedIncidentId = localSelectedId ?? selectedFromParent ?? incidents.find((i) => i.status !== 'Resolved')?.id ?? incidents[0]?.id;
  const setSelectedIncidentId = (id: string) => {
    setLocalSelectedId(id);
    onSelectIncident(id);
  };
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [severityFilter, setSeverityFilter] = useState<string>('All');

  // Inline new mapping form state
  const [newFeatureName, setNewFeatureName] = useState('');
  const [newJsonPath, setNewJsonPath] = useState('$.');
  const [newRoute, setNewRoute] = useState('');
  const [showAddMapping, setShowAddMapping] = useState(false);
  const [busy, setBusy] = useState(false);

  const incidentList = incidents;
  const activeIncident = incidentList.find((i) => i.id === selectedIncidentId) || incidentList[0];

  // Filtering
  const filteredIncidents = incidentList.filter((inc) => {
    const matchesSearch = !searchQuery || 
      inc.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (inc.apiName ? inc.apiName.toLowerCase().includes(searchQuery.toLowerCase()) : false) ||
      inc.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'All' || inc.status === statusFilter;
    const matchesSeverity = severityFilter === 'All' || inc.severity === severityFilter;
    return matchesSearch && matchesStatus && matchesSeverity;
  });

  const handleStatusChange = async (newStatus: Incident['status']) => {
    if (!activeIncident) return;
    setBusy(true);
    try {
      await onChangeStatus(activeIncident.id, newStatus);
    } finally {
      setBusy(false);
    }
  };

  const handleAddNewMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeIncident?.apiId || !newFeatureName.trim() || !newJsonPath.trim()) return;
    setBusy(true);
    try {
      await onAddMapping(activeIncident.apiId, newFeatureName.trim(), newJsonPath.trim(), newRoute.trim() || undefined);
      setNewFeatureName('');
      setNewJsonPath('$.');
      setNewRoute('');
      setShowAddMapping(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Incidents & Impact</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Identify what changed in API payloads and discover which frontend features may break.
          </p>
        </div>

        {/* Global Action */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigateSection('Recovery')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-semibold flex items-center gap-2 shadow-xs transition-colors"
          >
            <span>Recovery & Validation</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Split Layout: Table of Incidents (Top/Left) + Selected Incident Inspector (Bottom/Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Incidents Table List */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs p-4">
            {/* Filters */}
            <div className="space-y-2.5 mb-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter by API or incident ID..."
                  className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700"
                >
                  <option value="All">All Statuses</option>
                  <option value="Open">Open</option>
                  <option value="Investigating">Investigating</option>
                  <option value="Awaiting Fix">Awaiting Fix</option>
                  <option value="Resolved">Resolved</option>
                </select>

                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700"
                >
                  <option value="All">All Severities</option>
                  <option value="Critical">Critical</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>

            {/* Incident Cards List */}
            <div className="space-y-2.5 max-h-[680px] overflow-y-auto pr-0.5">
              {filteredIncidents.length === 0 && (
                <p className="text-xs text-slate-400 py-8 text-center">No incidents{incidentList.length ? ' match these filters' : ' detected yet. When a monitored response drifts from its baseline, it shows up here'}.</p>
              )}
              {filteredIncidents.map((incident) => {
                const isSelected = incident.id === activeIncident?.id;
                const isCrit = incident.severity === 'Critical';
                const isHigh = incident.severity === 'High';

                return (
                  <div
                    key={incident.id}
                    onClick={() => setSelectedIncidentId(incident.id)}
                    className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-blue-50/70 border-blue-300 shadow-xs ring-1 ring-blue-400/20'
                        : 'bg-white hover:bg-slate-50/80 border-slate-200/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs text-slate-900">{incident.id}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isCrit 
                            ? 'bg-rose-100 text-rose-700 border border-rose-200' 
                            : isHigh 
                              ? 'bg-amber-100 text-amber-700 border border-amber-200'
                              : 'bg-blue-100 text-blue-700 border border-blue-200'
                        }`}>
                          {incident.severity}
                        </span>
                      </div>

                      <span className="text-[11px] text-slate-400 font-medium">
                        {incident.status}
                      </span>
                    </div>

                    <h4 className="text-xs font-semibold text-slate-800 line-clamp-1">
                      {incident.title}
                    </h4>

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500">
                      <span className="truncate">{incident.apiName}</span>
                      <span className="font-mono text-[10px] text-slate-400 shrink-0">{incident.detectedAt?.split(',')[0] || 'Recent'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Deep Incident & Impact Inspector */}
        <div className="lg:col-span-7 space-y-5">
          {activeIncident ? (
            <>
              {/* Header Card */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-blue-600">{activeIncident.id}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-sm font-bold text-slate-900">{activeIncident.apiName}</span>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        activeIncident.severity === 'Critical' 
                          ? 'bg-rose-50 text-rose-700 border border-rose-200' 
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {activeIncident.severity} Severity
                      </span>
                    </div>
                    <h2 className="text-base font-bold text-slate-900 mt-1">{activeIncident.title}</h2>
                    <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{activeIncident.endpoint}</p>
                  </div>

                  {/* Status Dropdown */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500 font-medium">Status:</span>
                    <select
                      value={activeIncident.status}
                      disabled={busy}
                      onChange={(e) => void handleStatusChange(e.target.value as Incident['status'])}
                      className="px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800"
                    >
                      <option value="Open">Open</option>
                      <option value="Investigating">Investigating</option>
                      <option value="Awaiting Fix">Awaiting Fix</option>
                      <option value="Resolved">Resolved</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Detected: {activeIncident.detectedAt}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-slate-400" />
                    Seen {activeIncident.occurrenceCount ?? 1}× · last {activeIncident.lastSeenAt ?? activeIncident.detectedAt}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400" />
                    {activeIncident.assignee.name} · {activeIncident.assignee.role}
                  </span>
                </div>
              </div>

              {/* Section 1: What Changed? (Side-by-Side Response Diffs) */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Code2 className="w-4 h-4 text-blue-600" />
                    <h3 className="text-sm font-bold text-slate-900">What Changed? Response Drift Analysis</h3>
                  </div>
                  <span className="text-[11px] font-mono text-slate-500">JSON Contract Comparison</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
                  {/* Previous Response (Baseline) */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200">
                      <span className="font-bold text-emerald-700 flex items-center gap-1 text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Previous Response (Baseline)
                      </span>
                      <span className="text-[10px] text-slate-400">Approved</span>
                    </div>
                    {activeIncident.previousResponse === '(no approved baseline snapshot)' ? (
                      <div className="text-[11px] font-sans text-slate-600 leading-relaxed space-y-1.5">
                        <p className="font-semibold text-slate-800">No baseline yet.</p>
                        <p>This API has never returned a successful response, so there is nothing to compare against. The failure below happened on the first check ({activeIncident.issueType}).</p>
                        <p>Fix the URL or credentials (Dashboard → row actions) or wait for the endpoint to answer; the first successful JSON response becomes the baseline and this incident resolves on its own.</p>
                      </div>
                    ) : (
                      <pre className="text-slate-800 leading-relaxed overflow-x-auto text-[11px] max-h-48">
                        {activeIncident.previousResponse}
                      </pre>
                    )}
                  </div>

                  {/* Latest Response */}
                  <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-200">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-amber-200">
                      <span className="font-bold text-amber-800 flex items-center gap-1 text-[11px]">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                        Latest Response (Drifted)
                      </span>
                      <span className="text-[10px] text-amber-700 font-semibold">Live Probe</span>
                    </div>
                    <pre className="text-slate-800 leading-relaxed overflow-x-auto text-[11px] max-h-48">
                      {activeIncident.latestResponse}
                    </pre>
                  </div>
                </div>

                {/* Diff Badges */}
                <div className="mt-3 space-y-1.5">
                  {(activeIncident.diffs || []).length === 0 && <p className="text-xs text-slate-400">No field-level differences recorded for this incident.</p>}
                  {(activeIncident.diffs || []).map((diff, index) => (
                    <div key={index} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                          diff.changeType === 'removed' ? 'bg-rose-100 text-rose-700' : diff.changeType === 'renamed' ? 'bg-amber-100 text-amber-700' : diff.changeType === 'type_mismatch' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {diff.changeType.replace('_', ' ')}
                        </span>
                        <span className="font-mono font-bold text-slate-900">{diff.fieldName}</span>
                      </div>
                      <div className="text-[11px] text-slate-600">
                        <span className="text-slate-400">Baseline:</span> {diff.expected} <span className="text-slate-400 mx-1">→</span> <span className="font-semibold text-amber-700">{diff.actual}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 2: Potentially Affected Features */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-purple-600" />
                    <h3 className="text-sm font-bold text-slate-900">Potentially Affected Application Features</h3>
                  </div>
                  <span className="text-xs text-slate-400">Based on Registered Field Mappings</span>
                </div>

                <div className="space-y-3">
                  {(activeIncident.affectedFeatures || []).length === 0 && (
                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
                      No registered feature reads the changed fields. Map the features that depend on this API below so impact can be traced automatically.
                    </p>
                  )}
                  {(activeIncident.affectedFeatures || []).map((feat, index) => (
                    <div key={index} className="p-4 rounded-xl bg-slate-50 border border-slate-200/90 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900">{feat.featureName}</h4>
                          <span className="font-mono text-[11px] text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200">
                            Route: {feat.route}
                          </span>
                        </div>
                        <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                          {feat.impactLevel} Risk · {feat.affectedUsersPercentage}
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 leading-relaxed">
                        This feature expects <code className="font-mono font-bold text-blue-700 bg-blue-50 px-1 py-0.5 rounded border border-blue-200">$.{feat.expectedField}</code>. {feat.description}
                      </p>

                      <div className="pt-2 border-t border-slate-200/60 text-[11px] text-rose-700 font-medium flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Symptom: {feat.userFacingSymptom}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 3: Registered Mappings & Form */}
              <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Registered Impact Mappings</h3>
                    <p className="text-xs text-slate-500">Connects API fields to application components.</p>
                  </div>

                  <button
                    onClick={() => setShowAddMapping(!showAddMapping)}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Map Feature</span>
                  </button>
                </div>

                {/* Add Mapping Inline Form */}
                {showAddMapping && (
                  <form onSubmit={(e) => void handleAddNewMapping(e)} className="p-3.5 mb-3 bg-blue-50/60 border border-blue-200 rounded-xl space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Route (optional)</label>
                        <input
                          type="text"
                          value={newRoute}
                          onChange={(e) => setNewRoute(e.target.value)}
                          placeholder="/checkout"
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Feature Name</label>
                        <input
                          type="text"
                          required
                          value={newFeatureName}
                          onChange={(e) => setNewFeatureName(e.target.value)}
                          placeholder="e.g. Checkout Price Summary"
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-700 uppercase mb-1">Target JSON Path</label>
                        <input
                          type="text"
                          required
                          value={newJsonPath}
                          onChange={(e) => setNewJsonPath(e.target.value)}
                          placeholder="$.total_amount"
                          className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowAddMapping(false)}
                        className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="px-3 py-1 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-60"
                      >
                        Save Mapping
                      </button>
                    </div>
                  </form>
                )}

                {/* Mappings Table */}
                <div className="space-y-1.5">
                  {(activeIncident.registeredMappings || []).length === 0 && <p className="text-xs text-slate-400">No mappings registered for {activeIncident.apiName}.</p>}
                  {(activeIncident.registeredMappings || []).map((m, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <Tag className="w-3.5 h-3.5 text-slate-400" />
                        <span className="font-semibold text-slate-800">{m.feature}</span>
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[11px]">
                        <span className="text-slate-400">{m.api}</span>
                        <span className="text-slate-400">→</span>
                        <span className="font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          {m.jsonPath}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 4: Next Steps & Direct Bridge to Recovery */}
              <div className="p-5 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h4 className="text-sm font-bold">{activeIncident.proposalId ? 'Ready to review the proposed adapter fix?' : activeIncident.issueType === 'HTTP error' || activeIncident.issueType === 'Timeout' ? 'Availability incident' : 'No proposal yet'}</h4>
                  <p className="text-xs text-blue-100 mt-0.5">
                    {activeIncident.proposalId
                      ? 'A declarative reconciliation adapter was drafted from the diff in the Recovery workspace.'
                      : activeIncident.issueType === 'HTTP error' || activeIncident.issueType === 'Timeout'
                        ? 'A response adapter cannot repair an unavailable endpoint; the incident resolves automatically once the provider answers again.'
                        : 'Ask the engine to derive a declarative adapter from the detected changes.'}
                  </p>
                </div>
                {activeIncident.proposalId ? (
                  <button
                    onClick={() => {
                      onSelectProposal(activeIncident.proposalId!);
                      onNavigateSection('Recovery');
                    }}
                    className="px-4 py-2.5 bg-white text-blue-700 hover:bg-blue-50 rounded-xl text-xs font-bold shrink-0 flex items-center gap-2 shadow-sm transition-all active:scale-95"
                  >
                    <span>Review in Recovery & Validation</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : activeIncident.issueType !== 'HTTP error' && activeIncident.issueType !== 'Timeout' ? (
                  <button
                    onClick={() => void onRequestProposal(activeIncident.id)}
                    disabled={busy}
                    className="px-4 py-2.5 bg-white text-blue-700 hover:bg-blue-50 rounded-xl text-xs font-bold shrink-0 flex items-center gap-2 shadow-sm transition-all active:scale-95 disabled:opacity-60"
                  >
                    <span>Draft adapter proposal</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400">
              Select an incident from the list to view impact details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
