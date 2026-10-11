import React, { useState } from 'react';
import { 
  ShieldCheck, 
  Play, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Code2, 
  FileCode, 
  Check, 
  X, 
  Clock, 
  ArrowRight, 
  RefreshCw,
  Terminal,
  Server,
  Layers,
  ChevronRight,
  Info
} from 'lucide-react';
import type { RecoveryProposal, RegisteredApi, ValidationResult } from '../../types';

interface RecoveryValidationPageProps {
  proposals: RecoveryProposal[];
  apis: RegisteredApi[];
  onSelectProposal: (id: string) => void;
  onApproveProposal: (id: string) => Promise<void>;
  onRejectProposal: (id: string) => Promise<void>;
  onRunValidationTest: (id: string) => Promise<ValidationResult | undefined>;
  onPromoteProposal: (id: string) => Promise<void>;
  onRollbackAdapter: (monitorId: string, reason: string) => Promise<void>;
  onNavigateSection: (section: 'Incidents' | 'Reports' | 'Audit Log' | 'Dashboard') => void;
  showToast: (msg: string, kind?: 'ok' | 'error') => void;
  selectedProposalId?: string;
}

export const RecoveryValidationPage: React.FC<RecoveryValidationPageProps> = ({
  proposals,
  apis,
  onSelectProposal,
  onApproveProposal,
  onRejectProposal,
  onRunValidationTest,
  onPromoteProposal,
  onRollbackAdapter,
  onNavigateSection,
  selectedProposalId,
}) => {
  const [localId, setLocalId] = useState<string | undefined>(undefined);
  // Only proposals that still need a decision are listed by default; finished ones stay behind a toggle.
  const [showFinished, setShowFinished] = useState(false);
  const isFinished = (p: RecoveryProposal) => ['Promoted', 'Rejected', 'Rolled Back'].includes(p.statusLabel ?? p.status);
  const visibleProposals = proposals.filter((p) => showFinished || !isFinished(p) || p.id === localId || p.id === selectedProposalId);
  const finishedCount = proposals.filter(isFinished).length;
  const activeId = localId ?? selectedProposalId ?? proposals.find((p) => p.status === 'Pending')?.id ?? proposals[0]?.id;
  const setActiveId = (id: string) => {
    setLocalId(id);
    onSelectProposal(id);
  };
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testExecutionLogs, setTestExecutionLogs] = useState<string[]>([]);

  const activeProposal = proposals.find((p) => p.id === activeId) || proposals[0];
  const activeApi = activeProposal ? apis.find((a) => a.name === activeProposal.apiName || a.incidentId === activeProposal.incidentId) : undefined;

  const handleRunTest = async () => {
    if (!activeProposal) return;
    setIsRunningTest(true);
    setTestExecutionLogs([`[INIT] Requesting sandbox validation for ${activeProposal.apiName} (${activeProposal.targetEnvironment})…`]);
    try {
      const result = await onRunValidationTest(activeProposal.id);
      setTestExecutionLogs(result?.logs?.length ? result.logs : ['[RESULT] Validation did not run.']);
    } finally {
      setIsRunningTest(false);
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!activeProposal) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Recovery & Validation</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Review proposed adapter fixes, approve changes, and test safely in staging before edge deployment.</p>
        </div>
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 text-slate-400 text-sm">
          No repair proposals yet. Proposals are drafted automatically when a monitored response drifts in a way a declarative adapter can repair.
          <div className="mt-4">
            <button onClick={() => onNavigateSection('Incidents')} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold">Open incidents</button>
          </div>
        </div>
      </div>
    );
  }

  const label = activeProposal.statusLabel ?? activeProposal.status;
  const isApproved = label === 'Approved';
  const isPromoted = label === 'Promoted';
  const isRejected = label === 'Rejected' || label === 'Rolled Back';
  const isPending = label === 'Pending';
  const validationPassed = activeProposal.validationResult?.status === 'Passed';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Recovery & Validation</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Review proposed adapter fixes, approve changes, and test safely in staging before edge deployment.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigateSection('Reports')}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs sm:text-sm font-semibold transition-colors"
          >
            View Reliability Report
          </button>
        </div>
      </div>

      {/* 5-Step Approval Workflow Progress Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-4">Controlled Safe Lifecycle</h4>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
          {[
            { step: '1', title: 'Proposal Created', desc: 'Adapter formulated', done: true },
            { step: '2', title: 'Developer Review', desc: 'Check risks & assumptions', done: true },
            { step: '3', title: 'Approval Decision', desc: isApproved || isPromoted ? `Approved by ${activeProposal.approver ?? 'operator'}` : isRejected ? label : 'Awaiting sign-off', done: isApproved || isPromoted || isRejected, current: isPending },
            { step: '4', title: 'Run in Sandbox', desc: activeProposal.validationResult ? `${activeProposal.validationResult.runId} · ${activeProposal.validationResult.latencyMs}ms` : `${activeProposal.targetEnvironment} environment`, done: !!activeProposal.validationResult, current: !activeProposal.validationResult && !isRejected },
            { step: '5', title: isPromoted ? 'Promoted to gateway' : 'Validate Result', desc: isPromoted ? `by ${activeProposal.promotedBy ?? 'operator'}` : activeProposal.validationResult ? `${activeProposal.validationResult.assertions.filter((a) => a.passed).length}/${activeProposal.validationResult.assertions.length} checks passing` : 'Pending validation', done: isPromoted || validationPassed, current: isApproved && validationPassed && !isPromoted }
          ].map((item, idx) => (
            <div 
              key={idx}
              className={`p-3 rounded-xl border text-xs transition-all ${
                item.done 
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900' 
                  : item.current 
                    ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/20 text-blue-900 font-semibold' 
                    : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[10px] font-bold">STEP 0{item.step}</span>
                {item.done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
              </div>
              <p className="font-bold text-xs">{item.title}</p>
              <p className="text-[11px] opacity-80 mt-0.5">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Main Grid: Proposal Details + Live Validation Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Proposals Selector & Active Proposal Meta */}
        <div className="lg:col-span-5 space-y-5">
          {/* Proposal List */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Proposals ({visibleProposals.length}{!showFinished && finishedCount ? ` of ${proposals.length}` : ''})</h3>
              {finishedCount > 0 && (
                <button type="button" onClick={() => setShowFinished((v) => !v)} className="text-[11px] font-semibold text-blue-600 hover:text-blue-700">
                  {showFinished ? 'Hide finished' : `Show ${finishedCount} finished`}
                </button>
              )}
            </div>
            {visibleProposals.length === 0 && <p className="text-xs text-slate-400 py-6 text-center">No proposals waiting for a decision.</p>}
            {visibleProposals.map((prop) => (
              <div
                key={prop.id}
                onClick={() => setActiveId(prop.id)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  prop.id === activeProposal.id
                    ? 'bg-blue-50/80 border-blue-300 shadow-xs ring-1 ring-blue-500/20'
                    : 'bg-white hover:bg-slate-50 border-slate-200/80'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono font-bold text-xs text-blue-700">{prop.id.slice(0, 8)}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    prop.statusLabel === 'Promoted' ? 'bg-blue-100 text-blue-800'
                      : prop.status === 'Approved' 
                      ? 'bg-emerald-100 text-emerald-800' 
                      : prop.status === 'Rejected'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800'
                  }`}>
                    {prop.statusLabel ?? prop.status}{prop.isActive ? ' · active' : ''}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-slate-900 line-clamp-1">{prop.apiName}</h4>
                <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{prop.proposedSolution}</p>
              </div>
            ))}
          </div>

          {/* Assumptions & Risks */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
            <div>
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                Underlying Assumptions
              </h4>
              {activeProposal.requiresManualReview && (
                <p className="mb-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Manual review required: the engine could not derive a safe automatic mapping for every change.
                </p>
              )}
              <ul className="space-y-1.5 text-xs text-slate-600">
                {activeProposal.assumptions.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 bg-slate-50 p-2 rounded-lg border border-slate-100">
                    <span className="text-blue-500 font-bold">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-2 border-t border-slate-100">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                Identified Edge Risks
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {activeProposal.risks.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2 bg-amber-50/50 p-2 rounded-lg border border-amber-200/60">
                    <span className="text-amber-500 font-bold">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Approval Decision Controls */}
            <div className="pt-3 border-t border-slate-100 flex items-center gap-3">
              <button
                onClick={() => { if (window.confirm('Approve this adapter proposal? Your name is recorded as the approver.')) void run(() => onApproveProposal(activeProposal.id)); }}
                disabled={!isPending || busy}
                className="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-100 disabled:text-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{isApproved || isPromoted ? `Approved by ${activeProposal.approver ?? 'operator'}` : isRejected ? label : 'Approve Fix'}</span>
              </button>

              <button
                onClick={() => { if (window.confirm('Reject this proposal?')) void run(() => onRejectProposal(activeProposal.id)); }}
                disabled={isRejected || isPromoted || busy}
                className="py-2 px-4 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors"
              >
                Reject
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Adapter Code + Live Validation Test Sandbox */}
        <div className="lg:col-span-7 space-y-5">
          {/* Adapter Code Box */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <FileCode className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Predefined Controlled Transformation Adapter</h3>
              </div>
              <span className="text-[11px] font-mono text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                Safe Runtime (No AI Eval)
              </span>
            </div>

            <p className="text-xs text-slate-600 mb-3 leading-relaxed">
              {activeProposal.proposedSolution}
            </p>

            <div className="rounded-xl bg-slate-950 p-4 border border-slate-800 text-xs font-mono text-slate-200 overflow-x-auto">
              <pre className="leading-relaxed">
                {activeProposal.adapterTransformation}
              </pre>
            </div>
          </div>

          {/* Validation Test Runner & Results */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-emerald-600" />
                  Staging Contract Validation Test
                </h3>
                <p className="text-xs text-slate-500">
                  Runs target feature render workflow in isolated staging sandbox.
                </p>
              </div>

              <button
                onClick={() => void handleRunTest()}
                disabled={isRunningTest || isRejected}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-all disabled:opacity-60 shrink-0"
              >
                {isRunningTest ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5 fill-white" />
                )}
                <span>{isRunningTest ? 'Executing Suite...' : 'Run Validation Test'}</span>
              </button>
            </div>

            {/* Test Run Output / Console */}
            {testExecutionLogs.length > 0 && (
              <div className="mb-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] font-mono text-emerald-400 space-y-1">
                {testExecutionLogs.map((log, index) => (
                  <div key={index} className="leading-relaxed">{log}</div>
                ))}
              </div>
            )}

            {/* Validation Results Breakdown */}
            {activeProposal.validationResult && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className={`flex items-center justify-between p-3.5 rounded-xl border text-xs ${validationPassed ? 'bg-emerald-50/70 border-emerald-200' : 'bg-rose-50/70 border-rose-200'}`}>
                  <div className="flex items-center gap-2.5">
                    {validationPassed ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" /> : <XCircle className="w-5 h-5 text-rose-600 shrink-0" />}
                    <div>
                      <h4 className="font-bold text-emerald-950">{activeProposal.validationResult.testName}</h4>
                      <p className="text-[11px] text-emerald-700">Target: {activeProposal.validationResult.targetWorkflow}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`px-2.5 py-0.5 rounded-full text-white font-bold text-[11px] ${validationPassed ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                      {activeProposal.validationResult.status}
                    </span>
                    <p className="font-mono text-[10px] text-emerald-800 mt-1">{activeProposal.validationResult.latencyMs}ms execution</p>
                  </div>
                </div>

                {/* Assertions Table */}
                <div className="space-y-1.5">
                  {activeProposal.validationResult.assertions.map((assertion, idx) => (
                    <div key={idx} className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between text-xs gap-3">
                      <div className="flex items-center gap-2">
                        {assertion.passed ? <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" /> : <X className="w-3.5 h-3.5 text-rose-600 shrink-0" />}
                        <span className="font-medium text-slate-800">{assertion.rule}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-600 flex items-center gap-2 text-right">
                        <span>Expected: {assertion.expected}</span>
                        <span className="text-slate-300">|</span>
                        <span className={`font-bold ${assertion.passed ? 'text-emerald-700' : 'text-rose-700'}`}>Actual: {assertion.actual}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Promotion Action */}
                <div className="pt-3 flex items-center justify-between text-xs text-slate-500 gap-3 flex-wrap">
                  <span>Run <span className="font-mono font-semibold text-slate-700">{activeProposal.validationResult.runId}</span> at {activeProposal.validationResult.testTime} · recorded in the audit log</span>
                  {isPromoted ? (
                    <button
                      onClick={() => { const reason = window.prompt('Reason for rolling the adapter back (recorded in the audit log):'); if (reason && activeApi) void run(() => onRollbackAdapter(activeApi.id, reason)); }}
                      disabled={busy || !activeApi}
                      className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-60"
                    >
                      <span>Roll back adapter</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => { if (window.confirm(`Promote this adapter for ${activeProposal.apiName}? Live responses will be normalised before reaching consumers.`)) void run(() => onPromoteProposal(activeProposal.id)); }}
                      disabled={busy || !isApproved || !validationPassed}
                      title={!isApproved ? 'Approve the proposal first' : !validationPassed ? 'Validation must pass first' : ''}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <span>Promote Adapter to Gateway</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
