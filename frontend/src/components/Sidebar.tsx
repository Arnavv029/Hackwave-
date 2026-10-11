import React, { useState } from 'react';
import { 
  LayoutDashboard, 
  AlertTriangle, 
  ShieldCheck, 
  FileText, 
  Activity, 
  Settings as SettingsIcon, 
  ChevronsUpDown, 
  Globe, 
  LogOut, 
  X,
  Shield,
  Layers,
  ChevronRight
} from 'lucide-react';
import { NavSection, UserProfile } from '../types';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  user: UserProfile;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onViewPublicSite: () => void;
  incidentsCount: number;
  proposalsCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeSection,
  onSelectSection,
  user,
  mobileOpen,
  onCloseMobile,
  onViewPublicSite,
  incidentsCount,
  proposalsCount,
}) => {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const mainNavItems: { name: NavSection; label: string; icon: React.ReactNode; badge?: string; badgeColor?: string }[] = [
    { 
      name: 'Dashboard', 
      label: 'Dashboard', 
      icon: <LayoutDashboard className="w-[18px] h-[18px]" /> 
    },
    { 
      name: 'Incidents', 
      label: 'Incidents & Impact', 
      icon: <AlertTriangle className="w-[18px] h-[18px]" />, 
      badge: incidentsCount > 0 ? String(incidentsCount) : undefined,
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    { 
      name: 'Recovery', 
      label: 'Recovery & Validation', 
      icon: <ShieldCheck className="w-[18px] h-[18px]" />, 
      badge: proposalsCount > 0 ? `${proposalsCount} Fix` : undefined,
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200'
    },
    { 
      name: 'Reports', 
      label: 'Reports', 
      icon: <FileText className="w-[18px] h-[18px]" /> 
    },
    { 
      name: 'Audit Log', 
      label: 'Audit Log', 
      icon: <Activity className="w-[18px] h-[18px]" /> 
    },
    { 
      name: 'Settings', 
      label: 'Settings', 
      icon: <SettingsIcon className="w-[18px] h-[18px]" /> 
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside className={`
        fixed top-0 bottom-0 left-0 z-50 w-64 bg-slate-900 text-slate-200 flex flex-col justify-between
        transition-transform duration-300 ease-in-out
        lg:static lg:translate-x-0
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Top Header & Brand */}
        <div>
          <div className="h-20 flex items-center justify-between px-6 border-b border-slate-800">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight text-white block">
                  API Guardian
                </span>
                <span className="text-[10px] text-slate-400 font-mono tracking-wider uppercase block -mt-0.5">
                  Reliability Hub
                </span>
              </div>
            </div>

            {/* Mobile close button */}
            <button 
              onClick={onCloseMobile}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Primary Nav Menu */}
          <div className="px-3 pt-5 pb-2">
            <div className="text-[10px] font-bold tracking-wider text-slate-400 uppercase px-3 pb-2">
              Workspace Navigation
            </div>
            <nav className="space-y-1">
              {mainNavItems.map((item) => {
                const isActive = activeSection === item.name;
                return (
                  <button
                    key={item.name}
                    onClick={() => {
                      onSelectSection(item.name);
                      onCloseMobile();
                    }}
                    className={`
                      w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium transition-all duration-150 text-left
                      ${isActive 
                        ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/25' 
                        : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                      }
                    `}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={isActive ? 'text-white' : 'text-slate-400'}>
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </div>
                    {item.badge && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        isActive 
                          ? 'bg-white/20 text-white border-white/30' 
                          : item.badgeColor || 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Public Landing Link & Mode toggle */}
          <div className="pt-4 px-3">
            <button
              onClick={onViewPublicSite}
              className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800/60 hover:bg-slate-800 hover:text-white transition-all border border-slate-700/60"
            >
              <div className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-blue-400" />
                <span>Public Landing Page</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Bottom User Profile Section */}
        <div className="p-3 border-t border-slate-800 relative bg-slate-900/90">
          <button
            onClick={() => setProfileMenuOpen(!profileMenuOpen)}
            className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-slate-800 transition-colors text-left"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white font-bold text-xs flex items-center justify-center shadow-xs">
                  AR
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-slate-900" />
              </div>

              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">
                  {user.name}
                </div>
                <div className="text-[11px] text-slate-400 truncate font-normal">
                  {user.role}
                </div>
              </div>
            </div>

            <ChevronsUpDown className="w-4 h-4 text-slate-400 shrink-0 ml-1" />
          </button>

          {/* Profile Popover Menu */}
          {profileMenuOpen && (
            <div className="absolute bottom-16 left-3 right-3 bg-slate-800 rounded-2xl shadow-2xl border border-slate-700 p-2 z-50 animate-in fade-in slide-in-from-bottom-2">
              <div className="px-3 py-2 border-b border-slate-700 mb-1">
                <p className="text-xs font-bold text-white">{user.organization}</p>
                <p className="text-[11px] text-slate-400">{user.email}</p>
              </div>

              <button 
                onClick={() => {
                  onSelectSection('Settings');
                  setProfileMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 rounded-lg transition-colors text-left"
              >
                <SettingsIcon className="w-3.5 h-3.5 text-slate-400" />
                Account Settings
              </button>

              <div className="border-t border-slate-700 my-1" />

              <button 
                onClick={() => {
                  setProfileMenuOpen(false);
                  onViewPublicSite();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors text-left"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
