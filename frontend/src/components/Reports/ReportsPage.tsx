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
import { RegisteredApi, Incident, RecoveryProposal } from '../../types';

interface ReportsPageProps {
  apis: RegisteredApi[];
  incidents: Incident[];
  proposals: RecoveryProposal[];
  showToast: (msg: string) => void;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  apis,
  incidents,
  proposals,
  showToast,
}) => {
  const [selectedApiScope, setSelectedApiScope] = useState<string>('All');
  const [selectedRange, setSelectedRange] = useState<string>('7d');
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string>('11 Oct 2026, 12:20 UTC');

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
            <p><span className="font-semibold text-slate-700">Document ID:</span> <span className="font-mono">RPT-2026-OCT-891</span></p>
          </div>
        </div>

        {/* 1. Executive Summary */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            1. Executive Summary
          </h3>
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs sm:text-sm text-slate-700 leading-relaxed">
            During the monitored period, API Guardian performed continuous synthetic probes across {reportApis.length} registered API endpoints. A total of {reportIncidents.length} schema and latency incidents were identified, including 1 high-severity contract rename on <strong className="text-slate-900">User Profile API</strong>. Downstream impact analysis successfully identified potentially degraded UI features prior to end-user complaints. A safe response adapter was generated, approved, and validated in staging sandbox tests with 100% assertions passed.
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
          <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-900">Proposal PROP-001 (User Profile API Response Transformation)</span>
              <span className="px-2 py-0.5 rounded font-bold text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                Validated in Staging
              </span>
            </div>
            <p className="text-slate-600">
              Target contract test <span className="font-mono text-slate-800 font-semibold">VAL-RUN-804</span> executed against mock downstream consumers. All 4 assertions confirmed compatible schema output with 14ms latency.
            </p>
          </div>
        </div>

        {/* 5. Evidence-Based Recommendations */}
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600" />
            5. Recommendations & Next Steps
          </h3>
          <div className="p-4 rounded-xl bg-blue-50/60 border border-blue-200/70 text-xs text-slate-800 space-y-2">
            <p>1. Deploy the staging adapter <strong className="text-blue-900">PROP-001</strong> to Edge Gateway to protect frontend applications.</p>
            <p>2. Notify third-party provider regarding breaking deprecation of the <code className="font-mono bg-white px-1 py-0.5 rounded border border-blue-200 text-blue-700">name</code> field.</p>
            <p>3. Update internal client models to gracefully fall back between <code className="font-mono">name</code> and <code className="font-mono">display_name</code>.</p>
          </div>
        </div>

        {/* Report Metadata Footer */}
        <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-slate-400">
          <span>Confidential — Prepared exclusively for Apex Cloud Systems</span>
          <span className="font-mono">Hash: sha256:49f2b80a18c947238</span>
        </div>
      </div>
    </div>
  );
};
