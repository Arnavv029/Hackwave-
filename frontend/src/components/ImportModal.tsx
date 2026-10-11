import React, { useState } from 'react';
import { X, Upload, FileText, Check, AlertCircle } from 'lucide-react';
import { ServiceItem } from '../types';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportServices: (services: ServiceItem[]) => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  isOpen,
  onClose,
  onImportServices,
}) => {
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const sampleJSON = JSON.stringify(
    [
      {
        name: 'Auth Gateway',
        url: 'auth.example.com',
        status: 'Up',
        uptime: '99.95%',
        response: '68ms',
        category: 'API'
      }
    ],
    null,
    2
  );

  const handleImport = () => {
    try {
      setError(null);
      const parsed = JSON.parse(jsonText || sampleJSON);
      if (!Array.isArray(parsed)) {
        throw new Error('Import data must be a JSON array of services.');
      }

      const formatted: ServiceItem[] = parsed.map((item, idx) => ({
        id: `srv-import-${Date.now()}-${idx}`,
        status: item.status || 'Up',
        name: item.name || `Service ${idx + 1}`,
        url: item.url || 'endpoint.example.com',
        uptime: item.uptime || '100%',
        response: item.response || '75ms',
        uptimeNumeric: parseFloat(item.uptime) || 100,
        responseNumeric: parseInt(item.response) || 75,
        category: item.category || 'Web',
        sslExpiresIn: '180 days',
        statusMessage: 'Imported configuration probe active'
      }));

      onImportServices(formatted);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || 'Invalid JSON format');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl max-w-lg w-full border border-slate-200/90 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Import Monitoring Targets</h3>
            <p className="text-xs text-slate-500 mt-0.5">Import endpoints from CSV, JSON, or Prometheus targets.</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Paste JSON Configuration
            </label>
            <textarea
              rows={6}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={sampleJSON}
              className="w-full p-3 font-mono text-xs bg-slate-50 border border-slate-200/90 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 text-xs flex items-center gap-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>Successfully imported services!</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setJsonText(sampleJSON)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Insert Sample Template
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs"
              >
                Import Now
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
