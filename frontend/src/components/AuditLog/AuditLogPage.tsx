import React, { useState } from 'react';
import { 
  Activity, 
  Search, 
  Filter, 
  Download, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  User, 
  Shield, 
  ChevronRight, 
  X,
  FileCode,
  Calendar
} from 'lucide-react';
import { AuditLogItem } from '../../types';

interface AuditLogPageProps {
  logs: AuditLogItem[];
  showToast: (msg: string) => void;
}

export const AuditLogPage: React.FC<AuditLogPageProps> = ({ logs, showToast }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [actorFilter, setActorFilter] = useState('All');
  const [resultFilter, setResultFilter] = useState('All');
  const [selectedLog, setSelectedLog] = useState<AuditLogItem | null>(null);

  const filteredLogs = logs.filter((log) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch = !q || 
      log.action.toLowerCase().includes(q) || 
      log.target.toLowerCase().includes(q) || 
      log.actor.toLowerCase().includes(q) ||
      log.details.toLowerCase().includes(q);
    const matchesActor = actorFilter === 'All' || log.actorType === actorFilter;
    const matchesResult = resultFilter === 'All' || log.result === resultFilter;
    return matchesSearch && matchesActor && matchesResult;
  });

  const handleExportCsv = () => {
    const headers = ['ID', 'Timestamp', 'Actor', 'Action', 'Target', 'Result', 'Details'];
    const rows = filteredLogs.map((l) => [
      l.id,
      `"${l.timestamp}"`,
      `"${l.actor}"`,
      `"${l.action}"`,
      `"${l.target}"`,
      l.result,
      `"${l.details.replace(/"/g, '""')}"`
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `api-guardian-audit-log-${Date.now()}.csv`;
    a.click();
    showToast('Exported audit log dataset as CSV');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Audit Log</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Immutable trace of operator actions, baseline approvals, validation tests, and system events.
          </p>
        </div>

        <button
          onClick={handleExportCsv}
          className="px-4 py-2 bg-white border border-slate-200/90 hover:bg-slate-50 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 shadow-xs flex items-center gap-2 transition-colors self-start sm:self-auto"
        >
          <Download className="w-3.5 h-3.5 text-slate-500" />
          <span>Export Audit Records (CSV)</span>
        </button>
      </div>

      {/* Main Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        {/* Filter Controls */}
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by action, target, actor..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={actorFilter}
              onChange={(e) => setActorFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium"
            >
              <option value="All">All Actors</option>
              <option value="Developer">Developers</option>
              <option value="System">System Monitors</option>
              <option value="Security">Security Policy</option>
            </select>

            <select
              value={resultFilter}
              onChange={(e) => setResultFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-medium"
            >
              <option value="All">All Results</option>
              <option value="Success">Success</option>
              <option value="Failure">Failure</option>
            </select>
          </div>
        </div>

        {/* Audit Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/70 border-b border-slate-100 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Target Resource</th>
                <th className="py-3 px-4">Result</th>
                <th className="py-3 px-4">Details</th>
                <th className="py-3 px-4 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredLogs.map((log) => (
                <tr 
                  key={log.id} 
                  onClick={() => setSelectedLog(log)}
                  className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                    {log.timestamp}
                  </td>

                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{log.actor}</div>
                    <div className="text-[10px] text-slate-400">{log.actorType}</div>
                  </td>

                  <td className="py-3 px-4 font-semibold text-blue-700">
                    {log.action}
                  </td>

                  <td className="py-3 px-4 font-medium text-slate-800">
                    {log.target}
                  </td>

                  <td className="py-3 px-4">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                      log.result === 'Success' 
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                        : 'bg-rose-50 text-rose-700 border border-rose-200'
                    }`}>
                      {log.result === 'Success' ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <XCircle className="w-3 h-3 text-rose-600" />
                      )}
                      <span>{log.result}</span>
                    </span>
                  </td>

                  <td className="py-3 px-4 max-w-xs truncate text-slate-600">
                    {log.details}
                  </td>

                  <td className="py-3 px-4 text-right">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLog(log);
                      }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-semibold inline-flex items-center gap-0.5"
                    >
                      <span>JSON</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal / Drawer */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 relative">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xs text-blue-600">{selectedLog.id}</span>
                <h3 className="font-bold text-slate-900 text-sm">{selectedLog.action}</h3>
              </div>
              <button 
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10px]">Actor:</span>
                  <span className="font-semibold text-slate-800">{selectedLog.actor} ({selectedLog.actorType})</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Timestamp:</span>
                  <span className="font-mono text-slate-800">{selectedLog.timestamp}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Target Resource:</span>
                  <span className="font-semibold text-slate-800">{selectedLog.target}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Outcome:</span>
                  <span className="font-bold text-emerald-700">{selectedLog.result}</span>
                </div>
              </div>

              <div>
                <span className="text-slate-500 font-semibold block mb-1">Details:</span>
                <p className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-slate-700 leading-relaxed">
                  {selectedLog.details}
                </p>
              </div>

              {selectedLog.metadata && (
                <div>
                  <span className="text-slate-500 font-semibold block mb-1">Safe Metadata (Zero Token Leak):</span>
                  <pre className="p-3 rounded-xl bg-slate-950 text-emerald-400 font-mono text-[11px] overflow-x-auto leading-relaxed">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 text-right">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
