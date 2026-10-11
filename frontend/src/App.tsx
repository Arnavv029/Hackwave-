import React, { useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/Dashboard/DashboardView';
import { AddApiModal } from './components/Dashboard/AddApiModal';
import { IncidentImpactPage } from './components/Incidents/IncidentImpactPage';
import { RecoveryValidationPage } from './components/Recovery/RecoveryValidationPage';
import { ReportsPage } from './components/Reports/ReportsPage';
import { AuditLogPage } from './components/AuditLog/AuditLogPage';
import { SettingsPage } from './components/Settings/SettingsPage';
import { LandingPage } from './components/Public/LandingPage';
import { AuthModal } from './components/Public/AuthModal';
import { useGuardian } from './hooks/useGuardian';
import { guardian } from './api/guardian';
import { describeError } from './api/client';
import { clearSession } from './api/session';
import { toAuditLogItem, toIncident, toMonitoringSettings, toRecoveryProposal, toRegisteredApi, toUserProfile } from './api/mappers';
import type { CreateMonitorInput } from './api/types';
import type { Incident, MonitoringSettings, NavSection, PublicViewMode, UserProfile, ValidationResult } from './types';
import { CheckCircle2, AlertTriangle, RefreshCw, WifiOff } from 'lucide-react';

const INCIDENT_STATUS_CODE: Record<Incident['status'], 'OPEN' | 'INVESTIGATING' | 'AWAITING_FIX' | 'RESOLVED'> = {
  Open: 'OPEN',
  Investigating: 'INVESTIGATING',
  'Awaiting Fix': 'AWAITING_FIX',
  Resolved: 'RESOLVED',
  Identified: 'INVESTIGATING',
  Monitoring: 'INVESTIGATING',
};

export default function App() {
  const store = useGuardian();
  const [viewMode, setViewMode] = useState<PublicViewMode>('app');
  const [activeSection, setActiveSection] = useState<NavSection>('Dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [addApiModalOpen, setAddApiModalOpen] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState<string | undefined>(undefined);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | undefined>(undefined);
  const [globalSearch, setGlobalSearch] = useState('');
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'error' } | null>(null);

  const showToast = (msg: string, kind: 'ok' | 'error' = 'ok') => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), kind === 'error' ? 6000 : 3500);
  };
  const fail = (err: unknown) => {
    const text = describeError(err);
    showToast(text, 'error');
    if (text.includes('Sign in')) setAuthModalOpen(true);
  };

  // --- view models (pure mappings of backend data) --------------------------
  const apis = useMemo(() => store.monitors.map((m) => toRegisteredApi(m)), [store.monitors]);
  const incidents = useMemo(() => store.incidents.map(toIncident), [store.incidents]);
  const proposals = useMemo(() => store.proposals.map(toRecoveryProposal), [store.proposals]);
  const auditLogs = useMemo(() => store.audit.map(toAuditLogItem), [store.audit]);
  const settings: MonitoringSettings = useMemo(() => (store.settings ? toMonitoringSettings(store.settings.monitoring) : { defaultInterval: '5m', defaultTimeout: 5000, defaultEnvironment: 'Production', alertSlack: false, alertEmail: false, alertPagerDuty: false, ssrfProtection: true, autoBaseline: true }), [store.settings]);
  const userProfile: UserProfile = useMemo(() => {
    const p = store.settings ? toUserProfile(store.settings.profile) : { name: 'Operator', email: '', role: 'Operator', organization: '' };
    return store.session.actor ? { ...p, name: store.session.actor } : p;
  }, [store.settings, store.session.actor]);
  const metricCards = store.overview?.cards ?? [];
  const trafficData = store.overview?.traffic ?? [];
  const responseTimeData = store.overview?.responseTimes ?? [];

  const requireOperator = (): boolean => {
    if (store.canOperate) return true;
    showToast('Sign in with the backend operator token to make changes.', 'error');
    setAuthModalOpen(true);
    return false;
  };

  // --- handlers (every one is a real backend call) --------------------------
  const handleAddApi = async (input: CreateMonitorInput) => {
    if (!requireOperator()) return false;
    try {
      const m = await guardian.monitors.create({ ...input, createdBy: store.actor });
      showToast(`Registered ${m.name}: first check ${m.lastOutcome ?? 'pending'}${m.lastLatencyMs !== null ? ` in ${m.lastLatencyMs}ms` : ''}${m.baselineApproved ? ', baseline locked' : m.pendingBaseline ? ', baseline awaiting approval' : ''}`);
      await store.refresh();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };
  const handleProbeApi = async (apiId: string) => {
    if (!requireOperator()) return;
    try {
      const r = await guardian.monitors.check(apiId, store.actor);
      const diff = r.diff ? (r.diff.identical ? 'matches baseline' : r.diff.breaking ? `${r.diff.changes.filter((c) => c.changeType !== 'value_changed').length} breaking change(s)` : 'non-breaking changes') : r.baselineCreated ? `baseline v${r.baselineCreated.version} ${r.baselineCreated.status.toLowerCase()}` : 'no baseline yet';
      showToast(`Probed ${r.monitor.name}: ${r.check.outcome}${r.check.statusCode ? ` HTTP ${r.check.statusCode}` : ''} in ${r.check.latencyMs}ms · ${diff}`, r.check.outcome === 'SUCCESS' && !r.incidentId ? 'ok' : 'error');
      if (r.incidentId) setSelectedIncidentId(r.incidentId);
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleTogglePauseApi = async (apiId: string) => {
    if (!requireOperator()) return;
    const m = store.monitors.find((x) => x.id === apiId);
    if (!m) return;
    try {
      const next = m.status === 'PAUSED' ? await guardian.monitors.resume(apiId, store.actor) : await guardian.monitors.pause(apiId, store.actor);
      showToast(next.status === 'PAUSED' ? `Paused checks for ${next.name}` : `Resumed monitoring for ${next.name}`);
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleDeleteApi = async (apiId: string) => {
    if (!requireOperator()) return;
    try {
      await guardian.monitors.remove(apiId, store.actor);
      showToast('Monitor removed');
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleEditUrl = async (apiId: string, url: string) => {
    if (!requireOperator()) return;
    try {
      await guardian.monitors.update(apiId, { url, actor: store.actor });
      const r = await guardian.monitors.check(apiId, store.actor);
      showToast(`URL updated; check ${r.check.outcome}${r.check.statusCode ? ` HTTP ${r.check.statusCode}` : ''}${r.resolvedIncidents.length ? `, ${r.resolvedIncidents.length} incident(s) resolved` : ''}`, r.check.outcome === 'SUCCESS' ? 'ok' : 'error');
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleApproveBaseline = async (apiId: string, baselineId: string) => {
    if (!requireOperator()) return;
    try {
      await guardian.monitors.approveBaseline(apiId, baselineId, store.actor);
      showToast('Baseline approved as the golden schema reference');
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleChangeIncidentStatus = async (incidentId: string, status: Incident['status']) => {
    if (!requireOperator()) return;
    try {
      await guardian.incidents.update(incidentId, { status: INCIDENT_STATUS_CODE[status], actor: store.actor });
      showToast(`Updated incident status to ${status}`);
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleAddMapping = async (monitorId: string, feature: string, jsonPath: string, route?: string) => {
    if (!requireOperator()) return;
    try {
      await guardian.monitors.addMapping(monitorId, { feature, jsonPath, route, createdBy: store.actor });
      showToast(`Registered field mapping: ${feature} → ${jsonPath}`);
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleRequestProposal = async (incidentId: string) => {
    if (!requireOperator()) return;
    try {
      const p = await guardian.incidents.propose(incidentId, store.actor);
      setSelectedProposalId(p.id);
      showToast(p.requiresManualReview ? 'Proposal drafted: manual review required' : `Proposal drafted with ${p.transform.ops.length} operation(s)`);
      await store.refresh();
      setActiveSection('Recovery');
    } catch (err) {
      fail(err);
    }
  };
  const handleApproveProposal = async (proposalId: string) => {
    if (!requireOperator()) return;
    try {
      await guardian.proposals.approve(proposalId, store.actor);
      showToast(`Approved repair proposal ${proposalId.slice(0, 8)}`);
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleRejectProposal = async (proposalId: string) => {
    if (!requireOperator()) return;
    try {
      await guardian.proposals.reject(proposalId, store.actor);
      showToast(`Rejected repair proposal ${proposalId.slice(0, 8)}`);
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleRunValidationTest = async (proposalId: string): Promise<ValidationResult | undefined> => {
    if (!requireOperator()) return undefined;
    try {
      const p = await guardian.proposals.validate(proposalId, store.actor);
      await store.refresh();
      const v = toRecoveryProposal(p).validationResult;
      if (v) showToast(`Validation ${v.status}: ${v.assertions.filter((a) => a.passed).length}/${v.assertions.length} assertions passed`, v.status === 'Passed' ? 'ok' : 'error');
      return v;
    } catch (err) {
      fail(err);
      return undefined;
    }
  };
  const handlePromoteProposal = async (proposalId: string) => {
    if (!requireOperator()) return;
    try {
      const p = await guardian.proposals.promote(proposalId, store.actor);
      showToast(`Adapter promoted for ${p.apiName}; live responses are now normalised`);
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleRollbackAdapter = async (monitorId: string, reason: string) => {
    if (!requireOperator()) return;
    try {
      await guardian.monitors.rollbackAdapter(monitorId, store.actor, reason);
      showToast('Adapter rolled back; raw responses are compared again');
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleUpdateSettings = async (s: MonitoringSettings) => {
    if (!requireOperator()) return;
    try {
      await guardian.updateSettings({ monitoring: { defaultInterval: s.defaultInterval, defaultTimeout: s.defaultTimeout, defaultEnvironment: s.defaultEnvironment, alertSlack: s.alertSlack, alertEmail: s.alertEmail, alertPagerDuty: s.alertPagerDuty, ssrfProtection: s.ssrfProtection, autoBaseline: s.autoBaseline }, actor: store.actor });
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };
  const handleUpdateUser = async (u: UserProfile) => {
    if (!requireOperator()) return;
    try {
      await guardian.updateSettings({ profile: { name: u.name, email: u.email, role: u.role, organization: u.organization }, actor: store.actor });
      store.setSession({ ...store.session, actor: u.name });
      await store.refresh();
    } catch (err) {
      fail(err);
    }
  };

  const openIncidents = incidents.filter((i) => i.status !== 'Resolved');

  if (viewMode === 'landing') {
    return (
      <>
        <LandingPage onOpenLogin={() => setAuthModalOpen(true)} onOpenSignup={() => setAuthModalOpen(true)} onEnterApp={() => setViewMode('app')} />
        <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} session={store.session} onSignedIn={(s) => { store.setSession(s); setAuthModalOpen(false); setViewMode('app'); showToast(`Signed in as ${s.actor}`); }} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#f1f5f9] p-2 sm:p-5 lg:p-7 flex items-center justify-center font-sans antialiased">
      {toast && (
        <div className={`fixed top-6 right-6 z-[60] text-white text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2.5 animate-in slide-in-from-top-4 duration-200 border max-w-md ${toast.kind === 'error' ? 'bg-rose-900 border-rose-800' : 'bg-slate-900 border-slate-800'}`} role="status">
          {toast.kind === 'error' ? <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="w-full max-w-[1560px] bg-white rounded-3xl lg:rounded-[32px] border border-slate-200/90 shadow-xl shadow-slate-200/60 overflow-hidden flex min-h-[920px]">
        <Sidebar activeSection={activeSection} onSelectSection={setActiveSection} user={userProfile} mobileOpen={mobileMenuOpen} onCloseMobile={() => setMobileMenuOpen(false)} onViewPublicSite={() => setViewMode('landing')} incidentsCount={openIncidents.length} proposalsCount={proposals.filter((p) => p.status === 'Pending').length} />

        <div className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]/60">
          <Header
            activeSection={activeSection}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onViewPublicSite={() => setViewMode('landing')}
            onOpenAddApi={() => setAddApiModalOpen(true)}
            globalSearch={globalSearch}
            onSearchChange={setGlobalSearch}
            onNavigateSection={setActiveSection}
            incidents={incidents}
            proposals={proposals}
            live={store.live}
            canOperate={store.canOperate}
            actor={store.session.actor}
            onOpenAuth={() => setAuthModalOpen(true)}
          />

          {/* Connection / loading banners */}
          {store.error && (
            <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2"><WifiOff className="w-4 h-4" /> {store.error}</span>
              <button onClick={() => void store.refresh()} className="px-3 py-1.5 bg-white border border-rose-200 rounded-xl font-semibold flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Retry</button>
            </div>
          )}
          {!store.error && store.whoami && !store.canOperate && (
            <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 p-3 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3">
              <span>Read-only session. Sign in with the backend operator token to register APIs, approve baselines, and apply fixes.</span>
              <button onClick={() => setAuthModalOpen(true)} className="px-3 py-1.5 bg-amber-600 text-white rounded-xl font-semibold">Sign in</button>
            </div>
          )}

          <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
            {store.loading && !store.overview ? (
              <div className="h-64 flex items-center justify-center text-sm text-slate-500 gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Loading live data from the backend…</div>
            ) : (
              <>
                {activeSection === 'Dashboard' && (
                  <DashboardView
                    apis={apis.filter((a) => !globalSearch || `${a.name} ${a.url}`.toLowerCase().includes(globalSearch.toLowerCase()))}
                    metricCards={metricCards}
                    incidents={incidents}
                    activity={auditLogs}
                    onOpenAddApi={() => setAddApiModalOpen(true)}
                    onNavigateSection={(sec) => setActiveSection(sec as NavSection)}
                    onProbeApi={handleProbeApi}
                    onTogglePauseApi={handleTogglePauseApi}
                    onDeleteApi={handleDeleteApi}
                    onEditUrl={handleEditUrl}
                    onApproveBaseline={handleApproveBaseline}
                    onOpenIncident={(id) => { setSelectedIncidentId(id); setActiveSection('Incidents'); }}
                    showToast={showToast}
                    trafficData={trafficData}
                    responseTimeData={responseTimeData}
                    lastUpdated={store.lastUpdated}
                    live={store.live}
                    onRefresh={() => void store.refresh()}
                  />
                )}
                {activeSection === 'Incidents' && (
                  <IncidentImpactPage
                    incidents={incidents.filter((i) => !globalSearch || `${i.title} ${i.apiName ?? ''} ${i.id}`.toLowerCase().includes(globalSearch.toLowerCase()))}
                    selectedIncidentId={selectedIncidentId}
                    onSelectIncident={setSelectedIncidentId}
                    onSelectProposal={(propId) => setSelectedProposalId(propId)}
                    onNavigateSection={(sec) => setActiveSection(sec as NavSection)}
                    onChangeStatus={handleChangeIncidentStatus}
                    onAddMapping={handleAddMapping}
                    onRequestProposal={handleRequestProposal}
                    showToast={showToast}
                  />
                )}
                {activeSection === 'Recovery' && (
                  <RecoveryValidationPage
                    proposals={proposals}
                    apis={apis}
                    selectedProposalId={selectedProposalId}
                    onSelectProposal={setSelectedProposalId}
                    onApproveProposal={handleApproveProposal}
                    onRejectProposal={handleRejectProposal}
                    onRunValidationTest={handleRunValidationTest}
                    onPromoteProposal={handlePromoteProposal}
                    onRollbackAdapter={handleRollbackAdapter}
                    onNavigateSection={(sec) => setActiveSection(sec as NavSection)}
                    showToast={showToast}
                  />
                )}
                {activeSection === 'Reports' && <ReportsPage apis={apis} incidents={incidents} proposals={proposals} organization={userProfile.organization} showToast={showToast} />}
                {activeSection === 'Audit Log' && <AuditLogPage logs={auditLogs} showToast={showToast} />}
                {activeSection === 'Settings' && (
                  <SettingsPage
                    settings={settings}
                    user={userProfile}
                    runtime={store.settings?.runtime ?? null}
                    session={store.session}
                    onSaveSession={(s) => store.setSession(s)}
                    onUpdateSettings={handleUpdateSettings}
                    onUpdateUser={handleUpdateUser}
                    onSignOut={() => { clearSession(); setViewMode('landing'); }}
                    showToast={showToast}
                  />
                )}
              </>
            )}
          </main>
        </div>
      </div>

      <AddApiModal isOpen={addApiModalOpen} onClose={() => setAddApiModalOpen(false)} onAddApi={handleAddApi} showToast={showToast} defaults={settings} actor={store.actor} />
      <AuthModal isOpen={authModalOpen} onClose={() => setAuthModalOpen(false)} session={store.session} onSignedIn={(s) => { store.setSession(s); setAuthModalOpen(false); showToast(`Signed in as ${s.actor}`); }} />
    </div>
  );
}
