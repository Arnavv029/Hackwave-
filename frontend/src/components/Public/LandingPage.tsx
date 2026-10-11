import React from 'react';
import { 
  Shield, 
  Activity, 
  FileCode, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Layers, 
  Sliders, 
  Lock, 
  ExternalLink,
  ChevronRight,
  Database,
  Code2,
  Terminal,
  Play
} from 'lucide-react';

interface LandingPageProps {
  onOpenLogin: () => void;
  onOpenSignup: () => void;
  onEnterApp: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onOpenLogin,
  onOpenSignup,
  onEnterApp,
}) => {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Top Announcement Bar */}
      <div className="bg-blue-50 border-b border-blue-200/80 text-blue-900 text-xs font-medium py-2 px-4 text-center flex items-center justify-center gap-2">
        <span className="bg-blue-600 text-white px-2 py-0.5 rounded-full text-[11px] font-bold">New</span>
        <span>Automatic response schema drift analysis with downstream feature mapping</span>
        <button 
          onClick={onEnterApp}
          className="underline font-semibold text-blue-700 hover:text-blue-800 ml-1 inline-flex items-center gap-0.5"
        >
          Explore Live Demo <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Navigation Bar */}
      <header className="border-b border-slate-200/80 bg-white/95 backdrop-blur-md sticky top-0 z-40 shadow-xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
                API Guardian
              </span>
              <p className="text-[10px] text-slate-500 font-mono tracking-wider uppercase -mt-0.5">Reliability Workspace</p>
            </div>
          </div>

          {/* Nav Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-600">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How It Works</a>
            <a href="#security" className="hover:text-slate-900 transition-colors">Security</a>
            <button 
              onClick={onEnterApp}
              className="text-blue-600 hover:text-blue-700 font-semibold transition-colors flex items-center gap-1.5"
            >
              <span>Workspace Demo</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </button>
          </nav>

          {/* Auth Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenLogin}
              className="px-4 py-2 text-xs sm:text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-all"
            >
              Sign In
            </button>
            <button
              onClick={onOpenSignup}
              className="px-4 sm:px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs sm:text-sm font-semibold shadow-md shadow-blue-500/20 transition-all flex items-center gap-2 active:scale-95"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28">
        {/* Subtle Ambient Radial Glows */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[350px] bg-blue-100/60 blur-[130px] rounded-full pointer-events-none" />
        <div className="absolute top-1/3 right-1/4 w-[450px] h-[300px] bg-indigo-100/50 blur-[110px] rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-slate-200/90 text-blue-700 text-xs font-semibold mb-6 shadow-xs">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
              <span>Full-Stack Contract Health & Validation Platform</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12]">
              Know when your APIs change. <br />
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-700 bg-clip-text text-transparent">
                Understand what breaks.
              </span>
            </h1>

            <p className="mt-6 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed font-normal">
              API Guardian continuously checks your API dependencies, catches breaking payload changes, identifies which application features are potentially affected, and helps you safely test and validate proposed fixes.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3.5">
              <button
                onClick={onOpenSignup}
                className="w-full sm:w-auto px-7 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-sm font-bold shadow-lg shadow-blue-500/25 transition-all flex items-center justify-center gap-2.5 active:scale-95"
              >
                <span>Get Started Free</span>
                <ArrowRight className="w-4 h-4" />
              </button>

              <button
                onClick={onEnterApp}
                className="w-full sm:w-auto px-7 py-3.5 bg-white hover:bg-slate-50 border border-slate-200/90 text-slate-800 rounded-2xl text-sm font-semibold transition-all flex items-center justify-center gap-2.5 shadow-xs active:scale-95"
              >
                <Play className="w-4 h-4 text-blue-600 fill-blue-600" />
                <span>See How It Works (Live App)</span>
              </button>
            </div>

            {/* Micro value props */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-500">
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Safe controlled GET probes
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                No silent breaking deployments
              </span>
              <span className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Zero credentials exposure
              </span>
            </div>
          </div>

          {/* Interactive Hero Showcase Visual (White Theme Container) */}
          <div className="mt-14 max-w-5xl mx-auto bg-white rounded-3xl border border-slate-200/90 shadow-xl shadow-slate-200/70 p-4 sm:p-6 lg:p-7 relative overflow-hidden">
            {/* Top faux browser bar */}
            <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-400" />
                <div className="w-3 h-3 rounded-full bg-amber-400" />
                <div className="w-3 h-3 rounded-full bg-emerald-400" />
                <span className="ml-2 text-xs font-mono text-slate-500 bg-slate-50 px-2.5 py-0.5 rounded-md border border-slate-200/60">
                  api-guardian://workspace/incidents/INC-001
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-xs font-bold">
                High Severity Drift Detected
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left Column: Response Comparison */}
              <div className="lg:col-span-7 bg-slate-50/70 rounded-2xl border border-slate-200/80 p-4 font-mono text-xs">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-200/60 text-slate-600">
                  <span className="flex items-center gap-1.5 font-bold">
                    <Code2 className="w-3.5 h-3.5 text-blue-600" />
                    User Profile API (v2) Response Drift
                  </span>
                  <span className="text-[10px] text-slate-400 font-sans">2 minutes ago</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Baseline */}
                  <div className="p-3 rounded-xl bg-white border border-slate-200/90 shadow-xs">
                    <div className="text-[11px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1 font-sans">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Approved Baseline
                    </div>
                    <pre className="text-slate-800 leading-relaxed overflow-x-auto text-[11px]">
{`{
  "id": 104,
  "name": "Aman",
  "email": "aman@co.com",
  "role": "admin"
}`}
                    </pre>
                  </div>

                  {/* Drifted */}
                  <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200 shadow-xs">
                    <div className="text-[11px] font-bold text-amber-800 mb-1.5 flex items-center gap-1 font-sans">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                      Latest Response (Changed)
                    </div>
                    <pre className="text-slate-800 leading-relaxed overflow-x-auto text-[11px]">
{`{
  "id": 104,
  "display_name": "Aman",
  "email": "aman@co.com",
  "role": "admin"
}`}
                    </pre>
                  </div>
                </div>

                <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] flex items-center justify-between font-sans font-medium">
                  <span>Field <code className="bg-amber-100 font-mono px-1 py-0.5 rounded text-amber-950 font-bold">name</code> removed · Field <code className="bg-amber-100 font-mono px-1 py-0.5 rounded text-amber-950 font-bold">display_name</code> introduced</span>
                  <span className="text-[10px] text-amber-700 uppercase font-bold tracking-wider">DRIFT</span>
                </div>
              </div>

              {/* Right Column: Potentially Affected Feature */}
              <div className="lg:col-span-5 flex flex-col justify-between space-y-3">
                <div className="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-800">Potentially Affected Feature</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-50 text-rose-700 border border-rose-200">
                      Critical Risk
                    </span>
                  </div>

                  <div className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs shrink-0">
                      UI
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900">User Profile Greeting Card</p>
                      <p className="text-[11px] text-slate-500">Route: <span className="font-mono text-slate-700 font-semibold">/profile</span> · 100% users</p>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 mt-2.5 leading-relaxed">
                    This feature expects <code className="text-blue-700 font-mono bg-blue-50 px-1 py-0.5 rounded font-bold">$.name</code>. The latest response omitted that field, so greeting cards will fail to render user names.
                  </p>
                </div>

                <div className="p-4 rounded-2xl bg-blue-50 border border-blue-200/80 flex items-center justify-between gap-3 shadow-xs">
                  <div>
                    <p className="text-xs font-bold text-blue-950">Proposed Safe Adapter Available</p>
                    <p className="text-[11px] text-blue-700">Reconciles display_name → name in staging sandbox</p>
                  </div>
                  <button
                    onClick={onEnterApp}
                    className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 transition-all shadow-xs"
                  >
                    <span>Review Fix</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Feature Cards Section (Clean White Theme) */}
      <section id="features" className="py-20 border-t border-slate-200/80 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">Core Capabilities</h2>
            <h3 className="text-3xl sm:text-4xl font-extrabold text-slate-900">Everything needed for resilient API monitoring</h3>
            <p className="mt-3 text-sm text-slate-500">
              Built to replace fragmented alerts with a unified contract validation lifecycle.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Card 1 */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 hover:border-slate-300 hover:shadow-md transition-all group flex flex-col justify-between shadow-xs">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform shadow-xs">
                  <Activity className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-2">Monitor API Health</h4>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Safely probe GET endpoints at controlled intervals. Track latency trends, SLA compliance, HTTP codes, and uptime across production and staging without impacting downstream caches.
                </p>
              </div>
              <ul className="mt-6 space-y-2 text-xs text-slate-600 pt-4 border-t border-slate-100 font-medium">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  Custom interval & timeout limits
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  SSRF safe request verification
                </li>
              </ul>
            </div>

            {/* Card 2 */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 hover:border-slate-300 hover:shadow-md transition-all group flex flex-col justify-between shadow-xs">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform shadow-xs">
                  <FileCode className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-2">Detect Response Changes</h4>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Compare incoming JSON against approved baselines. Instantly flag removed keys, renamed fields, unexpected null values, and datatype alterations before users encounter client bugs.
                </p>
              </div>
              <ul className="mt-6 space-y-2 text-xs text-slate-600 pt-4 border-t border-slate-100 font-medium">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  Side-by-side JSON diff viewer
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                  Explicit developer baseline approval
                </li>
              </ul>
            </div>

            {/* Card 3 */}
            <div className="bg-white border border-slate-200/90 rounded-2xl p-6 hover:border-slate-300 hover:shadow-md transition-all group flex flex-col justify-between shadow-xs">
              <div>
                <div className="w-12 h-12 rounded-2xl bg-cyan-50 text-cyan-600 border border-cyan-100 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform shadow-xs">
                  <Shield className="w-6 h-6" />
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-2">Analyze Impact & Validate Fixes</h4>
                <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                  Connect registered JSON paths directly to user-facing components. Review controlled adapter proposals, review assumptions and risks, and test in staging before deploying fixes.
                </p>
              </div>
              <ul className="mt-6 space-y-2 text-xs text-slate-600 pt-4 border-t border-slate-100 font-medium">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                  Potentially affected feature mapping
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                  Sandbox workflow contract validation
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works (The 5-Step Flow in Light Mode) */}
      <section id="how-it-works" className="py-20 border-t border-slate-200/80 bg-[#f8fafc]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold tracking-widest text-blue-600 uppercase mb-2">Workflow</h2>
            <h3 className="text-3xl sm:text-4xl font-extrabold text-slate-900">How API Guardian protects your stack</h3>
            <p className="mt-3 text-sm text-slate-500">
              A 5-step lifecycle from registration to validated recovery.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 relative">
            {[
              {
                step: '01',
                title: 'Register API',
                desc: 'Add endpoint, method, environment, timeout, and establish the approved baseline.'
              },
              {
                step: '02',
                title: 'Monitor',
                desc: 'Continuous background checks monitor latency and compare payloads against the baseline.'
              },
              {
                step: '03',
                title: 'Detect',
                desc: 'Schema drift algorithms spot missing fields, renames, and HTTP status degradations.'
              },
              {
                step: '04',
                title: 'Investigate',
                desc: 'Examine diffs and pinpoint which application features are potentially affected.'
              },
              {
                step: '05',
                title: 'Validate',
                desc: 'Review adapter proposals, approve fixes, and run sandbox tests to verify resolution.'
              }
            ].map((item, index) => (
              <div 
                key={item.step}
                className="bg-white border border-slate-200/90 rounded-2xl p-5 relative overflow-hidden flex flex-col justify-between shadow-xs hover:shadow-md transition-all"
              >
                <div className="text-3xl font-extrabold text-blue-600/30 font-mono mb-3">{item.step}</div>
                <div>
                  <h4 className="text-base font-bold text-slate-900 mb-1.5">{item.title}</h4>
                  <p className="text-xs text-slate-600 leading-relaxed">{item.desc}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-blue-600 font-bold">
                  <span>Step {index + 1} of 5</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            ))}
          </div>

          {/* Action to try */}
          <div className="mt-12 text-center">
            <button
              onClick={onEnterApp}
              className="inline-flex items-center gap-2.5 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-blue-500/20 active:scale-95"
            >
              <span>Test This Workflow in Interactive Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Security & Integrity Note (Clean White Card) */}
      <section id="security" className="py-16 border-t border-slate-200/80 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-slate-50/80 rounded-3xl border border-slate-200/90 p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6 shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0 shadow-xs">
              <Lock className="w-7 h-7" />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h4 className="text-lg font-bold text-slate-900">Enterprise Security & Zero SSRF Risk</h4>
              <p className="text-xs sm:text-sm text-slate-600 mt-1 leading-relaxed">
                API Guardian never exposes stored secret tokens to the client browser. Internal private destinations (RFC1918) are blocked by default, and fixes are never silently pushed without explicit developer approval and sandbox contract validation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-200 bg-white py-10 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <Shield className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold text-slate-800">API Guardian</span>
            <span className="text-slate-300">·</span>
            <span>Reliable contract monitoring and validation</span>
          </div>

          <div className="flex items-center gap-6">
            <a href="#features" className="hover:text-slate-900 transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-slate-900 transition-colors">How It Works</a>
            <a href="#security" className="hover:text-slate-900 transition-colors">Security</a>
            <button onClick={onOpenLogin} className="hover:text-slate-900 font-medium transition-colors">Sign In</button>
          </div>

          <p className="text-slate-400">© 2026 API Guardian. Prototype Release.</p>
        </div>
      </footer>
    </div>
  );
};
