import React, { useState, useRef, useEffect } from 'react';
import { LayoutGrid, RefreshCw, Download, Upload, ChevronDown, Check } from 'lucide-react';

interface SubheaderActionsProps {
  onCustomizeWidget: () => void;
  onRefresh: () => void;
  onExport: (format: 'csv' | 'json' | 'pdf') => void;
  onImport: () => void;
  lastUpdatedText: string;
  isRefreshing: boolean;
}

export const SubheaderActions: React.FC<SubheaderActionsProps> = ({
  onCustomizeWidget,
  onRefresh,
  onExport,
  onImport,
  lastUpdatedText,
  isRefreshing,
}) => {
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const importRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (importRef.current && !importRef.current.contains(event.target as Node)) {
        setImportMenuOpen(false);
      }
      if (exportRef.current && !exportRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-4">
      {/* Left: Customize Widget Button */}
      <div>
        <button
          onClick={onCustomizeWidget}
          className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors shadow-xs"
        >
          <LayoutGrid className="w-4 h-4 text-slate-600" />
          <span>Customize Widget</span>
        </button>
      </div>

      {/* Right: Last update + Import + Export */}
      <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
        {/* Refresh status */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-2 text-xs sm:text-sm text-slate-500 hover:text-slate-800 transition-colors py-1.5 px-2 rounded-lg hover:bg-slate-100/70"
          title="Click to refresh telemetry"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isRefreshing ? 'animate-spin text-blue-600' : ''}`} />
          <span>{lastUpdatedText}</span>
        </button>

        {/* Import Dropdown */}
        <div className="relative" ref={importRef}>
          <button
            onClick={() => setImportMenuOpen(!importMenuOpen)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>Import</span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
          </button>

          {importMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-48 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1.5 z-40">
              <button
                onClick={() => {
                  setImportMenuOpen(false);
                  onImport();
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between"
              >
                <span>Upload CSV Dataset</span>
                <span className="text-[10px] text-slate-400 font-mono">.csv</span>
              </button>
              <button
                onClick={() => {
                  setImportMenuOpen(false);
                  onImport();
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between"
              >
                <span>Import JSON Config</span>
                <span className="text-[10px] text-slate-400 font-mono">.json</span>
              </button>
              <button
                onClick={() => {
                  setImportMenuOpen(false);
                  onImport();
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between"
              >
                <span>Prometheus Targets</span>
                <span className="text-[10px] text-slate-400 font-mono">.yaml</span>
              </button>
            </div>
          )}
        </div>

        {/* Export Button (Solid blue with dropdown) */}
        <div className="relative" ref={exportRef}>
          <button
            onClick={() => setExportMenuOpen(!exportMenuOpen)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-xs shadow-blue-500/25"
          >
            <Upload className="w-3.5 h-3.5 text-blue-100" />
            <span>Export</span>
            <div className="h-4 w-px bg-blue-500/80 mx-1" />
            <ChevronDown className="w-3.5 h-3.5 text-blue-200" />
          </button>

          {exportMenuOpen && (
            <div className="absolute right-0 mt-1.5 w-48 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1.5 z-40">
              <button
                onClick={() => {
                  setExportMenuOpen(false);
                  onExport('csv');
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between"
              >
                <span>Export as CSV</span>
                <span className="text-[10px] text-slate-400 font-mono">.csv</span>
              </button>
              <button
                onClick={() => {
                  setExportMenuOpen(false);
                  onExport('json');
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between"
              >
                <span>Export as JSON</span>
                <span className="text-[10px] text-slate-400 font-mono">.json</span>
              </button>
              <button
                onClick={() => {
                  setExportMenuOpen(false);
                  onExport('pdf');
                }}
                className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center justify-between"
              >
                <span>Generate PDF Report</span>
                <span className="text-[10px] text-slate-400 font-mono">.pdf</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
