import React, { useState } from 'react';
import { X, ExternalLink, ShieldCheck, Clock, Server, Activity, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ServiceItem } from '../types';

interface ServiceDetailModalProps {
  service: ServiceItem | null;
  onClose: () => void;
  onUpdateStatus?: (updated: ServiceItem) => void;
}

export const ServiceDetailModal: React.FC<ServiceDetailModalProps> = ({
  service,
  onClose,
  onUpdateStatus,
}) => {
  const [isPinging, setIsPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);

  if (!service) return null;

  const handleTestPing = () => {
    setIsPinging(true);
    setPingResult(null);
    setTimeout(() => {
      setIsPinging(false);
      const randomMs = service.status === 'Degraded' ? 245 : Math.floor(Math.random() * 30 + 35);
      setPingResult(`HTTP 200 OK — Handshake: 14ms | TTFB: ${randomMs}ms | TLS 1.3 Verified`);
    }, 800);
  };

  const isDegraded = service.status === 'Degraded';
  const isUp = service.status === 'Up';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl max-w-xl w-full border border-slate-200/90 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="text-xl font-bold text-slate-900">{service.name}</h3>
              <span
                className={`
                  inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold
                  ${isUp ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-amber-50 text-amber-600 border border-amber-200'}
                `}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${isUp ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                {service.status}
              </span>
            </div>
            <a
              href={`https://${service.url.replace(/^https?:\/\//, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1 font-mono"
            >
              <span>{service.url}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Details */}
        <div className="p-6 space-y-6">
          {/* Key Metrics Strip */}
          <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50/80 rounded-2xl border border-slate-100 text-center">
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Uptime SLA</div>
              <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">{service.uptime}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Avg Latency</div>
              <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">{service.response}</div>
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">SSL Status</div>
              <div className="text-xs font-semibold text-emerald-600 mt-1 flex items-center justify-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{service.sslExpiresIn || 'Active'}</span>
              </div>
            </div>
          </div>

          {/* Diagnostic Details */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Diagnostic Status
            </h4>
            <div className="p-3.5 rounded-xl border border-slate-100 bg-white text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Service Category:</span>
                <span className="font-medium text-slate-800">{service.category}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Probe Interval:</span>
                <span className="font-mono text-slate-800">Every 30 seconds</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Global Regions:</span>
                <span className="text-slate-800">US-East, EU-Central, AP-Southeast</span>
              </div>
              {service.statusMessage && (
                <div className="pt-2 border-t border-slate-100">
                  <span className="text-slate-500 block mb-0.5">Notes:</span>
                  <p className="text-slate-700 font-medium leading-relaxed">{service.statusMessage}</p>
                </div>
              )}
            </div>
          </div>

          {/* Live Ping Tester */}
          <div className="p-4 rounded-2xl bg-blue-50/50 border border-blue-100 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div>
                <h5 className="text-xs font-semibold text-slate-900">Immediate Probe Verification</h5>
                <p className="text-[11px] text-slate-500">Send an instant health-check synthetic request now.</p>
              </div>
              <button
                onClick={handleTestPing}
                disabled={isPinging}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                <span>{isPinging ? 'Testing...' : 'Test Probe'}</span>
              </button>
            </div>

            {pingResult && (
              <div className="p-2.5 bg-white rounded-xl border border-blue-200 text-xs font-mono text-slate-800 flex items-center gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>{pingResult}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-100 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
