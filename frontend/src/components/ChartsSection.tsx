import React, { useState } from 'react';
import { Calendar, ChevronDown, Info } from 'lucide-react';
import { ResponseTimeDataPoint, TrafficDataPoint } from '../types';

interface ChartsSectionProps {
  trafficData: TrafficDataPoint[];
  responseTimeData: ResponseTimeDataPoint[];
}

export const ChartsSection: React.FC<ChartsSectionProps> = ({
  trafficData,
  responseTimeData,
}) => {
  const [trafficRange, setTrafficRange] = useState('Last 7 days');
  const [responseRange, setResponseRange] = useState('Last 7 days');
  const [trafficDropdownOpen, setTrafficDropdownOpen] = useState(false);
  const [responseDropdownOpen, setResponseDropdownOpen] = useState(false);

  const [hoveredTrafficIndex, setHoveredTrafficIndex] = useState<number | null>(5); // Default to Nov 16 as in screenshot
  const [hoveredBarIndex, setHoveredBarIndex] = useState<number | null>(null);

  const timeRangeOptions = ['Last 24 hours', 'Last 7 days', 'Last 30 days', 'Last 90 days'];

  // SVG Chart Geometry for Traffic Volume
  // ViewBox: 0 0 560 220
  const width = 560;
  const height = 220;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 35;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  const maxY = 8000;
  const yTicks = [8000, 6000, 4000, 2000, 0];

  // Compute points
  const points = trafficData.map((d, index) => {
    const x = paddingLeft + (index / (trafficData.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (d.volume / maxY) * chartHeight;
    return { x, y, ...d };
  });

  // Build smooth cubic bezier curve
  const buildSmoothPath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? 0 : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }
    return path;
  };

  const smoothPath = buildSmoothPath(points);
  const areaPath = `${smoothPath} L ${points[points.length - 1].x} ${paddingTop + chartHeight} L ${points[0].x} ${paddingTop + chartHeight} Z`;

  // Bar Chart Geometry for Response Times
  // ViewBox: 0 0 560 220
  const barMaxY = 200;
  const barYTicks = [200, 150, 100, 50, 0];
  const barChartWidth = width - paddingLeft - paddingRight;
  const barChartHeight = height - paddingTop - paddingBottom;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-5 mb-5">
      {/* 1. Traffic Volume Chart */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
              Traffic Volume
            </h3>
          </div>

          {/* Date range dropdown */}
          <div className="relative">
            <button
              onClick={() => setTrafficDropdownOpen(!trafficDropdownOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200/80 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>{trafficRange}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {trafficDropdownOpen && (
              <div className="absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1 z-30">
                {timeRangeOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setTrafficRange(opt);
                      setTrafficDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs ${
                      trafficRange === opt ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SVG Curve Container */}
        <div className="w-full relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto overflow-visible select-none"
          >
            <defs>
              <linearGradient id="trafficGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
                <stop offset="60%" stopColor="#3b82f6" stopOpacity="0.08" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.00" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid lines and Y axis numbers */}
            {yTicks.map((val) => {
              const y = paddingTop + chartHeight - (val / maxY) * chartHeight;
              return (
                <g key={val}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={width - paddingRight}
                    y2={y}
                    stroke="#f1f5f9"
                    strokeWidth="1"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize="10"
                    fill="#94a3b8"
                    className="font-mono tabular-nums"
                  >
                    {val === 0 ? '0' : val.toLocaleString()}
                  </text>
                </g>
              );
            })}

            {/* Gradient Fill under curve */}
            <path d={areaPath} fill="url(#trafficGradient)" />

            {/* Main Smooth Line */}
            <path
              d={smoothPath}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* X-axis date labels and interactive trigger areas */}
            {points.map((pt, i) => {
              const isHovered = hoveredTrafficIndex === i;
              return (
                <g key={pt.date}>
                  {/* Vertical hover guide line */}
                  {isHovered && (
                    <line
                      x1={pt.x}
                      y1={paddingTop}
                      x2={pt.x}
                      y2={paddingTop + chartHeight}
                      stroke="#93c5fd"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                  )}

                  {/* Marker Circle */}
                  {isHovered ? (
                    <g>
                      <circle cx={pt.x} cy={pt.y} r="8" fill="#3b82f6" fillOpacity="0.15" />
                      <circle cx={pt.x} cy={pt.y} r="4.5" fill="#ffffff" stroke="#2563eb" strokeWidth="2.5" />
                    </g>
                  ) : null}

                  {/* Invisible broad hitbox for mouseover */}
                  <rect
                    x={pt.x - chartWidth / (points.length * 2)}
                    y={paddingTop}
                    width={chartWidth / points.length}
                    height={chartHeight + paddingBottom}
                    fill="transparent"
                    className="cursor-pointer"
                    onMouseEnter={() => setHoveredTrafficIndex(i)}
                  />

                  {/* X Axis Label */}
                  <text
                    x={pt.x}
                    y={paddingTop + chartHeight + 20}
                    textAnchor="middle"
                    fontSize="10"
                    fill={isHovered ? '#2563eb' : '#94a3b8'}
                    fontWeight={isHovered ? '600' : '400'}
                  >
                    {pt.label}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Floating Tooltip */}
          {hoveredTrafficIndex !== null && (
            <div
              className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full mb-3 bg-slate-900 text-white text-[11px] px-2.5 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 z-20"
              style={{
                left: `${(points[hoveredTrafficIndex].x / width) * 100}%`,
                top: `${(points[hoveredTrafficIndex].y / height) * 100}%`,
              }}
            >
              <span className="font-medium text-slate-300">{points[hoveredTrafficIndex].label}:</span>
              <span className="font-bold font-mono text-white tabular-nums">
                {points[hoveredTrafficIndex].volume.toLocaleString()} req/s
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Response Times Bar Chart */}
      <div className="bg-white rounded-2xl border border-slate-200/90 p-5 sm:p-6 shadow-xs flex flex-col justify-between relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-slate-900 tracking-tight">
              Response Times
            </h3>
          </div>

          {/* Date range dropdown */}
          <div className="relative">
            <button
              onClick={() => setResponseDropdownOpen(!responseDropdownOpen)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200/80 transition-colors"
            >
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>{responseRange}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {responseDropdownOpen && (
              <div className="absolute right-0 mt-1 w-36 bg-white rounded-xl shadow-xl border border-slate-200/90 py-1 z-30">
                {timeRangeOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => {
                      setResponseRange(opt);
                      setResponseDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs ${
                      responseRange === opt ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SVG Layered Bar Chart */}
        <div className="w-full relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto overflow-visible select-none"
          >
            {/* Horizontal Grid lines & Y ticks */}
            {barYTicks.map((val) => {
              const y = paddingTop + barChartHeight - (val / barMaxY) * barChartHeight;
              return (
                <g key={val}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={width - paddingRight}
                    y2={y}
                    stroke="#f1f5f9"
                    strokeWidth="1"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={y + 3.5}
                    textAnchor="end"
                    fontSize="10"
                    fill="#94a3b8"
                    className="font-mono tabular-nums"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Bars */}
            {responseTimeData.map((d, i) => {
              const groupWidth = barChartWidth / responseTimeData.length;
              const barWidth = 18;
              const centerX = paddingLeft + i * groupWidth + groupWidth / 2;
              const barX = centerX - barWidth / 2;

              // Heights
              const avgHeight = (d.avgLatency / barMaxY) * barChartHeight;
              const peakHeight = (d.peakLatency / barMaxY) * barChartHeight;

              const avgY = paddingTop + barChartHeight - avgHeight;
              const peakY = paddingTop + barChartHeight - peakHeight;

              const isHovered = hoveredBarIndex === i;

              return (
                <g 
                  key={d.time} 
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredBarIndex(i)}
                  onMouseLeave={() => setHoveredBarIndex(null)}
                >
                  {/* Background Soft Gray Bar (representing peak/total latency) */}
                  <rect
                    x={barX + 10}
                    y={peakY}
                    width={barWidth - 4}
                    height={peakHeight}
                    rx="3"
                    fill="#e2e8f0"
                    className="transition-colors duration-150"
                  />

                  {/* Foreground Vibrant Blue Bar (representing avg response time) */}
                  <rect
                    x={barX}
                    y={avgY}
                    width={barWidth}
                    height={avgHeight}
                    rx="4"
                    fill={isHovered ? '#1d4ed8' : '#3b82f6'}
                    className="transition-all duration-150"
                  />

                  {/* Invisible Hitbox */}
                  <rect
                    x={centerX - groupWidth / 2}
                    y={paddingTop}
                    width={groupWidth}
                    height={barChartHeight + paddingBottom}
                    fill="transparent"
                  />

                  {/* X Axis Time Label */}
                  <text
                    x={centerX}
                    y={paddingTop + barChartHeight + 20}
                    textAnchor="middle"
                    fontSize="10"
                    fill={isHovered ? '#1d4ed8' : '#94a3b8'}
                    fontWeight={isHovered ? '600' : '400'}
                    className="font-mono tabular-nums"
                  >
                    {d.time}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Floating Tooltip for Bar */}
          {hoveredBarIndex !== null && (
            <div
              className="absolute pointer-events-none transform -translate-x-1/2 -translate-y-full mb-3 bg-slate-900 text-white text-[11px] px-3 py-1.5 rounded-lg shadow-lg z-20 space-y-0.5"
              style={{
                left: `${((paddingLeft + hoveredBarIndex * (barChartWidth / responseTimeData.length) + (barChartWidth / responseTimeData.length) / 2) / width) * 100}%`,
                top: `${((paddingTop + barChartHeight - (responseTimeData[hoveredBarIndex].avgLatency / barMaxY) * barChartHeight) / height) * 100}%`,
              }}
            >
              <div className="font-semibold text-slate-300">{responseTimeData[hoveredBarIndex].time} Window</div>
              <div className="flex items-center gap-2 font-mono">
                <span className="text-blue-400">Avg: {responseTimeData[hoveredBarIndex].avgLatency}ms</span>
                <span className="text-slate-400">·</span>
                <span className="text-slate-300">Peak: {responseTimeData[hoveredBarIndex].peakLatency}ms</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
