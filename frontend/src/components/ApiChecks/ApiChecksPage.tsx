import React, { useState, useMemo } from 'react';
import { 
  Code2, 
  Plus, 
  Search, 
  Filter, 
  ChevronDown, 
  AlertTriangle, 
  CheckCircle2, 
  Pause, 
  XCircle, 
  ArrowUpDown, 
  ArrowUp, 
  X,
  Target
} from 'lucide-react';
import { ApiCheckItem, ApiCheckStatus, HttpMethod } from '../../types';
import { ApiCheckDetailModal } from './ApiCheckDetailModal';
import { NewApiCheckModal } from './NewApiCheckModal';

interface ApiChecksPageProps {
  apiChecks: ApiCheckItem[];
  onAddNewCheck: (check: ApiCheckItem) => void;
  onTogglePause: (id: string) => void;
}

export const ApiChecksPage: React.FC<ApiChecksPageProps> = ({
  apiChecks,
  onAddNewCheck,
  onTogglePause,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('All Status');
  const [selectedMethod, setSelectedMethod] = useState<string>('All Methods');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [methodDropdownOpen, setMethodDropdownOpen] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<'name' | 'successRate' | 'avgLatency'>('name');
  const [sortAsc, setSortAsc] = useState(true);

  // Modals
  const [selectedCheck, setSelectedCheck] = useState<ApiCheckItem | null>(null);
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);

  // Computed KPIs
  const totalChecks = apiChecks.length;
  const healthyCount = apiChecks.filter((c) => c.status === 'Healthy').length;
  const degradedCount = apiChecks.filter((c) => c.status === 'Degraded').length;
  const failingCount = apiChecks.filter((c) => c.status === 'Failing').length;

  // Average success rate of active items
  const activeWithSuccess = apiChecks.filter((c) => c.successRateNumeric !== null);
  const avgSuccessRate = activeWithSuccess.length > 0
    ? (
        activeWithSuccess.reduce((acc, c) => acc + (c.successRateNumeric || 0), 0) /
        activeWithSuccess.length
      ).toFixed(1)
    : '0.0';

  // Filtered & Sorted Checks
  const filteredChecks = useMemo(() => {
    return apiChecks
      .filter((check) => {
        // Search filter
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          !q ||
          check.name.toLowerCase().includes(q) ||
          check.url.toLowerCase().includes(q);

        // Status filter
        const matchesStatus =
          selectedStatus === 'All Status' || check.status === selectedStatus;

        // Method filter
        const matchesMethod =
          selectedMethod === 'All Methods' || check.method === selectedMethod;

        return matchesSearch && matchesStatus && matchesMethod;
      })
      .sort((a, b) => {
        if (sortField === 'name') {
          return sortAsc
            ? a.name.localeCompare(b.name)
            : b.name.localeCompare(a.name);
        }
        if (sortField === 'successRate') {
          const valA = a.successRateNumeric ?? -1;
          const valB = b.successRateNumeric ?? -1;
          return sortAsc ? valA - valB : valB - valA;
        }
        if (sortField === 'avgLatency') {
          const valA = a.avgLatencyNumeric ?? 99999;
          const valB = b.avgLatencyNumeric ?? 99999;
          return sortAsc ? valA - valB : valB - valA;
        }
        return 0;
      });
  }, [apiChecks, searchQuery, selectedStatus, selectedMethod, sortField, sortAsc]);

  const handleSortToggle = (field: 'name' | 'successRate' | 'avgLatency') => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Top Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-blue-500 font-mono text-xl font-bold tracking-tighter select-none">
              &lt;&gt;
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              API Checks
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {totalChecks} endpoints · {healthyCount} healthy · {failingCount} failing
          </p>
        </div>

        {/* Action Button */}
        <div>
          <button
            onClick={() => setIsNewModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-[#0284c7] hover:bg-[#0369a1] text-white rounded-xl text-xs sm:text-sm font-semibold shadow-xs shadow-sky-600/20 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>New API Check</span>
          </button>
        </div>
      </div>

      {/* 5 KPI Cards Strip matching inspiration image */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* TOTAL CHECKS */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Total Checks
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-2">
            {totalChecks}
          </div>
        </div>

        {/* HEALTHY */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Healthy
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-600 mt-2">
            {healthyCount}
          </div>
        </div>

        {/* DEGRADED */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Degraded
          </div>
          <div className="text-2xl font-bold font-mono text-amber-500 mt-2">
            {degradedCount}
          </div>
        </div>

        {/* FAILING */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Failing
          </div>
          <div className="text-2xl font-bold font-mono text-rose-500 mt-2">
            {failingCount}
          </div>
        </div>

        {/* AVG SUCCESS */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
          <div className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            Avg Success
          </div>
          <div className="text-2xl font-bold font-mono text-amber-500 mt-2">
            {avgSuccessRate}%
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search endpoints..."
            className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-xs"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* All Status Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setStatusDropdownOpen(!statusDropdownOpen);
              setMethodDropdownOpen(false);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>{selectedStatus}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {statusDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-40 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1.5 z-30 animate-in fade-in duration-100">
              {['All Status', 'Healthy', 'Degraded', 'Failing', 'Paused'].map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setSelectedStatus(status);
                    setStatusDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedStatus === status
                      ? 'bg-blue-50 text-blue-600 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* All Methods Dropdown */}
        <div className="relative">
          <button
            onClick={() => {
              setMethodDropdownOpen(!methodDropdownOpen);
              setStatusDropdownOpen(false);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <span>{selectedMethod}</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {methodDropdownOpen && (
            <div className="absolute left-0 mt-1.5 w-36 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1.5 z-30 animate-in fade-in duration-100">
              {['All Methods', 'GET', 'POST', 'PUT', 'DELETE'].map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setSelectedMethod(m);
                    setMethodDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3.5 py-1.5 text-xs font-medium transition-colors ${
                    selectedMethod === m
                      ? 'bg-blue-50 text-blue-600 font-semibold'
                      : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* API Checks Table matching inspiration image */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 text-xs font-semibold text-slate-400 bg-slate-50/50">
                <th className="py-3.5 px-5 w-16">Status</th>
                <th className="py-3.5 px-4 w-20">Method</th>
                <th 
                  onClick={() => handleSortToggle('name')}
                  className="py-3.5 px-5 cursor-pointer hover:text-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>Endpoint</span>
                    <ArrowUp className={`w-3.5 h-3.5 transition-transform ${sortField === 'name' && !sortAsc ? 'rotate-180' : ''}`} />
                  </div>
                </th>
                <th className="py-3.5 px-4 w-56">24h Timeline</th>
                <th 
                  onClick={() => handleSortToggle('successRate')}
                  className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>Success</span>
                    <ArrowUpDown className="w-3 h-3 opacity-60" />
                  </div>
                </th>
                <th 
                  onClick={() => handleSortToggle('avgLatency')}
                  className="py-3.5 px-4 cursor-pointer hover:text-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <span>Avg Latency</span>
                    <ArrowUpDown className="w-3 h-3 opacity-60" />
                  </div>
                </th>
                <th className="py-3.5 px-5">Assertions</th>
                <th className="py-3.5 px-5">Last Check</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
              {filteredChecks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No API checks found matching your search and filter criteria.
                  </td>
                </tr>
              ) : (
                filteredChecks.map((check) => {
                  const isHealthy = check.status === 'Healthy';
                  const isDegraded = check.status === 'Degraded';
                  const isFailing = check.status === 'Failing';
                  const isPaused = check.status === 'Paused';

                  return (
                    <tr
                      key={check.id}
                      onClick={() => setSelectedCheck(check)}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                    >
                      {/* Status Icon Column */}
                      <td className="py-4 px-5 whitespace-nowrap">
                        {isDegraded && (
                          <AlertTriangle className="w-4 h-4 text-amber-500" />
                        )}
                        {isHealthy && (
                          <div className="w-4 h-4 rounded-full border-2 border-emerald-500 flex items-center justify-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          </div>
                        )}
                        {isPaused && (
                          <Pause className="w-4 h-4 text-slate-400" />
                        )}
                        {isFailing && (
                          <XCircle className="w-4 h-4 text-rose-500" />
                        )}
                      </td>

                      {/* Method Column */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold font-mono bg-sky-50 text-sky-600 border border-sky-200/80">
                          {check.method}
                        </span>
                      </td>

                      {/* Endpoint Column (Title + Subtitle) */}
                      <td className="py-4 px-5 whitespace-nowrap">
                        <div>
                          <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
                            {check.name}
                          </div>
                          <div className="font-mono text-xs text-slate-400 truncate max-w-[240px]">
                            {check.url}
                          </div>
                        </div>
                      </td>

                      {/* 24h Timeline Column (dense mini tick bars) */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <div 
                          className="flex items-center gap-[2px] p-1 bg-slate-50/60 rounded-lg max-w-[210px]"
                          title="24h Synthetic Check Timeline"
                        >
                          {check.timeline.map((bar, idx) => (
                            <span
                              key={idx}
                              className={`
                                w-[3px] h-3.5 rounded-[1px] shrink-0
                                ${bar === 'success' ? 'bg-emerald-500' : ''}
                                ${bar === 'warning' ? 'bg-amber-400' : ''}
                                ${bar === 'error' ? 'bg-rose-500' : ''}
                                ${bar === 'empty' ? 'bg-slate-200' : ''}
                              `}
                            />
                          ))}
                        </div>
                      </td>

                      {/* Success Column */}
                      <td className="py-4 px-4 whitespace-nowrap font-medium font-mono tabular-nums">
                        <span className={`
                          ${isHealthy ? 'text-emerald-600' : ''}
                          ${isDegraded ? 'text-slate-800' : ''}
                          ${isFailing ? 'text-rose-500 font-semibold' : ''}
                          ${isPaused ? 'text-slate-400' : ''}
                        `}>
                          {check.successRate}
                        </span>
                      </td>

                      {/* Avg Latency Column */}
                      <td className="py-4 px-4 whitespace-nowrap font-medium font-mono tabular-nums">
                        <span className={`
                          ${isDegraded ? 'text-amber-500 font-semibold' : ''}
                          ${isHealthy ? 'text-emerald-600' : ''}
                          ${isFailing || isPaused ? 'text-slate-400' : ''}
                        `}>
                          {check.avgLatency}
                        </span>
                      </td>

                      {/* Assertions Column */}
                      <td className="py-4 px-5 whitespace-nowrap font-medium font-mono text-xs">
                        <span className={`
                          ${check.assertionsPassed === check.assertionsTotal && check.assertionsTotal > 0 ? 'text-slate-500' : ''}
                          ${check.assertionsPassed < check.assertionsTotal && check.assertionsPassed > 0 ? 'text-amber-500' : ''}
                          ${check.assertionsPassed === 0 ? 'text-amber-500' : ''}
                        `}>
                          {check.assertionsPassed}/{check.assertionsTotal} passed
                        </span>
                      </td>

                      {/* Last Check Column */}
                      <td className="py-4 px-5 whitespace-nowrap text-xs text-slate-400">
                        {check.lastCheck}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Inspection Modal */}
      <ApiCheckDetailModal
        check={selectedCheck}
        onClose={() => setSelectedCheck(null)}
        onTogglePause={(id) => {
          onTogglePause(id);
          setSelectedCheck(null);
        }}
      />

      {/* New API Check Modal */}
      <NewApiCheckModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreate={onAddNewCheck}
      />
    </div>
  );
};
