import React, { useState, useRef, useEffect } from 'react';
import { Search, Bell, Share2, Menu, X, CheckCircle2, AlertTriangle, ArrowRight, ShieldCheck, Globe } from 'lucide-react';
import { NavSection } from '../types';

interface HeaderProps {
  activeSection: NavSection;
  onOpenMobileMenu: () => void;
  onViewPublicSite: () => void;
  onOpenAddApi: () => void;
  globalSearch: string;
  onSearchChange: (value: string) => void;
  onNavigateSection: (section: NavSection) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeSection,
  onOpenMobileMenu,
  onViewPublicSite,
  onOpenAddApi,
  globalSearch,
  onSearchChange,
  onNavigateSection,
}) => {
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const alerts = [
    {
      id: 1,
      type: 'warning',
      title: 'INC-001: User Profile API Drift',
      message: 'Field `name` omitted, replaced by `display_name` in latest check.',
      time: '12m ago',
      section: 'Incidents' as NavSection,
    },
    {
      id: 2,
      type: 'info',
      title: 'Validation Suite Succeeded',
      message: 'Staging contract test passed 4/4 assertions for PROP-001.',
      time: '1h ago',
      section: 'Recovery' as NavSection,
    },
    {
      id: 3,
      type: 'success',
      title: 'Baseline Locked',
      message: 'Orders & Fulfillment API golden contract committed by Alex Rivera.',
      time: '3h ago',
      section: 'Dashboard' as NavSection,
    },
  ];

  const getSectionTitle = (sec: NavSection) => {
    switch (sec) {
      case 'Dashboard': return 'Dashboard';
      case 'Incidents': return 'Incidents & Impact';
      case 'Recovery': return 'Recovery & Validation';
      case 'Reports': return 'Reports & Audit Export';
      case 'Audit Log': return 'Audit Log & History';
      case 'Settings': return 'Settings & Governance';
      default: return sec;
    }
  };

  return (
    <header className="h-20 bg-transparent flex items-center justify-between px-4 sm:px-8 border-b border-slate-200/60">
      {/* Left side: Hamburger (mobile) + Page Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileMenu}
          className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-white border border-slate-200/80 shadow-xs"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
            {getSectionTitle(activeSection)}
          </h1>
          <p className="text-[11px] text-slate-500 hidden sm:block">
            API Guardian Workspace · High Reliability Contract Telemetry
          </p>
        </div>
      </div>

      {/* Right side: Bell, Search, Public site toggle */}
      <div className="flex items-center gap-3">
        {/* Notification Bell with Badge */}
        <div className="relative" ref={notificationRef}>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="w-10 h-10 rounded-xl bg-white border border-slate-200/80 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors shadow-xs relative"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white" />
          </button>

          {/* Notifications Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200/90 py-3 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-4 pb-2 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-slate-900">API Guardian Alerts</span>
                  <span className="bg-amber-50 text-amber-700 text-xs px-2 py-0.5 rounded-full font-bold border border-amber-200">
                    1 Active Drift
                  </span>
                </div>
                <button 
                  onClick={() => setShowNotifications(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {alerts.map((alert) => (
                  <div 
                    key={alert.id} 
                    onClick={() => {
                      onNavigateSection(alert.section);
                      setShowNotifications(false);
                    }}
                    className="p-3.5 hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-2.5">
                      {alert.type === 'warning' ? (
                        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      ) : alert.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      ) : (
                        <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-semibold text-slate-900 truncate">{alert.title}</p>
                          <span className="text-[11px] text-slate-400 shrink-0">{alert.time}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{alert.message}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-4 pt-2 border-t border-slate-100 text-center">
                <button 
                  onClick={() => {
                    setShowNotifications(false);
                    onNavigateSection('Incidents');
                  }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 flex items-center justify-center gap-1 mx-auto"
                >
                  View All Detected Incidents <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Global Search Input */}
        <div className="relative hidden md:block w-52 lg:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={globalSearch}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search APIs, incidents..."
            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200/90 rounded-xl text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 shadow-xs transition-all"
          />
        </div>

        {/* Public Website Preview Action */}
        <button
          onClick={onViewPublicSite}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200/90 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 transition-colors shadow-xs"
          title="Switch to Public Landing Page"
        >
          <Globe className="w-3.5 h-3.5 text-blue-600" />
          <span className="hidden sm:inline">Public Site</span>
        </button>
      </div>
    </header>
  );
};
