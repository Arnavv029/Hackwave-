import React, { useState } from 'react';
import { 
  AlertTriangle, 
  ExternalLink, 
  Layers, 
  ShieldAlert, 
  Monitor, 
  Cpu, 
  Activity, 
  CheckCircle2, 
  RefreshCw,
  Eye,
  Info
} from 'lucide-react';
import { AffectedComponent } from '../../types';

interface AffectedComponentsViewProps {
  components: AffectedComponent[];
  incidentTitle: string;
}

export const AffectedComponentsView: React.FC<AffectedComponentsViewProps> = ({
  components,
  incidentTitle,
}) => {
  const [selectedComp, setSelectedComp] = useState<AffectedComponent | null>(null);
  const [testedId, setTestedId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const handleTestProbe = (comp: AffectedComponent) => {
    setTestingId(comp.id);
    setTimeout(() => {
      setTestingId(null);
      setTestedId(comp.id);
      setTimeout(() => setTestedId(null), 3500);
    }, 800);
  };

  const criticalCount = components.filter((c) => c.impactLevel === 'Critical' || c.impactLevel === 'Broken').length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Affected Components & Blast Radius
            </h3>
            <p className="text-xs text-slate-500">
              Downstream UI pages, views, and authentication gateways degraded by this incident.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-600 border border-rose-200">
            {criticalCount} Critical Outages
          </span>
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            {components.length} Total Targets
          </span>
        </div>
      </div>

      {/* Grid of Affected Components */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {components.map((comp) => {
          const isCritical = comp.impactLevel === 'Critical' || comp.impactLevel === 'Broken';
          const isTesting = testingId === comp.id;
          const isTested = testedId === comp.id;

          return (
            <div
              key={comp.id}
              onClick={() => setSelectedComp(comp)}
              className={`
                p-4 rounded-xl border transition-all cursor-pointer relative group flex flex-col justify-between
                ${isCritical 
                  ? 'bg-rose-50/30 border-rose-200 hover:border-rose-300 hover:bg-rose-50/50' 
                  : 'bg-amber-50/20 border-amber-200 hover:border-amber-300 hover:bg-amber-50/40'
                }
              `}
            >
              <div>
                {/* Top Row: Type + Status Badge */}
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500">
                    {comp.type === 'Page' ? <Monitor className="w-3.5 h-3.5 text-blue-500" /> : <Layers className="w-3.5 h-3.5 text-purple-500" />}
                    <span>{comp.type}</span>
                    {comp.route && (
                      <span className="text-slate-400 truncate max-w-[110px]">
                        ({comp.route})
                      </span>
                    )}
                  </div>

                  <span className={`
                    px-2 py-0.5 rounded-full text-[10px] font-bold tracking-tight uppercase
                    ${isCritical ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'}
                  `}>
                    {comp.statusBadge}
                  </span>
                </div>

                {/* Name */}
                <h4 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                  {comp.name}
                </h4>

                {/* Description */}
                <p className="text-xs text-slate-500 mt-1 leading-snug">
                  {comp.description}
                </p>

                {/* User Symptom Warning Callout */}
                <div className="mt-3 p-2.5 rounded-lg bg-white/80 border border-slate-200/80 text-[11px] text-slate-700">
                  <span className="font-semibold text-rose-600 block mb-0.5">Symptom:</span>
                  <span className="line-clamp-2">{comp.userFacingSymptom}</span>
                </div>
              </div>

              {/* Bottom Metrics & Probe Trigger */}
              <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs">
                <div className="text-slate-500">
                  Impact: <strong className="text-rose-600 font-mono">{comp.affectedUsersPercentage}</strong> users
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTestProbe(comp);
                  }}
                  disabled={isTesting}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-medium text-slate-700 shadow-2xs transition-colors"
                >
                  <RefreshCw className={`w-3 h-3 text-slate-400 ${isTesting ? 'animate-spin text-blue-600' : ''}`} />
                  <span>{isTesting ? 'Probing...' : isTested ? '504 Timeout' : 'Test Endpoint'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Component Detail Drawer / Modal */}
      {selectedComp && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in"
          onClick={() => setSelectedComp(null)}
        >
          <div 
            className="bg-white rounded-3xl max-w-lg w-full p-6 border border-slate-200/90 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-mono text-blue-600 uppercase font-semibold">
                  Affected {selectedComp.type}
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-0.5">{selectedComp.name}</h3>
                {selectedComp.route && (
                  <p className="text-xs text-slate-400 font-mono mt-0.5">{selectedComp.route}</p>
                )}
              </div>
              <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-600 border border-rose-200">
                {selectedComp.impactLevel}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl space-y-1">
                <span className="text-slate-400 font-medium">Customer Facing Behavior:</span>
                <p className="text-slate-800 font-medium">{selectedComp.userFacingSymptom}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider">User Base Impact</span>
                  <div className="text-base font-bold font-mono text-rose-600 mt-0.5">{selectedComp.affectedUsersPercentage}</div>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl">
                  <span className="text-slate-400 text-[10px] uppercase tracking-wider">Fallback Mechanism</span>
                  <div className="text-xs font-semibold text-amber-600 mt-1">Maintenance Banner</div>
                </div>
              </div>

              <div className="p-3 bg-blue-50/50 rounded-xl border border-blue-100">
                <span className="text-blue-700 font-semibold block mb-1">Incident Root Cause Correlation:</span>
                <p className="text-slate-700 leading-relaxed">
                  Direct dependency on upstream <strong>auth-service</strong> API. Because upstream response times exceeded 30,000ms, the reverse proxy terminated connections with HTTP 504.
                </p>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setSelectedComp(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-semibold"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
