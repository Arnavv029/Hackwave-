import React, { useState } from 'react';
import { 
  X, 
  Play, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Clock, 
  ExternalLink, 
  RefreshCw,
  Code,
  Check,
  Pause
} from 'lucide-react';
import { ApiCheckItem } from '../../types';

interface ApiCheckDetailModalProps {
  check: ApiCheckItem | null;
  onClose: () => void;
  onTogglePause?: (id: string) => void;
}

export const ApiCheckDetailModal: React.FC<ApiCheckDetailModalProps> = ({
  check,
  onClose,
  onTogglePause,
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<{
    status: number;
    latency: number;
    timestamp: string;
    body: string;
  } | null>(null);

  if (!check) return null;

  const handleRunImmediate = () => {
    setIsRunning(true);
    setRunResult(null);
    setTimeout(() => {
      setIsRunning(false);
      const isOk = check.status === 'Healthy';
      const status = isOk ? (check.expectedStatus || 200) : check.status === 'Degraded' ? 200 : 503;
      const latency = isOk ? Math.floor(Math.random() * 50 + 40) : check.status === 'Degraded' ? 840 : 1250;
      setRunResult({
        status,
        latency,
        timestamp: new Date().toLocaleTimeString(),
        body: JSON.stringify(
          isOk 
            ? { success: true, timestamp: Date.now(), data: { message: 'All assertions verified' } }
            : { error: 'Service latency warning', code: 'TIMEOUT_THRESHOLD' },
          null,
          2
        ),
      });
    }, 700);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200/90 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold font-mono bg-sky-50 text-sky-600 border border-sky-200">
                {check.method}
              </span>
              <h3 className="text-xl font-bold text-slate-900">{check.name}</h3>
              <span className={`
                inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
                ${check.status === 'Healthy' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : ''}
                ${check.status === 'Degraded' ? 'bg-amber-50 text-amber-600 border border-amber-200' : ''}
                ${check.status === 'Failing' ? 'bg-rose-50 text-rose-600 border border-rose-200' : ''}
                ${check.status === 'Paused' ? 'bg-slate-100 text-slate-600 border border-slate-200' : ''}
              `}>
                {check.status}
              </span>
            </div>
            <a 
              href={check.url} 
              target="_blank" 
              rel="noreferrer"
              className="text-xs text-slate-400 hover:text-blue-600 font-mono flex items-center gap-1 mt-1.5"
            >
              <span>{check.url}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRunImmediate}
              disabled={isRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors"
            >
              <Play className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : 'fill-white'}`} />
              <span>{isRunning ? 'Running...' : 'Run Check'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {/* Quick Metrics */}
          <div className="grid grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-center">
            <div>
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Success Rate</span>
              <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">{check.successRate}</div>
            </div>
            <div>
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Avg Latency</span>
              <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">{check.avgLatency}</div>
            </div>
            <div>
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Assertions</span>
              <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">{check.assertionsPassed}/{check.assertionsTotal}</div>
            </div>
            <div>
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Interval</span>
              <div className="text-sm font-semibold text-slate-700 mt-1">{check.interval || '1 min'}</div>
            </div>
          </div>

          {/* Real-time execution output */}
          {runResult && (
            <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-emerald-400 font-bold">STATUS {runResult.status}</span>
                <span className="text-slate-400">{runResult.latency}ms · {runResult.timestamp}</span>
              </div>
              <pre className="text-xs font-mono text-slate-300 bg-slate-950/60 p-3 rounded-xl overflow-x-auto">
                {runResult.body}
              </pre>
            </div>
          )}

          {/* 24h Timeline Visualization */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">24-Hour Timeline</h4>
              <span className="text-xs text-slate-500 font-mono">Last check: {check.lastCheck}</span>
            </div>
            <div className="p-3 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between gap-1 overflow-x-auto">
              {check.timeline.map((bar, i) => (
                <div
                  key={i}
                  className={`
                    w-2 h-7 rounded-[2px] transition-all
                    ${bar === 'success' ? 'bg-emerald-500 hover:bg-emerald-400' : ''}
                    ${bar === 'warning' ? 'bg-amber-500 hover:bg-amber-400' : ''}
                    ${bar === 'error' ? 'bg-rose-500 hover:bg-rose-400' : ''}
                    ${bar === 'empty' ? 'bg-slate-200' : ''}
                  `}
                  title={`Interval ${i + 1}: ${bar}`}
                />
              ))}
            </div>
          </div>

          {/* Assertions Checklist */}
          <div>
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              Configured Assertions
            </h4>
            <div className="space-y-2">
              {check.assertionsList && check.assertionsList.length > 0 ? (
                check.assertionsList.map((item, index) => (
                  <div
                    key={index}
                    className="p-3 rounded-xl border border-slate-100 bg-white flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      {item.passed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                      )}
                      <span className="text-slate-800 font-medium font-mono">{item.rule}</span>
                    </div>
                    <span className={`text-[11px] font-semibold ${item.passed ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {item.passed ? 'Passed' : 'Failed'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 italic">No custom assertions defined.</div>
              )}
            </div>
          </div>

          {/* Request Details */}
          {check.bodySnippet && (
            <div>
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Payload Template
              </h4>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 font-mono text-xs text-slate-700">
                {check.bodySnippet}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
          <button
            onClick={() => {
              if (onTogglePause) onTogglePause(check.id);
            }}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-200/60"
          >
            {check.status === 'Paused' ? 'Resume Monitoring' : 'Pause Monitor'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200/80 hover:bg-slate-300/80 text-slate-800 rounded-xl text-xs font-semibold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
