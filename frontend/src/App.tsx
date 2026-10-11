import React, { useState } from 'react';
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

import { 
  initialRegisteredApis, 
  initialIncidents, 
  initialRecoveryProposals, 
  initialAuditLogs, 
  initialMonitoringSettings, 
  initialMetricCards, 
  initialTrafficData, 
  initialResponseTimes, 
  initialUserProfile 
} from './data/mockApiGuardian';

import { 
  NavSection, 
  PublicViewMode, 
  RegisteredApi, 
  Incident, 
  RecoveryProposal, 
  AuditLogItem, 
  MonitoringSettings, 
  UserProfile 
} from './types';

import { CheckCircle2, Shield } from 'lucide-react';

export default function App() {
  // Navigation & View Mode
  const [viewMode, setViewMode] = useState<PublicViewMode>('app');
  const [activeSection, setActiveSection] = useState<NavSection>('Dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login');

  // Core Data States
  const [apis, setApis] = useState<RegisteredApi[]>(initialRegisteredApis);
  const [incidents, setIncidents] = useState<Incident[]>(initialIncidents);
  const [proposals, setProposals] = useState<RecoveryProposal[]>(initialRecoveryProposals);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>(initialAuditLogs);
  const [settings, setSettings] = useState<MonitoringSettings>(initialMonitoringSettings);
  const [userProfile, setUserProfile] = useState<UserProfile>(initialUserProfile);
  const [metricCards, setMetricCards] = useState(initialMetricCards);
  const [trafficData] = useState(initialTrafficData);
  const [responseTimeData] = useState(initialResponseTimes);

  // Modal & Selection States
  const [addApiModalOpen, setAddApiModalOpen] = useState(false);
  const [selectedProposalId, setSelectedProposalId] = useState<string>('PROP-001');
  const [globalSearch, setGlobalSearch] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Handlers for Add API
  const handleAddApi = (newApi: RegisteredApi) => {
    setApis((prev) => [newApi, ...prev]);

    // Update KPI card
    setMetricCards((prev) =>
      prev.map((c) =>
        c.id === 'registered_apis'
          ? { ...c, value: String(parseInt(c.value) + 1) }
          : c.id === 'healthy_apis'
            ? { ...c, value: String(parseInt(c.value) + 1) }
            : c
      )
    );

    // Record in Audit Log
    const logItem: AuditLogItem = {
      id: `AUD-${Date.now().toString().slice(-3)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actor: userProfile.name,
      actorType: 'Developer',
      action: 'API dependency registered',
      target: newApi.name,
      result: 'Success',
      details: `Configured ${newApi.method} probe (${newApi.interval}) on ${newApi.environment}.`,
      metadata: { endpoint: newApi.url, timeout: newApi.timeout }
    };
    setAuditLogs((prev) => [logItem, ...prev]);
  };

  // Handlers for Probing an API
  const handleProbeApi = (apiId: string) => {
    setApis((prev) =>
      prev.map((api) => {
        if (api.id === apiId) {
          const freshLatency = Math.floor(Math.random() * 40 + 75);
          return {
            ...api,
            responseTime: `${freshLatency}ms`,
            responseTimeNumeric: freshLatency,
            lastChecked: 'Just now',
          };
        }
        return api;
      })
    );
  };

  // Handler for Pausing / Resuming an API
  const handleTogglePauseApi = (apiId: string) => {
    setApis((prev) =>
      prev.map((api) => {
        if (api.id === apiId) {
          const isPaused = api.status === 'Paused';
          const newStatus = isPaused ? 'Healthy' : 'Paused';
          showToast(isPaused ? `Resumed monitoring for ${api.name}` : `Paused checks for ${api.name}`);

          const logItem: AuditLogItem = {
            id: `AUD-${Date.now().toString().slice(-3)}`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            actor: userProfile.name,
            actorType: 'Developer',
            action: isPaused ? 'Monitoring resumed' : 'Monitoring paused',
            target: api.name,
            result: 'Success',
            details: `Operator toggled status to ${newStatus}.`,
          };
          setAuditLogs((l) => [logItem, ...l]);

          return { ...api, status: newStatus };
        }
        return api;
      })
    );
  };

  // Proposal Approvals
  const handleApproveProposal = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) =>
        p.id === proposalId
          ? { ...p, status: 'Approved', approver: userProfile.name }
          : p
      )
    );

    const logItem: AuditLogItem = {
      id: `AUD-${Date.now().toString().slice(-3)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actor: userProfile.name,
      actorType: 'Developer',
      action: 'Repair proposal approved',
      target: proposalId,
      result: 'Success',
      details: `Sign-off granted by ${userProfile.name} for staging deployment.`,
    };
    setAuditLogs((prev) => [logItem, ...prev]);
  };

  const handleRejectProposal = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) =>
        p.id === proposalId
          ? { ...p, status: 'Rejected' }
          : p
      )
    );

    const logItem: AuditLogItem = {
      id: `AUD-${Date.now().toString().slice(-3)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actor: userProfile.name,
      actorType: 'Developer',
      action: 'Repair proposal rejected',
      target: proposalId,
      result: 'Success',
      details: `Rejected adapter proposal ${proposalId}.`,
    };
    setAuditLogs((prev) => [logItem, ...prev]);
  };

  // Validation Test Runner
  const handleRunValidationTest = (proposalId: string) => {
    setProposals((prev) =>
      prev.map((p) => {
        if (p.id === proposalId) {
          return {
            ...p,
            validationResult: {
              runId: `VAL-RUN-${Math.floor(Math.random() * 800 + 100)}`,
              testName: 'User Profile Downstream Contract Test',
              targetWorkflow: 'User Profile Card Render (/profile)',
              expectedResult: 'Payload contains $.name with non-empty string',
              actualResult: 'Payload passed validation: name = "Aman Gupta"',
              status: 'Passed',
              latencyMs: 14,
              testTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              assertions: [
                { rule: 'Field $.name must be defined', passed: true, expected: 'string', actual: '"Aman Gupta"' },
                { rule: 'Field $.email must match baseline', passed: true, expected: 'aman@example.com', actual: 'aman@example.com' },
                { rule: 'HTTP status must be 200', passed: true, expected: '200', actual: '200' },
                { rule: 'Latency within SLA (<200ms)', passed: true, expected: '<200ms', actual: '14ms' }
              ]
            }
          };
        }
        return p;
      })
    );

    const logItem: AuditLogItem = {
      id: `AUD-${Date.now().toString().slice(-3)}`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      actor: userProfile.name,
      actorType: 'Developer',
      action: 'Validation run completed',
      target: proposalId,
      result: 'Success',
      details: 'Executed staging contract test; all 4 assertions passed.',
    };
    setAuditLogs((prev) => [logItem, ...prev]);
  };

  // If in Public Website Mode
  if (viewMode === 'landing') {
    return (
      <>
        <LandingPage
          onOpenLogin={() => {
            setAuthModalMode('login');
            setAuthModalOpen(true);
          }}
          onOpenSignup={() => {
            setAuthModalMode('signup');
            setAuthModalOpen(true);
          }}
          onEnterApp={() => setViewMode('app')}
        />

        <AuthModal
          isOpen={authModalOpen}
          initialMode={authModalMode}
          onClose={() => setAuthModalOpen(false)}
          onSuccess={() => {
            setAuthModalOpen(false);
            setViewMode('app');
            showToast('Welcome to API Guardian!');
          }}
        />
      </>
    );
  }

  // Logged-In Application Mode
  return (
    <div className="min-h-screen bg-[#f1f5f9] p-2 sm:p-5 lg:p-7 flex items-center justify-center font-sans antialiased">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 bg-slate-900 text-white text-xs sm:text-sm px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-2.5 animate-in slide-in-from-top-4 duration-200 border border-slate-800">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Workspace Canvas Container */}
      <div className="w-full max-w-[1560px] bg-white rounded-3xl lg:rounded-[32px] border border-slate-200/90 shadow-xl shadow-slate-200/60 overflow-hidden flex min-h-[920px]">
        {/* Left Sidebar */}
        <Sidebar
          activeSection={activeSection}
          onSelectSection={setActiveSection}
          user={userProfile}
          mobileOpen={mobileMenuOpen}
          onCloseMobile={() => setMobileMenuOpen(false)}
          onViewPublicSite={() => setViewMode('landing')}
          incidentsCount={incidents.filter(i => i.status !== 'Resolved').length}
          proposalsCount={proposals.filter(p => p.status === 'Pending').length}
        />

        {/* Right Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#f8fafc]/60">
          {/* Top Header */}
          <Header
            activeSection={activeSection}
            onOpenMobileMenu={() => setMobileMenuOpen(true)}
            onViewPublicSite={() => setViewMode('landing')}
            onOpenAddApi={() => setAddApiModalOpen(true)}
            globalSearch={globalSearch}
            onSearchChange={setGlobalSearch}
            onNavigateSection={setActiveSection}
          />

          {/* Main Content Body */}
          <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
            {activeSection === 'Dashboard' && (
              <DashboardView
                apis={apis}
                metricCards={metricCards}
                incidents={incidents}
                onOpenAddApi={() => setAddApiModalOpen(true)}
                onNavigateSection={(sec) => setActiveSection(sec as NavSection)}
                onProbeApi={handleProbeApi}
                onTogglePauseApi={handleTogglePauseApi}
                showToast={showToast}
                trafficData={trafficData}
                responseTimeData={responseTimeData}
              />
            )}

            {activeSection === 'Incidents' && (
              <IncidentImpactPage
                incidents={incidents}
                onSelectProposal={(propId) => setSelectedProposalId(propId)}
                onNavigateSection={(sec) => setActiveSection(sec as NavSection)}
                showToast={showToast}
              />
            )}

            {activeSection === 'Recovery' && (
              <RecoveryValidationPage
                proposals={proposals}
                selectedProposalId={selectedProposalId}
                onApproveProposal={handleApproveProposal}
                onRejectProposal={handleRejectProposal}
                onRunValidationTest={handleRunValidationTest}
                onNavigateSection={(sec) => setActiveSection(sec as NavSection)}
                showToast={showToast}
              />
            )}

            {activeSection === 'Reports' && (
              <ReportsPage
                apis={apis}
                incidents={incidents}
                proposals={proposals}
                showToast={showToast}
              />
            )}

            {activeSection === 'Audit Log' && (
              <AuditLogPage
                logs={auditLogs}
                showToast={showToast}
              />
            )}

            {activeSection === 'Settings' && (
              <SettingsPage
                settings={settings}
                user={userProfile}
                onUpdateSettings={(s) => setSettings(s)}
                onUpdateUser={(u) => setUserProfile(u)}
                onSignOut={() => setViewMode('landing')}
                showToast={showToast}
              />
            )}
          </main>
        </div>
      </div>

      {/* Add API Modal */}
      <AddApiModal
        isOpen={addApiModalOpen}
        onClose={() => setAddApiModalOpen(false)}
        onAddApi={handleAddApi}
        showToast={showToast}
      />
    </div>
  );
}
