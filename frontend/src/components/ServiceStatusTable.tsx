import React, { useState, useMemo } from 'react';
import { 
  Info, 
  Search, 
  Download, 
  ExternalLink, 
  ArrowUpDown, 
  Plus, 
  CheckCircle2, 
  AlertCircle,
  X
} from 'lucide-react';
import { ServiceItem } from '../types';

interface ServiceStatusTableProps {
  services: ServiceItem[];
  onSelectService: (service: ServiceItem) => void;
  onAddNewService: () => void;
}

export const ServiceStatusTable: React.FC<ServiceStatusTableProps> = ({
  services,
  onSelectService,
  onAddNewService,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<keyof ServiceItem>('uptimeNumeric');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);

  // Filter & Sort
  const filteredServices = useMemo(() => {
    return services
      .filter((s) => {
        const query = searchQuery.toLowerCase();
        return (
          s.name.toLowerCase().includes(query) ||
          s.url.toLowerCase().includes(query) ||
          s.status.toLowerCase().includes(query)
        );
      })
      .sort((a, b) => {
        let valA = a[sortField];
        let valB = b[sortField];
        if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - valA;
        }
        return 0;
      });
  }, [services, searchQuery, sortField, sortDirection]);

  const handleSort = (field: keyof ServiceItem) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Download CSV Handler
  const handleDownloadCSV = () => {
    const headers = ['Status', 'Service', 'URL', 'Uptime', 'Response', 'Category', 'SSL'];
    const rows = filteredServices.map((s) => [
      s.status,
      `"${s.name}"`,
      `"${s.url}"`,
      `"${s.uptime}"`,
      `"${s.response}"`,
      `"${s.category}"`,
      `"${s.sslExpiresIn || 'N/A'}"`,
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `sitescope_service_status_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
      {/* Table Header Section */}
      <div className="p-5 sm:px-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100">
        {/* Left: Title + Info icon */}
        <div className="flex items-center gap-2 relative">
          <h2 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
            Service Status
          </h2>
          <div className="relative">
            <button
              onClick={() => setShowInfoTooltip(!showInfoTooltip)}
              onMouseEnter={() => setShowInfoTooltip(true)}
              onMouseLeave={() => setShowInfoTooltip(false)}
              className="text-slate-400 hover:text-slate-600 transition-colors p-0.5 rounded-full"
              aria-label="Info about Service Status"
            >
              <Info className="w-4 h-4" />
            </button>
            {showInfoTooltip && (
              <div className="absolute left-6 top-1/2 -translate-y-1/2 w-64 bg-slate-900 text-white text-xs p-2.5 rounded-xl shadow-xl z-30 pointer-events-none">
                Real-time heartbeat polling from 14 global regions. Latency measured over 60-second sliding windows.
              </div>
            )}
          </div>
        </div>

        {/* Right: Search + Download Data + Add Monitor */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search box inside table */}
          <div className="relative w-44 sm:w-56">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search"
              className="w-full pl-8 pr-7 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Download Data Button matching inspiration image */}
          <button
            onClick={handleDownloadCSV}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200/90 hover:bg-slate-50 text-slate-700 rounded-xl text-xs sm:text-sm font-medium transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Download Data</span>
          </button>

          {/* Optional Add Service Monitor */}
          <button
            onClick={onAddNewService}
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-100/80 border border-blue-200/60 rounded-xl text-xs sm:text-sm font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Service</span>
          </button>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-100 text-xs font-semibold text-slate-400 bg-slate-50/50">
              <th 
                onClick={() => handleSort('status')}
                className="py-3 px-6 cursor-pointer hover:text-slate-700 transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>Status</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th 
                onClick={() => handleSort('name')}
                className="py-3 px-6 cursor-pointer hover:text-slate-700 transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>Service</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th className="py-3 px-6">
                URL
              </th>
              <th 
                onClick={() => handleSort('uptimeNumeric')}
                className="py-3 px-6 cursor-pointer hover:text-slate-700 transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>Uptime</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
              <th 
                onClick={() => handleSort('responseNumeric')}
                className="py-3 px-6 cursor-pointer hover:text-slate-700 transition-colors"
              >
                <div className="flex items-center gap-1">
                  <span>Response</span>
                  <ArrowUpDown className="w-3 h-3 opacity-60" />
                </div>
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
            {filteredServices.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-400 text-sm">
                  No services found matching "{searchQuery}".
                </td>
              </tr>
            ) : (
              filteredServices.map((service) => {
                const isDegraded = service.status === 'Degraded';
                const isDown = service.status === 'Down';
                const isUp = service.status === 'Up';

                return (
                  <tr
                    key={service.id}
                    onClick={() => onSelectService(service)}
                    className="hover:bg-slate-50/80 transition-colors cursor-pointer group"
                  >
                    {/* Status Column */}
                    <td className="py-3.5 px-6 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {isUp && (
                          <>
                            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-xs shadow-emerald-400/50" />
                            <span className="font-medium text-slate-800">Up</span>
                          </>
                        )}
                        {isDegraded && (
                          <>
                            <span className="w-2 h-2 rounded-full bg-amber-500 shadow-xs shadow-amber-400/50" />
                            <span className="font-medium text-amber-600">Degraded</span>
                          </>
                        )}
                        {isDown && (
                          <>
                            <span className="w-2 h-2 rounded-full bg-rose-500 shadow-xs shadow-rose-400/50" />
                            <span className="font-medium text-rose-600">Down</span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Service Column */}
                    <td className="py-3.5 px-6 whitespace-nowrap font-medium text-slate-900 group-hover:text-blue-600 transition-colors">
                      {service.name}
                    </td>

                    {/* URL Column */}
                    <td className="py-3.5 px-6 whitespace-nowrap font-normal text-slate-400 group-hover:text-slate-600 transition-colors">
                      <div className="flex items-center gap-1.5 font-mono text-xs">
                        <span>{service.url}</span>
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 text-blue-500 transition-opacity" />
                      </div>
                    </td>

                    {/* Uptime Column */}
                    <td className="py-3.5 px-6 whitespace-nowrap font-medium font-mono tabular-nums">
                      <span className={isDegraded ? 'text-amber-500' : 'text-slate-700'}>
                        {service.uptime}
                      </span>
                    </td>

                    {/* Response Column */}
                    <td className="py-3.5 px-6 whitespace-nowrap font-medium font-mono tabular-nums">
                      <span className={isDegraded ? 'text-rose-500 font-semibold' : 'text-slate-700'}>
                        {service.response}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
