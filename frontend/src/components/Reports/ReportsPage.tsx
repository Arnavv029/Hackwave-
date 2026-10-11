import React, { useState } from 'react';
import { 
  FileText, 
  Download, 
  Printer, 
  Filter, 
  Calendar, 
  CheckCircle2, 
  AlertTriangle, 
  ShieldCheck, 
  Clock, 
  RefreshCw,
  Layers,
  Sparkles,
  ArrowRight,
  Database
} from 'lucide-react';
import type { RegisteredApi, Incident, RecoveryProposal } from '../../types';

interface ReportsPageProps {
  apis: RegisteredApi[];
  incidents: Incident[];
  proposals: RecoveryProposal[];
  organization: string;
  showToast: (msg: string) => void;
}

function docHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  apis,
  incidents,
  proposals,
  organization,
  showToast,
}) => {
  const [selectedApiScope, setSelectedApiScope] = useState<string>('All');
  const [selectedRange, setSelectedRange] = useState<string>('7d');
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string>(new Date().toUTCString());

  const handleGenerate = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setIsGenerating(false);
      setReportGeneratedAt(new Date().toUTCString());
      showToast('Generated fresh API Reliability & Impact Report');
    }, 600);
  };

  const handleDownloadPdf = () => {
    showToast('Preparing printable PDF document...');
    setTimeout(() => {
      window.print();
    }, 300);
  };

  // Filtered APIs for report
  const reportApis = selectedApiScope === 'All' 
    ? apis 
    : apis.filter(a => a.name === selectedApiScope);

  const reportIncidents = selectedApiScope === 'All'
    ? incidents
    : incidents.filter(i => i.apiName === selectedApiScope);
  const reportProposals = selectedApiScope === 'All' ? proposals : proposals.filter((p) => p.apiName === selectedApiScope);
  const openCount = reportIncidents.filter((i) => i.status !== 'Resolved').length;
  const highest = reportIncidents.find((i) => i.severity === 'Critical') ?? reportIncidents.find((i) => i.severity === 'High');
  const validated = reportProposals.filter((p) => p.validationResult?.status === 'Passed');
  const promoted = reportProposals.filter((p) => p.statusLabel === 'Promoted');
  const affectedFeatureCount = new Set(reportIncidents.flatMap((i) => (i.affectedFeatures ?? []).map((f) => f.featureName))).size;
  const documentId = `RPT-${new Date(reportGeneratedAt).toISOString().slice(0, 10).replace(/-/g, '')}-${docHash(reportGeneratedAt + selectedApiScope).slice(0, 4).toUpperCase()}`;
  const contentHash = docHash(JSON.stringify({ apis: reportApis.map((a) => [a.id, a.status]), incidents: reportIncidents.map((i) => [i.id, i.status]), proposals: reportProposals.map((p) => [p.id, p.statusLabel]) }));

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Reports</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            View executive telemetry overview, schema drift records, and export audit-ready PDF reports.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* API Scope Selector */}
          <select
            value={selectedApiScope}
            onChange={(e) => setSelectedApiScope(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200/90 rounded-xl text-xs font-semibold text-slate-700 shadow-xs focus:outline-none focus:border-blue-500"
          >
            <option value="All">Scope: All Registered APIs ({apis.length})</option>
            {apis.map((a) => (
              <option key={a.id} value={a.name}>{a.name}</option>
            ))}
          </select>

          {/* Date Range */}
          <select
            value={selectedRange}
            onChange={(e) => setSelectedRange(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200/90 rounded-xl text-xs font-semibold text-slate-700 shadow-xs focus:outline-none focus:border-blue-500"
          >
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
          </select>

          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
            <span>Generate Report</span>
          </button>

          <button
            onClick={handleDownloadPdf}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold flex items-center gap-2 shadow-sm shadow-blue-500/20 transition-all active:scale-95"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download PDF</span>
          </button>
        </div>
      </div>

      {/* Printable Report Document Card */}
      <div className="bg-white rounded-3xl border border-slate-200/90 shadow-lg p-6 sm:p-10 max-w-5xl mx-auto space-y-8 print:border-none print:shadow-none print:p-0">
        {/* Document Header */}
        <div className="border-b border-slate-200 pb-6 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm">
                AG
              </div>
              <span className="text-xl font-bold tracking-tight text-slate-900">API Guardian</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold border border-blue-200">
                Official Report
              </span>
            </div>
            <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">
              API Reliability & Schema Drift Audit
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Downstream contract stability, drift detection, and adapter recovery overview.
            </p>
          </div>

          <div className="text-left sm:text-right text-xs text-slate-500 space-y-1">
            <p><span className="font-semibold text-slate-700">Generated:</span> {reportGeneratedAt}</p>
            <p><span className="font-semibold text-slate-700">Period:</span> Last {selectedRange}</p>
            <p><span className="font-semibold text-slate-700">Scope:</span> {selectedApiScope}</p>
            <p><span className="font-semibold text-slate-700">Document ID:</span> <span className="font-mono">{documentId}</span></p>
          </div>
        </div>

        {/* 1. Executive Summary */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            1. Executive Summary
          </h3>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs sm:text-sm text-slate-700 leading-relaxed">
            API Guardian performs scheduled probes against {reportApis.length} registered API endpoint{reportApis.length === 1 ? '' : 's'} and compares every JSON response with its approved baseline.
            {' '}{reportIncidents.length === 0
              ? 'No schema, availability or latency incidents have been recorded in this scope.'
              : `${reportIncidents.length} incident${reportIncidents.length === 1 ? '' : 's'} ${reportIncidents.length === 1 ? 'was' : 'were'} identified (${openCount} still open)${highest ? `, the most severe being a ${highest.severity.toLowerCase()} ${highest.issueType?.toLowerCase() ?? 'change'} on ` : '.'}`}
            {highest && <strong className="text-slate-900">{highest.apiName}</strong>}{highest ? '.' : ''}
            {' '}{affectedFeatureCount > 0 ? `Registered field mappings traced the impact to ${affectedFeatureCount} application feature${affectedFeatureCount === 1 ? '' : 's'} before end-user complaints.` : 'No registered feature mappings were affected.'}
            {' '}{reportProposals.length === 0 ? 'No adapter proposals were needed.' : `${reportProposals.length} declarative adapter proposal${reportProposals.length === 1 ? '' : 's'} ${reportProposals.length === 1 ? 'was' : 'were'} drafted; ${validated.length} passed sandbox validation and ${promoted.length} ${promoted.length === 1 ? 'is' : 'are'} active at the gateway.`}
          </div>
        </div>

        {/* 2. Registered API Inventory */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            2. API Inventory & Performance Overview
          </h3>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                  <th className="p-3">API Name</th>
                  <th className="p-3">Environment</th>
                  <th className="p-3">Latency</th>
                  <th className="p-3">Uptime</th>
                  <th className="p-3">Baseline</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {reportApis.map((api) => (
                  <tr key={api.id} className="hover:bg-slate-50/50">
                    <td className="p-3 font-semibold text-slate-900">{api.name}</td>
                    <td className="p-3">{api.environment}</td>
                    <td className="p-3 font-mono">{api.responseTime}</td>
                    <td className="p-3 font-mono">{api.uptime}</td>
                    <td className="p-3">{api.baselineApproved ? 'Locked' : 'Pending'}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        api.status === 'Healthy' 
                          ? 'bg-emerald-50 text-emerald-700' 
                          : api.status === 'Failing'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}>
                        {api.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Incidents & Impact Analysis */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            3. Detected Changes & Downstream Impact
          </h3>
          <div className="space-y-3">
            {reportIncidents.length === 0 && <p className="text-xs text-slate-400 p-4 rounded-xl border border-slate-200 bg-white">No detected changes in this scope.</p>}
            {reportIncidents.map((incident) => (
              <div key={incident.id} className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-blue-700">{incident.id}</span>
                    <span className="font-bold text-slate-900">{incident.title}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-amber-50 text-amber-700 border border-amber-200">
                    {incident.severity}
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  <span className="font-semibold">Detected at:</span> {incident.detectedAt} · <span className="font-semibold">Endpoint:</span> {incident.endpoint}
                </p>
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">Potentially Affected Features:</span>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {(incident.affectedFeatures || []).map((f, i) => (
                      <li key={i}>{f.featureName} ({f.route}) — expects <code className="font-mono text-blue-600">$.{f.expectedField}</code></li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 4. Recovery & Validation Outcomes */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            4. Recovery & Validation Outcomes
          </h3>
          <div className="space-y-2">
            {reportProposals.length === 0 && <p className="text-xs text-slate-400 p-4 rounded-xl border border-slate-200 bg-slate-50">No recovery proposals in this scope.</p>}
            {reportProposals.map((p) => (
              <div key={p.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">Proposal {p.id.slice(0, 8)} ({p.apiName})</span>
                  <span className={`px-2 py-0.5 rounded font-bold text-[11px] border ${p.statusLabel === 'Promoted' ? 'bg-blue-50 text-blue-700 border-blue-200' : p.validationResult?.status === 'Passed' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {p.statusLabel ?? p.status}{p.validationResult ? ` · validation ${p.validationResult.status}` : ' · not validated'}
                  </span>
                </div>
                <p className="text-slate-600">{p.proposedSolution}</p>
                {p.validationResult && (
                  <p className="text-slate-600">
                    Contract test <span className="font-mono text-slate-800 font-semibold">{p.validationResult.runId}</span>: {p.validationResult.assertions.filter((a) => a.passed).length}/{p.validationResult.assertions.length} assertions passed in {p.validationResult.latencyMs}ms.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 5. Evidence-Based Recommendations */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            5. Recommendations & Next Steps
          </h3>
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200/70 text-xs text-slate-800 space-y-2">
            {(() => {
              const recs: string[] = [];
              for (const p of reportProposals.filter((x) => x.status === 'Approved' && x.validationResult?.status === 'Passed' && x.statusLabel !== 'Promoted')) recs.push(`Promote validated adapter ${p.id.slice(0, 8)} for ${p.apiName} to the gateway.`);
              for (const p of reportProposals.filter((x) => x.status === 'Pending')) recs.push(`Review pending proposal ${p.id.slice(0, 8)} for ${p.apiName}${p.requiresManualReview ? ' (manual review required)' : ''}.`);
              for (const i of reportIncidents.filter((x) => x.status !== 'Resolved')) recs.push(`Confirm the ${i.issueType?.toLowerCase() ?? 'change'} on ${i.apiName} with the provider${i.diffs?.length ? ` (${i.diffs.map((d) => d.fieldName).slice(0, 3).join(', ')})` : ''}.`);
              for (const a of reportApis.filter((x) => !x.baselineApproved)) recs.push(`Approve a baseline for ${a.name} so drift detection can start.`);
              const unmapped = reportApis.filter((a) => !reportIncidents.some((i) => i.apiName === a.name && (i.registeredMappings?.length ?? 0) > 0));
              if (unmapped.length && reportIncidents.length) recs.push('Register feature-to-field mappings for APIs without them to trace impact automatically.');
              if (recs.length === 0) recs.push('No action required: all monitored APIs match their baselines and no proposals are pending.');
              return recs.slice(0, 6).map((r, i) => <p key={i}>{i + 1}. {r}</p>);
            })()}
          </div>
        </div>

        {/* Report Metadata Footer */}
        <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>Confidential — Prepared for {organization || 'your organization'}</span>
          <span className="font-mono">Content hash: {contentHash}</span>
        </div>
      </div>
    </div>
  );
};
