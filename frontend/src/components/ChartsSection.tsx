import React, { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import type { ResponseTimeDataPoint, TrafficDataPoint } from '../types';

interface ChartsSectionProps {
  trafficData: TrafficDataPoint[];
  responseTimeData: (ResponseTimeDataPoint & { samples?: number })[];
}

/** Nice axis: max rounded up to 1/2/5 × 10^n, split into `ticks` lines. */
function niceScale(maxValue: number, ticks = 4): { max: number; steps: number[] } {
  const raw = Math.max(maxValue, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const steps: number[] = [];
  for (let i = ticks; i >= 0; i--) steps.push(Math.round((nice / ticks) * i * 100) / 100);
  return { max: nice, steps };
}
const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n));

const width = 560;
const height = 220;
const padL = 48;
const padR = 20;
const padT = 20;
const padB = 35;
const chartW = width - padL - padR;
const chartH = height - padT - padB;

export const ChartsSection: React.FC<ChartsSectionProps> = ({ trafficData, responseTimeData }) => {
  const [hoveredTrafficIndex, setHoveredTrafficIndex] = useState<number | null>(null);
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);

  const traffic = useMemo(() => {
    const scale = niceScale(Math.max(0, ...trafficData.map((d) => d.volume)));
    const points = trafficData.map((d, index) => ({
      x: padL + (trafficData.length > 1 ? (index / (trafficData.length - 1)) * chartW : chartW / 2),
      y: padT + chartH - (d.volume / scale.max) * chartH,
      ...d,
    }));
    let path = '';
    if (points.length === 1) path = `M ${points[0]!.x - 4} ${points[0]!.y} L ${points[0]!.x + 4} ${points[0]!.y}`;
    else if (points.length > 1) {
      path = `M ${points[0]!.x} ${points[0]!.y}`;
      for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)]!;
        const p1 = points[i]!;
        const p2 = points[i + 1]!;
        const p3 = points[Math.min(points.length - 1, i + 2)]!;
        path += ` C ${p1.x + (p2.x - p0.x) / 6} ${p1.y + (p2.y - p0.y) / 6}, ${p2.x - (p3.x - p1.x) / 6} ${p2.y - (p3.y - p1.y) / 6}, ${p2.x} ${p2.y}`;
      }
    }
    const area = points.length > 1 ? `${path} L ${points[points.length - 1]!.x} ${padT + chartH} L ${points[0]!.x} ${padT + chartH} Z` : '';
    const total = trafficData.reduce((s, d) => s + d.volume, 0);
    return { scale, points, path, area, total };
  }, [trafficData]);

  const latency = useMemo(() => {
    const scale = niceScale(Math.max(0, ...responseTimeData.map((d) => d.peakLatency)));
    const withData = responseTimeData.filter((d) => (d.samples ?? d.avgLatency) > 0);
    const overallAvg = withData.length ? Math.round(withData.reduce((s, d) => s + d.avgLatency, 0) / withData.length) : 0;
    const peak = Math.max(0, ...responseTimeData.map((d) => d.peakLatency));
    return { scale, overallAvg, peak, hasData: withData.length > 0 };
  }, [responseTimeData]);

  const empty = (text: string) => (
    <div className="h-[200px] flex items-center justify-center text-xs text-slate-400 text-center px-6">
      <span>
        <Info className="w-4 h-4 inline-block mr-1 -mt-0.5" />
        {text}
      </span>
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mb-5">
      {/* 1. Checks per day */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">Checks per day</h3>
            <p className="text-[11px] text-slate-500">Probes executed across all monitors · last 7 days · {traffic.total.toLocaleString()} total</p>
          </div>
          <span className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 rounded-lg border border-slate-200/80">Last 7 days</span>
        </div>
        {traffic.total === 0 ? empty('No checks recorded yet. Register an API; scheduled and manual checks will show up here.') : (
          <div className="w-full relative">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none" role="img" aria-label="Checks per day">
              <defs>
                <linearGradient id="trafficGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
              </defs>
              {traffic.scale.steps.map((val) => {
                const y = padT + chartH - (val / traffic.scale.max) * chartH;
                return (
                  <g key={val}>
                    <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8" className="font-mono tabular-nums">{fmt(val)}</text>
                  </g>
                );
              })}
              {traffic.area && <path d={traffic.area} fill="url(#trafficGradient)" />}
              <path d={traffic.path} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {traffic.points.map((pt, i) => {
                const isHovered = hoveredTrafficIndex === i;
                return (
                  <g key={pt.date}>
                    {isHovered && <line x1={pt.x} y1={padT} x2={pt.x} y2={padT + chartH} stroke="#93c5fd" strokeWidth="1" strokeDasharray="3 3" />}
                    <circle cx={pt.x} cy={pt.y} r={isHovered ? 4.5 : 2.5} fill="#ffffff" stroke="#2563eb" strokeWidth="2" />
                    <rect x={pt.x - chartW / (Math.max(1, traffic.points.length) * 2)} y={padT} width={chartW / Math.max(1, traffic.points.length)} height={chartH + padB} fill="transparent" className="cursor-pointer" onMouseEnter={() => setHoveredTrafficIndex(i)} onMouseLeave={() => setHoveredTrafficIndex(null)} />
                    <text x={pt.x} y={padT + chartH + 20} textAnchor="middle" fontSize="10" fill={isHovered ? '#2563eb' : '#94a3b8'} fontWeight={isHovered ? '600' : '400'}>{pt.label}</text>
                  </g>
                );
              })}
            </svg>
            {hoveredTrafficIndex !== null && traffic.points[hoveredTrafficIndex] && (
              <div className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full mb-3 bg-slate-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 z-20" style={{ left: `${(traffic.points[hoveredTrafficIndex]!.x / width) * 100}%`, top: `${(traffic.points[hoveredTrafficIndex]!.y / height) * 100}%` }}>
                <span className="font-medium text-slate-300">{traffic.points[hoveredTrafficIndex]!.label}:</span>
                <span className="font-bold font-mono text-white tabular-nums">{traffic.points[hoveredTrafficIndex]!.volume.toLocaleString()} checks</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 2. Response times */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between relative">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">Response Times</h3>
            <p className="text-[11px] text-slate-500">Successful checks · last 24 hours in 4-hour windows · avg {latency.overallAvg}ms · peak {latency.peak}ms</p>
          </div>
          <span className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 rounded-lg border border-slate-200/80">Last 24 hours</span>
        </div>
        {!latency.hasData ? empty('No successful checks in the last 24 hours yet.') : (
          <div className="w-full relative">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none" role="img" aria-label="Response times">
              {latency.scale.steps.map((val) => {
                const y = padT + chartH - (val / latency.scale.max) * chartH;
                return (
                  <g key={val}>
                    <line x1={padL} y1={y} x2={width - padR} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                    <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8" className="font-mono tabular-nums">{fmt(val)}ms</text>
                  </g>
                );
              })}
              {responseTimeData.map((d, i) => {
                const groupWidth = chartW / Math.max(1, responseTimeData.length);
                const barWidth = Math.min(22, groupWidth * 0.35);
                const centerX = padL + i * groupWidth + groupWidth / 2;
                const avgH = (d.avgLatency / latency.scale.max) * chartH;
                const peakH = (d.peakLatency / latency.scale.max) * chartH;
                const isHovered = hoveredBarIndex === i;
                const hasSamples = (d.samples ?? d.avgLatency) > 0;
                return (
                  <g key={`${d.time}-${i}`} className="cursor-pointer" onMouseEnter={() => setHoveredBarIndex(i)} onMouseLeave={() => setHoveredBarIndex(null)}>
                    <rect x={centerX - barWidth / 2 + barWidth * 0.45} y={padT + chartH - peakH} width={barWidth * 0.8} height={peakH} rx="3" fill="#e2e8f0" />
                    <rect x={centerX - barWidth / 2} y={padT + chartH - avgH} width={barWidth} height={avgH} rx="4" fill={hasSamples ? (isHovered ? '#1d4ed8' : '#3b82f6') : '#f1f5f9'} />
                    <rect x={centerX - groupWidth / 2} y={padT} width={groupWidth} height={chartH + padB} fill="transparent" />
                    <text x={centerX} y={padT + chartH + 20} textAnchor="middle" fontSize="10" fill={isHovered ? '#1d4ed8' : '#94a3b8'} fontWeight={isHovered ? '600' : '400'} className="font-mono tabular-nums">{d.time}</text>
                  </g>
                );
              })}
            </svg>
            {hoveredBarIndex !== null && responseTimeData[hoveredBarIndex] && (
              <div className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full mb-3 bg-slate-900 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg z-20 space-y-0.5" style={{ left: `${((padL + hoveredBarIndex * (chartW / Math.max(1, responseTimeData.length)) + chartW / Math.max(1, responseTimeData.length) / 2) / width) * 100}%`, top: `${((padT + chartH - (responseTimeData[hoveredBarIndex]!.avgLatency / latency.scale.max) * chartH) / height) * 100}%` }}>
                <div className="font-semibold text-slate-300">{responseTimeData[hoveredBarIndex]!.time} window{responseTimeData[hoveredBarIndex]!.samples !== undefined ? ` · ${responseTimeData[hoveredBarIndex]!.samples} checks` : ''}</div>
                <div className="flex items-center gap-2 font-mono">
                  <span className="text-blue-400">Avg: {responseTimeData[hoveredBarIndex]!.avgLatency}ms</span>
                  <span className="text-slate-400">·</span>
                  <span className="text-slate-300">Peak: {responseTimeData[hoveredBarIndex]!.peakLatency}ms</span>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="mt-2 flex items-center gap-4 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-blue-500" /> average</span>
          <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-slate-200" /> peak</span>
        </div>
      </div>
    </div>
  );
};
