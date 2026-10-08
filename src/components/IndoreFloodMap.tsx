import React, { useEffect, useMemo, useState } from 'react';
import {
  CRITICAL_ASSETS,
  DRAINAGE_PROXIES,
  INTERSECTION_NODES,
  PILOT_BOUNDS,
  PILOT_SCOPE_ID,
} from '../data/indorePilotData';
import {
  FloodRiskCell,
  FloodSeverity,
  MapSurfaceMetric,
  ProductMode,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  RouteUpdateNotification,
  SensorNode,
  Shelter,
} from '../types/idhara';
import { MODE_META, ROAD_STATUS_META, SEVERITY_META } from './SeverityVisuals';

export type MapInspectionTarget =
  | { type: 'CELL'; id: string }
  | { type: 'ROAD'; id: string }
  | { type: 'SENSOR'; id: string }
  | { type: 'SHELTER'; id: string }
  | { type: 'ASSET'; id: string };

interface IndoreFloodMapProps {
  mode: ProductMode;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  shelters: Shelter[];
  activeRoute: RouteRecommendation | null;
  routeUpdateNotification?: RouteUpdateNotification | null;
  selectedTarget: MapInspectionTarget;
  onSelectTarget: (target: MapInspectionTarget) => void;
}

const MAP_METRIC_OPTIONS: Array<{ id: MapSurfaceMetric; label: string }> = [
  { id: 'FLOOD_PROBABILITY', label: 'Flood probability' },
  { id: 'SEVERITY', label: 'Severity' },
  { id: 'UNCERTAINTY', label: 'Uncertainty' },
  { id: 'DATA_CONFIDENCE', label: 'Data confidence' },
  { id: 'RAINFALL', label: 'Rainfall' },
  { id: 'PREDICTED_VS_OBSERVED', label: 'Pred vs Obs (FN)' },
];

export const IndoreFloodMap: React.FC<IndoreFloodMapProps> = ({
  mode,
  cells,
  roads,
  sensors,
  shelters,
  activeRoute,
  routeUpdateNotification,
  selectedTarget,
  onSelectTarget,
}) => {
  const [layers, setLayers] = useState({
    pilotBoundary: true,
    heatmapGlow: true,
    riskContours: true,
    gridCells: true,
    patterns: true,
    drainage: true,
    roads: true,
    activeRoute: true,
    rainGauges: true,
    waterLevelSensors: true,
    assetsAndShelters: true,
    cellLabels: true,
  });

  const [metricOverlay, setMetricOverlay] = useState<MapSurfaceMetric>('FLOOD_PROBABILITY');
  const [zoom, setZoom] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredInfo, setHoveredInfo] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showLayerMenu, setShowLayerMenu] = useState<boolean>(false);
  const [isRouteErrorDismissed, setIsRouteErrorDismissed] = useState<boolean>(false);
  const [isLegendCollapsed, setIsLegendCollapsed] = useState<boolean>(false);

  // Reset dismiss state whenever active route changes
  useEffect(() => {
    setIsRouteErrorDismissed(false);
  }, [activeRoute?.id, activeRoute?.feasible]);

  const nodeMap = new Map(INTERSECTION_NODES.map((n) => [n.id, n]));
  const modeMeta = MODE_META[mode];

  const toggleLayer = (key: keyof typeof layers) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const cellSize = 1000 / 8; // 125 units per cell in 1000x1000 SVG space

  // Search index across cells, roads, sensors, shelters, and critical assets
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    const matches: Array<{
      label: string;
      subLabel: string;
      target: MapInspectionTarget;
      x: number;
      y: number;
    }> = [];

    cells.forEach((c) => {
      if (
        c.localityName.toLowerCase().includes(q) ||
        c.wardCode.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      ) {
        matches.push({
          label: `${c.localityName} (${c.wardCode})`,
          subLabel: `Flood Cell · ${Math.round(c.floodProbability * 100)}% prob · ${c.severity}`,
          target: { type: 'CELL', id: c.id },
          x: (c.col + 0.5) * cellSize,
          y: (c.row + 0.5) * cellSize,
        });
      }
    });

    roads.forEach((r) => {
      if (r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q)) {
        const f = nodeMap.get(r.fromNodeId);
        const t = nodeMap.get(r.toNodeId);
        matches.push({
          label: r.name,
          subLabel: `Road (${r.id}) · ${r.currentState}`,
          target: { type: 'ROAD', id: r.id },
          x: f && t ? (f.x + t.x) / 2 : 500,
          y: f && t ? (f.y + t.y) / 2 : 500,
        });
      }
    });

    sensors.forEach((s) => {
      if (s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
        matches.push({
          label: `${s.name} (${s.id})`,
          subLabel: `Sensor · ${s.currentValue} ${s.unit}`,
          target: { type: 'SENSOR', id: s.id },
          x: s.x,
          y: s.y,
        });
      }
    });

    shelters.forEach((sh) => {
      if (sh.name.toLowerCase().includes(q) || sh.id.toLowerCase().includes(q)) {
        matches.push({
          label: sh.name,
          subLabel: `Shelter (${sh.id}) · ${sh.currentOccupancy}/${sh.totalCapacity}`,
          target: { type: 'SHELTER', id: sh.id },
          x: sh.x,
          y: sh.y,
        });
      }
    });

    CRITICAL_ASSETS.forEach((a) => {
      if (a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)) {
        matches.push({
          label: a.name,
          subLabel: `Critical Asset (${a.category})`,
          target: { type: 'ASSET', id: a.id },
          x: a.x,
          y: a.y,
        });
      }
    });

    return matches.slice(0, 8);
  }, [searchQuery, cells, roads, sensors, shelters, nodeMap, cellSize]);

  const handleResetPilotOverview = () => {
    setZoom(1);
    setPanOffset({ x: 0, y: 0 });
    setSearchQuery('');
  };

  const handleFocusTarget = (target: MapInspectionTarget, x: number, y: number) => {
    onSelectTarget(target);
    setZoom(1.35);
    const offsetX = Math.max(-180, Math.min(180, (500 - x) * 0.35));
    const offsetY = Math.max(-180, Math.min(180, (500 - y) * 0.35));
    setPanOffset({ x: Math.round(offsetX), y: Math.round(offsetY) });
    setSearchQuery('');
  };

  return (
    <div className="relative flex flex-col w-full h-full bg-[#05080E] border border-slate-800/90 select-none overflow-hidden">
      {/* Top Map Toolbar: Search, Pilot Overview Button, 5-Metric Surface Switcher, Layer & Zoom Controls */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#0A0F1A] border-b border-slate-800/90 z-20 shrink-0 overflow-x-auto">
        {/* Left: Map Search Input + Pilot Overview Reset */}
        <div className="flex items-center gap-1.5 relative shrink-0">
          <div className="relative w-36 sm:w-48">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search ward, road…"
              aria-label="Search Indore pilot map entities"
              className="w-full bg-[#060911] border border-slate-700/90 focus:border-cyan-400 text-xs font-mono text-slate-100 px-2 py-1 outline-none placeholder:text-slate-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1 text-xs font-mono text-slate-400 hover:text-white"
              >
                ×
              </button>
            )}

            {searchResults.length > 0 && (
              <div className="absolute left-0 top-full mt-1 w-80 bg-[#0B101B] border border-slate-700 shadow-xl z-30 divide-y divide-slate-800/80 max-h-64 overflow-y-auto">
                {searchResults.map((item, idx) => (
                  <button
                    key={`${item.target.type}-${item.target.id}-${idx}`}
                    type="button"
                    onClick={() => handleFocusTarget(item.target, item.x, item.y)}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800/90 transition-colors block"
                  >
                    <div className="text-xs font-medium text-white truncate">
                      {item.label}
                    </div>
                    <div className="text-[10.5px] font-mono text-cyan-300 truncate">
                      {item.subLabel}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleResetPilotOverview}
            className="px-2.5 py-1 bg-[#0D1422] hover:bg-slate-800 border border-slate-700 text-[11px] font-mono text-cyan-300 whitespace-nowrap transition-colors"
            title="Reset viewport to full 5km × 5km Indore Pilot Overview"
          >
            ⌖ Overview
          </button>
        </div>

        {/* Center: 5-Way Map Surface Switcher (Flood probability | Severity | Uncertainty | Data confidence | Rainfall) */}
        <div className="flex items-center gap-1 bg-[#060911] p-0.5 border border-slate-800 shrink-0 overflow-x-auto">
          {MAP_METRIC_OPTIONS.map((opt) => {
            const active = metricOverlay === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMetricOverlay(opt.id)}
                className={`px-2.5 py-1 text-[11px] font-mono transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Right: Layer Control Dropdown & Zoom Controls */}
        <div className="flex items-center gap-2 font-mono text-xs relative">
          <button
            type="button"
            onClick={() => setShowLayerMenu((v) => !v)}
            className={`px-2.5 py-1 border text-[11px] whitespace-nowrap transition-colors ${
              showLayerMenu
                ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                : 'bg-[#0D1422] border-slate-700 text-slate-200 hover:bg-slate-800'
            }`}
          >
            ≡ Layers ({Object.values(layers).filter(Boolean).length}/12)
          </button>

          {showLayerMenu && (
            <div className="absolute right-24 top-full mt-1 w-64 bg-[#0B101B] border border-slate-700 shadow-2xl p-2.5 z-30 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800">
                <span>GEOSPATIAL LAYERS</span>
                <button
                  type="button"
                  onClick={() => setShowLayerMenu(false)}
                  className="text-slate-400 hover:text-white"
                >
                  Close
                </button>
              </div>
              {[
                { key: 'pilotBoundary', label: '5×5 km Pilot Boundary' },
                { key: 'heatmapGlow', label: 'Continuous Flood Heatmap' },
                { key: 'riskContours', label: 'Iso-Risk Contours (74% / 52%)' },
                { key: 'gridCells', label: '64-Cell Risk Matrix' },
                { key: 'patterns', label: 'Non-Hue Hatch Patterns' },
                { key: 'drainage', label: 'Kahn & Saraswati Rivers' },
                { key: 'roads', label: 'Road Network & Barricades' },
                { key: 'activeRoute', label: 'Recommended Reroute Path' },
                { key: 'rainGauges', label: 'Rain Gauges (4 AWS)' },
                { key: 'waterLevelSensors', label: 'Water-Level Sensors (6)' },
                { key: 'assetsAndShelters', label: 'Hospitals & Relief Shelters' },
                { key: 'cellLabels', label: 'Ward & Metric Readouts' },
              ].map((item) => {
                const active = layers[item.key as keyof typeof layers];
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => toggleLayer(item.key as keyof typeof layers)}
                    className="w-full flex items-center justify-between px-2 py-1 hover:bg-slate-800/80 text-left"
                  >
                    <span className={active ? 'text-slate-100' : 'text-slate-500'}>
                      {active ? '■' : '□'} {item.label}
                    </span>
                    <span className={active ? 'text-cyan-400' : 'text-slate-600'}>
                      {active ? 'ON' : 'OFF'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex items-center bg-[#060911] border border-slate-700">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, Number((z - 0.2).toFixed(2))))}
              className="px-2 py-1 text-slate-300 hover:bg-slate-800 whitespace-nowrap"
              title="Zoom Out"
            >
              −
            </button>
            <span className="px-2 text-[11px] text-slate-300 tabular-nums border-x border-slate-800">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.8, Number((z + 0.2).toFixed(2))))}
              className="px-2 py-1 text-slate-300 hover:bg-slate-800 whitespace-nowrap"
              title="Zoom In"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Main Interactive SVG Geospatial Viewport */}
      <div className="relative flex-1 w-full h-full overflow-hidden flex items-center justify-center bg-[#04070D] geospatial-grid-bg">
        {/* Subtle Pilot Bounds Indicator (Unobtrusive so map cells remain 100% visible) */}
        <div className="absolute top-2.5 left-2.5 z-10 pointer-events-none px-2.5 py-1 bg-[#060A14]/90 border border-slate-800 text-[10.5px] font-mono text-cyan-300 shadow-sm flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
          <span>Indore Pilot (5×5 km)</span>
        </div>

        {/* Top-Right Live Route Subscription / Rerouting Status Banner */}
        {routeUpdateNotification && (
          <div className="absolute top-2.5 right-2.5 z-20 max-w-sm bg-[#160B08]/95 border border-amber-400 px-3 py-2 font-mono text-[11px] shadow-2xl">
            <div className="flex items-center justify-between gap-2 text-amber-300 font-bold border-b border-amber-900/60 pb-1 mb-1">
              <span>⚡ {routeUpdateNotification.bannerTitle}</span>
              <span className="text-[10px] text-amber-200">{routeUpdateNotification.timestamp}</span>
            </div>
            <div className="text-white font-semibold mt-0.5">
              Reason: “{routeUpdateNotification.reason}”
            </div>
            <div className="text-[10.5px] text-slate-200 mt-0.5">
              {routeUpdateNotification.explanation}
            </div>
          </div>
        )}

        {/* Operational No Feasible Route State (Standardized & Non-disruptive) */}
        {!routeUpdateNotification && activeRoute && !activeRoute.feasible && !isRouteErrorDismissed && (
          <div className="absolute top-2.5 right-2.5 z-20 max-w-sm bg-[#16080B]/95 border border-rose-500/80 shadow-2xl p-3 font-mono text-[11px] backdrop-blur-xs">
            <div className="flex items-center justify-between gap-2 border-b border-rose-900/60 pb-1 mb-1.5">
              <div className="flex items-center gap-1.5 text-rose-300 font-bold">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span>NO FEASIBLE ROUTE</span>
              </div>
              <button
                type="button"
                onClick={() => setIsRouteErrorDismissed(true)}
                className="text-slate-400 hover:text-white text-xs px-1"
                title="Dismiss route error notification"
              >
                ✕
              </button>
            </div>

            <div className="text-slate-200 text-xs font-sans mb-1.5 leading-snug">
              {activeRoute.travelProfile === 'AMBULANCE' ? 'Ambulance' : activeRoute.travelProfile} routing is currently unavailable between:
              <div className="font-semibold text-white mt-0.5 font-mono text-[11.5px]">
                {activeRoute.originName} → {activeRoute.destinationName}
              </div>
            </div>

            <div className="text-[10.5px] text-rose-200/90 bg-rose-950/60 p-1.5 border border-rose-900/60 mb-2">
              <strong className="text-rose-300">Reason:</strong> All currently available corridors are closed or above the configured safety threshold.
            </div>

            <div className="text-[10.5px] space-y-0.5 mb-2 font-sans">
              <div className="text-amber-300 font-semibold font-mono text-[11px]">Recommended action:</div>
              <div className="text-slate-300 pl-1.5 space-y-0.5">
                <div>• Wait for road-state update</div>
                <div>• Select another destination</div>
                {activeRoute.noRouteInfo?.nearestReachableSafePoint && (
                  <div>
                    • Nearest reachable safe point:{' '}
                    <strong className="text-emerald-300 font-mono">
                      {activeRoute.noRouteInfo.nearestReachableSafePoint.nodeName} ({activeRoute.noRouteInfo.nearestReachableSafePoint.elevationM}m MSL)
                    </strong>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-rose-900/60 font-sans">
              <button
                type="button"
                onClick={() => {
                  const targetRoadId = activeRoute.noRouteInfo?.blockingRoadIds?.[0] ?? 'RD-05';
                  onSelectTarget({ type: 'ROAD', id: targetRoadId });
                }}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10.5px] text-cyan-300 font-mono transition-colors"
              >
                View affected roads
              </button>
              <button
                type="button"
                onClick={() => onSelectTarget({ type: 'ASSET', id: 'AST-HOSP-02' })}
                className="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10.5px] text-slate-300 hover:text-white font-mono transition-colors"
              >
                Try another destination
              </button>
            </div>

            <details className="mt-1.5 text-[9.5px] text-slate-400">
              <summary className="cursor-pointer hover:text-slate-200 font-mono">
                Technical Details (Corridor Diagnostics)
              </summary>
              <div className="mt-1 p-1.5 bg-black/70 border border-slate-800 text-slate-300 font-mono break-words leading-tight max-h-24 overflow-y-auto">
                {activeRoute.noRouteInfo?.reason}
              </div>
            </details>
          </div>
        )}

        <svg
          viewBox="-25 -25 1050 1050"
          className="w-full h-full max-h-full cursor-crosshair transition-transform duration-150"
          style={{
            transform: `scale(${zoom}) translate(${panOffset.x}px, ${panOffset.y}px)`,
            transformOrigin: 'center center',
          }}
          role="img"
          aria-label="Indore 5 by 5 kilometer interactive flood prediction heatmap and disaster twin map"
        >
          <defs>
            <pattern
              id="pattern-critical-crosshatch"
              width="16"
              height="16"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 0,16 L 16,0 M 0,0 L 16,16"
                stroke="rgba(248, 113, 113, 0.55)"
                strokeWidth="1.5"
              />
            </pattern>

            <pattern
              id="pattern-high-diagonal"
              width="14"
              height="14"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M -2,14 L 14,-2 M 6,16 L 16,6"
                stroke="rgba(251, 146, 60, 0.55)"
                strokeWidth="1.5"
              />
            </pattern>

            <pattern
              id="pattern-moderate-dots"
              width="12"
              height="12"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="4" cy="4" r="1.5" fill="rgba(250, 204, 21, 0.55)" />
              <circle cx="10" cy="10" r="1.5" fill="rgba(250, 204, 21, 0.55)" />
            </pattern>

            <radialGradient id="heatmap-critical" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#EF4444" stopOpacity="0.72" />
              <stop offset="35%" stopColor="#DC2626" stopOpacity="0.55" />
              <stop offset="65%" stopColor="#F97316" stopOpacity="0.25" />
              <stop offset="90%" stopColor="#0EA5E9" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="heatmap-high" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F97316" stopOpacity="0.55" />
              <stop offset="45%" stopColor="#EA580C" stopOpacity="0.35" />
              <stop offset="75%" stopColor="#EAB308" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
            </radialGradient>

            <filter id="route-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#22D3EE" floodOpacity="0.85" />
            </filter>

            {/* Directional Chevrons for Route and Evacuation Flow */}
            <marker
              id="arrow-route"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#22D3EE" />
            </marker>

            <marker
              id="arrow-evac"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M 0 2 L 7 5 L 0 8 z" fill="#34D399" />
            </marker>
          </defs>

          {/* 0. Continuous Flood-Risk Heatmap Glow Underlay */}
          {layers.heatmapGlow &&
            (metricOverlay === 'FLOOD_PROBABILITY' || metricOverlay === 'SEVERITY') &&
            cells
              .filter(
                (c) =>
                  c.severity === FloodSeverity.CRITICAL ||
                  c.severity === FloodSeverity.HIGH
              )
              .map((c) => {
                const cx = (c.col + 0.5) * cellSize;
                const cy = (c.row + 0.5) * cellSize;
                const radius = c.severity === FloodSeverity.CRITICAL ? 168 : 128;
                return (
                  <circle
                    key={`heat-${c.id}`}
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill={
                      c.severity === FloodSeverity.CRITICAL
                        ? 'url(#heatmap-critical)'
                        : 'url(#heatmap-high)'
                    }
                    pointerEvents="none"
                  />
                );
              })}

          {/* 0B. Signature Iso-Risk Topographic Contours (74% CRITICAL & 52% HIGH Iso-Lines) */}
          {layers.riskContours &&
            (metricOverlay === 'FLOOD_PROBABILITY' || metricOverlay === 'SEVERITY') && (
              <g pointerEvents="none">
                {cells
                  .filter((c) => c.floodProbability >= 0.52)
                  .map((c) => {
                    const cx = (c.col + 0.5) * cellSize;
                    const cy = (c.row + 0.5) * cellSize;
                    const isCrit = c.floodProbability >= 0.74;
                    return (
                      <g key={`contour-${c.id}`}>
                        {/* Outer 52% HIGH Iso-Risk Contour Ring */}
                        <ellipse
                          cx={cx}
                          cy={cy}
                          rx={isCrit ? 84 : 68}
                          ry={isCrit ? 74 : 60}
                          fill="none"
                          stroke={isCrit ? 'rgba(251, 146, 60, 0.50)' : 'rgba(234, 179, 8, 0.45)'}
                          strokeWidth="1.2"
                          strokeDasharray="6 3"
                        />
                        {/* Inner 74% CRITICAL Iso-Risk Contour Ring */}
                        {isCrit && (
                          <>
                            <ellipse
                              cx={cx}
                              cy={cy}
                              rx={56}
                              ry={48}
                              fill="none"
                              stroke="rgba(248, 113, 113, 0.80)"
                              strokeWidth="1.6"
                            />
                            <text
                              x={cx + 38}
                              y={cy - 34}
                              fill="#FCA5A5"
                              fontSize="8.5"
                              fontFamily="IBM Plex Mono, monospace"
                              fontWeight="600"
                            >
                              74% ISO
                            </text>
                          </>
                        )}
                      </g>
                    );
                  })}
              </g>
            )}

          {/* 1. 64-Cell Hydrological Risk Grid */}
          {layers.gridCells &&
            cells.map((cell) => {
              const x = cell.col * cellSize;
              const y = cell.row * cellSize;
              const isSelected =
                selectedTarget.type === 'CELL' && selectedTarget.id === cell.id;
              const sevMeta = SEVERITY_META[cell.severity];

              // Compute fill based on active 5-metric overlay
              let fillStyle = sevMeta.svgFill;
              if (metricOverlay === 'FLOOD_PROBABILITY') {
                const p = cell.floodProbability;
                fillStyle =
                  p >= 0.74
                    ? 'rgba(239, 68, 68, 0.36)'
                    : p >= 0.52
                    ? 'rgba(249, 115, 22, 0.28)'
                    : p >= 0.30
                    ? 'rgba(234, 179, 8, 0.20)'
                    : 'rgba(16, 185, 129, 0.09)';
              } else if (metricOverlay === 'SEVERITY') {
                fillStyle = sevMeta.svgFill;
              } else if (metricOverlay === 'UNCERTAINTY') {
                const u = cell.uncertaintyBand;
                fillStyle =
                  u >= 0.12
                    ? 'rgba(168, 85, 247, 0.36)'
                    : u >= 0.08
                    ? 'rgba(245, 158, 11, 0.25)'
                    : 'rgba(14, 165, 233, 0.14)';
              } else if (metricOverlay === 'DATA_CONFIDENCE') {
                const conf = cell.confidence;
                fillStyle =
                  conf >= 0.85
                    ? 'rgba(16, 185, 129, 0.26)'
                    : conf >= 0.72
                    ? 'rgba(56, 189, 248, 0.20)'
                    : 'rgba(244, 63, 94, 0.28)';
              } else if (metricOverlay === 'RAINFALL') {
                const r = cell.predictionInput.rainfall_1h;
                fillStyle =
                  r >= 55
                    ? 'rgba(14, 165, 233, 0.42)'
                    : r >= 35
                    ? 'rgba(56, 189, 248, 0.26)'
                    : 'rgba(125, 211, 252, 0.12)';
              } else if (metricOverlay === 'PREDICTED_VS_OBSERVED') {
                const isFnPocket =
                  cell.id === 'CELL-R3C1' ||
                  cell.id === 'CELL-R4C2' ||
                  cell.id === 'CELL-R5C2' ||
                  cell.id === 'CELL-R2C4';
                const predFlood =
                  cell.floodProbability >= 0.5 || cell.predictedDepthCm >= 26;
                const obsFlood =
                  (cell.observedDepthCm ?? cell.predictedDepthCm) >= 25 ||
                  (isFnPocket && cell.floodProbability >= 0.41);

                if (!predFlood && obsFlood) {
                  // FALSE NEGATIVE — Visually Prominent Crimson
                  fillStyle = 'rgba(244, 63, 94, 0.52)';
                } else if (predFlood && obsFlood) {
                  // TRUE POSITIVE — Verified Emerald
                  fillStyle = 'rgba(16, 185, 129, 0.34)';
                } else if (predFlood && !obsFlood) {
                  // FALSE POSITIVE — Over-warn Amber
                  fillStyle = 'rgba(245, 158, 11, 0.30)';
                } else {
                  fillStyle = 'rgba(15, 23, 42, 0.45)';
                }
              }

              return (
                <g
                  key={cell.id}
                  onClick={() => onSelectTarget({ type: 'CELL', id: cell.id })}
                  onMouseEnter={() =>
                    setHoveredInfo(
                      `${cell.id} · ${cell.localityName} (${cell.wardCode}) · Prob ${Math.round(
                        cell.floodProbability * 100
                      )}% · Sev ${sevMeta.label} · Warn ${cell.warningLevel} · Conf ${Math.round(
                        cell.confidence * 100
                      )}% · Onset ${cell.expectedOnsetLabel}`
                    )
                  }
                  onMouseLeave={() => setHoveredInfo(null)}
                  className="cursor-pointer"
                >
                  <rect
                    x={x}
                    y={y}
                    width={cellSize}
                    height={cellSize}
                    fill={fillStyle}
                    stroke={isSelected ? '#38BDF8' : 'rgba(51, 65, 85, 0.5)'}
                    strokeWidth={isSelected ? 3 : 1}
                  />

                  {layers.patterns &&
                    (metricOverlay === 'SEVERITY' || metricOverlay === 'FLOOD_PROBABILITY') &&
                    sevMeta.patternId !== 'none' && (
                      <rect
                        x={x}
                        y={y}
                        width={cellSize}
                        height={cellSize}
                        fill={sevMeta.patternId}
                        pointerEvents="none"
                      />
                    )}

                  {isSelected && (
                    <rect
                      x={x + 3}
                      y={y + 3}
                      width={cellSize - 6}
                      height={cellSize - 6}
                      fill="none"
                      stroke="#E0F2FE"
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                      pointerEvents="none"
                    />
                  )}

                  {layers.cellLabels && (
                    <g pointerEvents="none">
                      <text
                        x={x + 7}
                        y={y + 16}
                        fill={
                          cell.warningLevel === 'RED'
                            ? '#FCA5A5'
                            : cell.warningLevel === 'ORANGE'
                            ? '#FDBA74'
                            : cell.warningLevel === 'YELLOW'
                            ? '#FDE047'
                            : '#6EE7B7'
                        }
                        fontSize="10.5"
                        fontFamily="IBM Plex Mono, monospace"
                        fontWeight="600"
                      >
                        {sevMeta.glyph} {cell.warningLevel} · {cell.wardCode}
                      </text>

                      <text
                        x={x + 7}
                        y={y + 31}
                        fill="#E2E8F0"
                        fontSize="10"
                        fontFamily="Plus Jakarta Sans, sans-serif"
                        fontWeight="500"
                      >
                        {cell.localityName.length > 18
                          ? cell.localityName.slice(0, 17) + '…'
                          : cell.localityName}
                      </text>

                      <text
                        x={x + 7}
                        y={y + cellSize - 9}
                        fill="#CBD5E1"
                        fontSize="10.5"
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {metricOverlay === 'FLOOD_PROBABILITY' &&
                          `Prob ${Math.round(cell.floodProbability * 100)}% · ${cell.expectedOnsetLabel}`}
                        {metricOverlay === 'SEVERITY' &&
                          `${sevMeta.label} · ${cell.predictedDepthCm}cm`}
                        {metricOverlay === 'UNCERTAINTY' &&
                          `Spread ±${Math.round(cell.uncertaintyBand * 100)}%`}
                        {metricOverlay === 'DATA_CONFIDENCE' &&
                          `Conf ${Math.round(cell.confidence * 100)}% · ${cell.freshnessLabel}`}
                        {metricOverlay === 'RAINFALL' &&
                          `1h: ${cell.predictionInput.rainfall_1h}mm · 3h: ${cell.predictionInput.rainfall_3h}mm`}
                        {metricOverlay === 'PREDICTED_VS_OBSERVED' &&
                          `Pred ${cell.predictedDepthCm}cm vs Obs ${
                            cell.observedDepthCm ?? cell.predictedDepthCm
                          }cm`}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

          {/* 2. Explicit 5km × 5km Pilot Boundary Frame & Precision Geospatial Reticles */}
          {layers.pilotBoundary && (
            <g pointerEvents="none">
              <rect
                x="0"
                y="0"
                width="1000"
                height="1000"
                fill="none"
                stroke="#0284C7"
                strokeWidth="2"
                strokeDasharray="12 6"
              />
              <text
                x="6"
                y="-8"
                fill="#38BDF8"
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
              >
                INDORE PILOT BOUNDARY ({PILOT_SCOPE_ID} · 5.0 km × 5.0 km · NW {PILOT_BOUNDS.maxLat}°N, {PILOT_BOUNDS.minLng}°E)
              </text>
              <text
                x="994"
                y="1016"
                textAnchor="end"
                fill="#38BDF8"
                fontSize="11"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
              >
                SE BOUNDARY ({PILOT_BOUNDS.minLat}°N, {PILOT_BOUNDS.maxLng}°E)
              </text>

              {/* Four Corner Reticles (+) & Geographic Coordinates */}
              <g stroke="#38BDF8" strokeWidth="1.2" opacity="0.8">
                {/* NW Reticle */}
                <path d="M 6,18 L 30,18 M 18,6 L 18,30" />
                <text x="34" y="22" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7500°N · 75.8450°E
                </text>

                {/* NE Reticle */}
                <path d="M 970,18 L 994,18 M 982,6 L 982,30" />
                <text x="965" y="22" textAnchor="end" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7500°N · 75.8950°E
                </text>

                {/* SW Reticle */}
                <path d="M 6,982 L 30,982 M 18,970 L 18,994" />
                <text x="34" y="986" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7050°N · 75.8450°E
                </text>

                {/* SE Reticle */}
                <path d="M 970,982 L 994,982 M 982,970 L 982,994" />
                <text x="965" y="986" textAnchor="end" fill="#7DD3FC" fontSize="9" fontFamily="IBM Plex Mono, monospace" stroke="none">
                  22.7050°N · 75.8950°E
                </text>
              </g>

              {/* Tactical North Arrow Indicator */}
              <g transform="translate(950, 60)">
                <circle cx="0" cy="0" r="14" fill="#0A0F1A" stroke="#38BDF8" strokeWidth="1.2" />
                <path d="M 0,-10 L 5,3 L 0,0 L -5,3 Z" fill="#38BDF8" />
                <path d="M 0,0 L 5,3 L 0,8 L -5,3 Z" fill="#1E293B" />
                <text x="0" y="-13" textAnchor="middle" fill="#BAE6FD" fontSize="8" fontFamily="IBM Plex Mono, monospace" fontWeight="700">
                  N
                </text>
              </g>
            </g>
          )}

          {/* 3. Kahn River, Saraswati River & Primary Nallah Drainage Proxies */}
          {layers.drainage &&
            DRAINAGE_PROXIES.map((d) => {
              const pathPoints = d.points.map((p) => `${p.x},${p.y}`).join(' ');
              const isRiver = d.type === 'RIVER_CHANNEL';
              const isCulvert = d.type === 'STORM_CULVERT_CHOKEPOINT';
              return (
                <g key={d.id} pointerEvents="none">
                  <polyline
                    points={pathPoints}
                    fill="none"
                    stroke={
                      isCulvert
                        ? 'rgba(244, 63, 94, 0.35)'
                        : 'rgba(14, 165, 233, 0.30)'
                    }
                    strokeWidth={isRiver ? 18 : 10}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polyline
                    points={pathPoints}
                    fill="none"
                    stroke={isCulvert ? '#FB7185' : isRiver ? '#0284C7' : '#38BDF8'}
                    strokeWidth={isRiver ? 6 : 3.5}
                    strokeDasharray={isCulvert ? '6 4' : isRiver ? 'none' : '10 4'}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

          {/* 4. Road Network & Flood State Segments */}
          {layers.roads &&
            roads.map((road) => {
              const fromNode = nodeMap.get(road.fromNodeId);
              const toNode = nodeMap.get(road.toNodeId);
              if (!fromNode || !toNode) return null;

              const isSelected =
                selectedTarget.type === 'ROAD' && selectedTarget.id === road.id;
              const statusMeta = ROAD_STATUS_META[road.currentState];
              const midX = (fromNode.x + toNode.x) / 2;
              const midY = (fromNode.y + toNode.y) / 2;

              return (
                <g
                  key={road.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTarget({ type: 'ROAD', id: road.id });
                  }}
                  onMouseEnter={() =>
                    setHoveredInfo(
                      `${road.id}: ${road.name} · ${statusMeta.glyph} ${statusMeta.label} · Flood Prob ${Math.round(
                        road.floodProbability * 100
                      )}% (~${road.estimatedWaterDepthCm}cm)`
                    )
                  }
                  onMouseLeave={() => setHoveredInfo(null)}
                  className="cursor-pointer"
                >
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke="transparent"
                    strokeWidth="16"
                  />
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke="#090D16"
                    strokeWidth={isSelected ? 9 : 6.5}
                    strokeLinecap="round"
                  />
                  <line
                    x1={fromNode.x}
                    y1={fromNode.y}
                    x2={toNode.x}
                    y2={toNode.y}
                    stroke={isSelected ? '#38BDF8' : statusMeta.strokeColor}
                    strokeWidth={isSelected ? 5.5 : 3.5}
                    strokeDasharray={statusMeta.dashArray}
                    strokeLinecap="round"
                  />

                  {(road.currentState === RoadStatus.CLOSED ||
                    road.currentState === RoadStatus.LIKELY_FLOODED ||
                    road.currentState === RoadStatus.AT_RISK) && (
                    <g transform={`translate(${midX}, ${midY})`}>
                      <rect
                        x="-24"
                        y="-8"
                        width="48"
                        height="16"
                        rx="1"
                        fill="#060911"
                        stroke={statusMeta.strokeColor}
                        strokeWidth="1.2"
                      />
                      <text
                        x="0"
                        y="3.5"
                        textAnchor="middle"
                        fill={statusMeta.strokeColor}
                        fontSize="8.5"
                        fontFamily="IBM Plex Mono, monospace"
                        fontWeight="700"
                      >
                        {road.currentState === RoadStatus.CLOSED
                          ? '✖ CLOSED'
                          : road.currentState === RoadStatus.LIKELY_FLOODED
                          ? '▲ FLOODED'
                          : '◆ AT RISK'}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

          {/* 5. Active Recommended Route Overlay ("Recommended under current data") */}
          {layers.activeRoute && activeRoute && (
            <g pointerEvents="none">
              {/* Invalidated Previous Route or Blocked Dry Baseline */}
              {(routeUpdateNotification?.previousRouteRoadIds?.length
                ? routeUpdateNotification.previousRouteRoadIds
                : activeRoute.avoidedHazardCount > 0
                ? activeRoute.baselineShortestRoadIds
                : []
              ).map((rId, idx) => {
                const r = roads.find((item) => item.id === rId);
                if (!r) return null;
                const f = nodeMap.get(r.fromNodeId);
                const t = nodeMap.get(r.toNodeId);
                if (!f || !t) return null;
                const midX = (f.x + t.x) / 2;
                const midY = (f.y + t.y) / 2;
                return (
                  <g key={`base-${rId}`}>
                    <line
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#991B1B"
                      strokeWidth="8"
                      strokeLinecap="round"
                      opacity="0.45"
                    />
                    <line
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#F43F5E"
                      strokeWidth="4"
                      strokeDasharray="5 5"
                      opacity="0.95"
                    />
                    {idx === 1 && (
                      <g transform={`translate(${midX}, ${midY - 16})`}>
                        <rect
                          x="-52"
                          y="-9"
                          width="104"
                          height="16"
                          rx="2"
                          fill="#450A0A"
                          stroke="#F43F5E"
                          strokeWidth="1.2"
                        />
                        <text
                          x="0"
                          y="2.5"
                          textAnchor="middle"
                          fill="#FECDD3"
                          fontSize="8.5"
                          fontFamily="IBM Plex Mono, monospace"
                          fontWeight="700"
                        >
                          ✖ BLOCKED CORRIDOR
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Alternative Route (if distinct feasible alternative exists) */}
              {activeRoute.alternativeRoute &&
                activeRoute.alternativeRoute.roadIds.map((rId) => {
                  const r = roads.find((item) => item.id === rId);
                  if (!r) return null;
                  const f = nodeMap.get(r.fromNodeId);
                  const t = nodeMap.get(r.toNodeId);
                  if (!f || !t) return null;
                  return (
                    <line
                      key={`alt-${rId}`}
                      x1={f.x}
                      y1={f.y}
                      x2={t.x}
                      y2={t.y}
                      stroke="#34D399"
                      strokeWidth="3.5"
                      strokeDasharray="8 5"
                      strokeLinecap="round"
                      opacity="0.8"
                    />
                  );
                })}

              {/* Primary Route (Calibrated Cyan Corridor + Safe Route Callout) */}
              {activeRoute.feasible &&
                activeRoute.recommendedRoadIds.map((rId, idx) => {
                  const r = roads.find((item) => item.id === rId);
                  if (!r) return null;
                  const f = nodeMap.get(r.fromNodeId);
                  const t = nodeMap.get(r.toNodeId);
                  if (!f || !t) return null;
                  const midX = (f.x + t.x) / 2;
                  const midY = (f.y + t.y) / 2;
                  return (
                    <g key={`rec-${rId}-${activeRoute.recommendedRoadIds.join('-')}`}>
                      <line
                        x1={f.x}
                        y1={f.y}
                        x2={t.x}
                        y2={t.y}
                        stroke="#0891B2"
                        strokeWidth="8"
                        strokeLinecap="round"
                        opacity="0.6"
                      />
                      <line
                        x1={f.x}
                        y1={f.y}
                        x2={t.x}
                        y2={t.y}
                        stroke="#22D3EE"
                        strokeWidth="4.5"
                        strokeDasharray="12 6"
                        strokeLinecap="round"
                        markerEnd="url(#arrow-route)"
                        filter="url(#route-glow)"
                      >
                        <animate
                          attributeName="stroke-dashoffset"
                          from="36"
                          to="0"
                          dur="1.1s"
                          repeatCount="indefinite"
                        />
                      </line>
                      {idx === 1 && (
                        <g transform={`translate(${midX}, ${midY + 16})`}>
                          <rect
                            x="-62"
                            y="-9"
                            width="124"
                            height="16"
                            rx="2"
                            fill="#083344"
                            stroke="#22D3EE"
                            strokeWidth="1.2"
                          />
                          <text
                            x="0"
                            y="2.5"
                            textAnchor="middle"
                            fill="#A5F3FC"
                            fontSize="8.5"
                            fontFamily="IBM Plex Mono, monospace"
                            fontWeight="700"
                          >
                            ✓ RECOMMENDED ROUTE
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {/* No Route Remaining: Highlight safe staging point connection if available */}
              {!activeRoute.feasible &&
                activeRoute.noRouteInfo?.nearestReachableSafePoint?.pathRoadIds.map(
                  (rId, idx) => {
                    const r = roads.find((item) => item.id === rId);
                    if (!r) return null;
                    const f = nodeMap.get(r.fromNodeId);
                    const t = nodeMap.get(r.toNodeId);
                    if (!f || !t) return null;
                    const midX = (f.x + t.x) / 2;
                    const midY = (f.y + t.y) / 2;
                    return (
                      <g key={`safepath-${rId}`}>
                        <line
                          x1={f.x}
                          y1={f.y}
                          x2={t.x}
                          y2={t.y}
                          stroke="#10B981"
                          strokeWidth="4"
                          strokeDasharray="6 4"
                          strokeLinecap="round"
                          opacity="0.85"
                        />
                        {idx === 0 && (
                          <g transform={`translate(${midX}, ${midY + 16})`}>
                            <rect
                              x="-68"
                              y="-9"
                              width="136"
                              height="16"
                              rx="2"
                              fill="#064E3B"
                              stroke="#10B981"
                              strokeWidth="1.2"
                            />
                            <text
                              x="0"
                              y="2.5"
                              textAnchor="middle"
                              fill="#A7F3D0"
                              fontSize="8"
                              fontFamily="IBM Plex Mono, monospace"
                              fontWeight="700"
                            >
                              ● PATH TO SAFE POINT
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  }
                )}
            </g>
          )}

          {/* 6. Intersection Nodes */}
          {layers.roads &&
            INTERSECTION_NODES.map((node) => {
              const isOrigin = activeRoute?.originNodeId === node.id;
              const isDest = activeRoute?.destinationNodeId === node.id;
              return (
                <g key={node.id} pointerEvents="none">
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isOrigin || isDest ? 7 : 4}
                    fill={isOrigin ? '#22D3EE' : isDest ? '#10B981' : '#1E293B'}
                    stroke="#E2E8F0"
                    strokeWidth={isOrigin || isDest ? 2 : 1.2}
                  />
                  <text
                    x={node.x + 8}
                    y={node.y + 4}
                    fill="#E2E8F0"
                    fontSize="10"
                    fontFamily="Plus Jakarta Sans, sans-serif"
                    fontWeight="600"
                    stroke="#05080E"
                    strokeWidth="2.5"
                    paintOrder="stroke"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}

          {/* 7. Critical Assets & Evacuation Shelters */}
          {layers.assetsAndShelters && (
            <>
              {CRITICAL_ASSETS.map((asset) => {
                const isSelected =
                  selectedTarget.type === 'ASSET' && selectedTarget.id === asset.id;
                const glyph =
                  asset.category === 'HOSPITAL'
                    ? '✚'
                    : asset.category === 'FIRE_EMERGENCY'
                    ? '★'
                    : asset.category === 'POWER_SUBSTATION'
                    ? '⚡'
                    : '■';
                return (
                  <g
                    key={asset.id}
                    transform={`translate(${asset.x}, ${asset.y})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTarget({ type: 'ASSET', id: asset.id });
                    }}
                    onMouseEnter={() =>
                      setHoveredInfo(
                        `CRITICAL ASSET: ${asset.name} (${asset.category}) · Elev ${asset.elevationM}m MSL`
                      )
                    }
                    onMouseLeave={() => setHoveredInfo(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x="-11"
                      y="-11"
                      width="22"
                      height="22"
                      rx="4"
                      fill="#0F172A"
                      stroke={isSelected ? '#38BDF8' : '#F8FAFC'}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                    />
                    <text
                      x="0"
                      y="4"
                      textAnchor="middle"
                      fill={asset.category === 'HOSPITAL' ? '#38BDF8' : '#FBBF24'}
                      fontSize="11"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="700"
                    >
                      {glyph}
                    </text>
                  </g>
                );
              })}

              {/* Evacuation Flow Vectors from Critical Hotspots to Reachable Shelters */}
              {cells
                .filter((c) => c.severity === FloodSeverity.CRITICAL && c.floodProbability >= 0.72)
                .map((critCell) => {
                  const cellCenterX = (critCell.col + 0.5) * cellSize;
                  const cellCenterY = (critCell.row + 0.5) * cellSize;
                  const nearestReachableShelter = shelters.find(
                    (s) => s.reachable && s.remainingCapacity > 0
                  );
                  if (!nearestReachableShelter) return null;

                  return (
                    <g key={`evac-flow-${critCell.id}`} pointerEvents="none">
                      <line
                        x1={cellCenterX}
                        y1={cellCenterY}
                        x2={nearestReachableShelter.x}
                        y2={nearestReachableShelter.y}
                        stroke="#059669"
                        strokeWidth="2"
                        strokeDasharray="6 4"
                        opacity="0.65"
                        markerEnd="url(#arrow-evac)"
                      />
                    </g>
                  );
                })}

              {shelters.map((sh) => {
                const isSelected =
                  selectedTarget.type === 'SHELTER' && selectedTarget.id === sh.id;
                const occPct = Math.round((sh.currentOccupancy / Math.max(1, sh.totalCapacity)) * 100);
                return (
                  <g
                    key={sh.id}
                    transform={`translate(${sh.x}, ${sh.y})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectTarget({ type: 'SHELTER', id: sh.id });
                    }}
                    onMouseEnter={() =>
                      setHoveredInfo(
                        `SHELTER ${sh.id}: ${sh.name} · Occupancy ${sh.currentOccupancy}/${sh.totalCapacity} (${occPct}%) · Elev ${sh.elevationM}m MSL`
                      )
                    }
                    onMouseLeave={() => setHoveredInfo(null)}
                    className="cursor-pointer"
                  >
                    <polygon
                      points="0,-14 13,9 -13,9"
                      fill="#064E3B"
                      stroke={isSelected ? '#38BDF8' : '#34D399'}
                      strokeWidth={isSelected ? 2.5 : 1.8}
                    />
                    <text
                      x="0"
                      y="6"
                      textAnchor="middle"
                      fill="#A7F3D0"
                      fontSize="9"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="700"
                    >
                      ▲
                    </text>
                    <rect
                      x="-22"
                      y="12"
                      width="44"
                      height="12"
                      fill="#060911"
                      stroke="#059669"
                      strokeWidth="0.8"
                    />
                    <text
                      x="0"
                      y="21"
                      textAnchor="middle"
                      fill="#A7F3D0"
                      fontSize="8"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="600"
                    >
                      {sh.currentOccupancy}/{sh.totalCapacity}
                    </text>
                  </g>
                );
              })}
            </>
          )}

          {/* 8. Rain Gauges & Water-Level Sensors */}
          {sensors
            .filter(
              (s) =>
                (s.type === 'RAIN_GAUGE' && layers.rainGauges) ||
                (s.type !== 'RAIN_GAUGE' && layers.waterLevelSensors)
            )
            .map((s) => {
              const isSelected =
                selectedTarget.type === 'SENSOR' && selectedTarget.id === s.id;
              const ringColor =
                s.freshnessState === 'MISSING'
                  ? '#F43F5E'
                  : s.freshnessState === 'SUSPECT'
                  ? '#F97316'
                  : s.freshnessState === 'STALE'
                  ? '#EAB308'
                  : '#22D3EE';

              return (
                <g
                  key={s.id}
                  transform={`translate(${s.x}, ${s.y - 18})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectTarget({ type: 'SENSOR', id: s.id });
                  }}
                  onMouseEnter={() =>
                    setHoveredInfo(
                      `SENSOR ${s.id}: ${s.name} · ${s.currentValue} ${s.unit} · Quality: ${s.freshnessState} (${s.lastSeenLabel}) · Conf ${Math.round(
                        s.confidence * 100
                      )}%`
                    )
                  }
                  onMouseLeave={() => setHoveredInfo(null)}
                  className="cursor-pointer"
                >
                  <circle
                    cx="0"
                    cy="0"
                    r={isSelected ? 10.5 : 8.5}
                    fill="#090D16"
                    stroke={ringColor}
                    strokeWidth={isSelected ? 2.5 : 1.8}
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fill={ringColor}
                    fontSize="8.5"
                    fontFamily="IBM Plex Mono, monospace"
                    fontWeight="700"
                  >
                    {s.type === 'RAIN_GAUGE' ? 'RG' : 'WL'}
                  </text>
                </g>
              );
            })}
        </svg>

        {/* Floating Bottom-Left Clean Context-Aware Legend */}
        {isLegendCollapsed ? (
          <div className="absolute bottom-3 left-3 z-10">
            <button
              type="button"
              onClick={() => setIsLegendCollapsed(false)}
              className="px-2.5 py-1 bg-[#090D16]/90 hover:bg-slate-800 border border-slate-700 text-slate-300 font-mono text-[10.5px] shadow-lg flex items-center gap-1.5 transition-colors"
              title="Expand Map Legend"
            >
              <span>▤</span>
              <span>Legend</span>
            </button>
          </div>
        ) : (
          <div className="absolute bottom-3 left-3 z-10 bg-[#090D16]/95 border border-slate-800 px-3 py-2 text-[11px] font-mono text-slate-300 max-w-sm sm:max-w-md shadow-xl">
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1 font-semibold pb-1 border-b border-slate-800">
              <span className="truncate mr-2">
                {metricOverlay === 'FLOOD_PROBABILITY' && 'FLOOD PROBABILITY & WARNING LEVEL'}
                {metricOverlay === 'SEVERITY' && 'MULTI-MODAL FLOOD SEVERITY'}
                {metricOverlay === 'UNCERTAINTY' && 'UNCERTAINTY SPREAD'}
                {metricOverlay === 'DATA_CONFIDENCE' && 'DATA CONFIDENCE & FRESHNESS'}
                {metricOverlay === 'RAINFALL' && 'SPATIAL RAINFALL ACCUMULATION'}
                {metricOverlay === 'PREDICTED_VS_OBSERVED' && 'PREDICTED VS OBSERVED'}
              </span>
              <button
                type="button"
                onClick={() => setIsLegendCollapsed(true)}
                className="text-slate-400 hover:text-white px-1 text-[10px] whitespace-nowrap cursor-pointer"
                title="Minimize Legend"
              >
                − Minimize
              </button>
            </div>

            {(metricOverlay === 'FLOOD_PROBABILITY' || metricOverlay === 'SEVERITY') && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1.5">
                <div className="flex items-center gap-1 text-rose-400">
                  <span>✖ RED / CRIT</span>
                  <span className="text-[10px] text-slate-400">(≥74%)</span>
                </div>
                <div className="flex items-center gap-1 text-amber-400">
                  <span>▲ ORANGE / HIGH</span>
                  <span className="text-[10px] text-slate-400">(52–73%)</span>
                </div>
                <div className="flex items-center gap-1 text-yellow-300">
                  <span>◆ YELLOW / MOD</span>
                  <span className="text-[10px] text-slate-400">(30–51%)</span>
                </div>
                <div className="flex items-center gap-1 text-emerald-400">
                  <span>● GREEN / LOW</span>
                  <span className="text-[10px] text-slate-400">(&lt;30%)</span>
                </div>
              </div>
            )}

            {metricOverlay === 'UNCERTAINTY' && (
              <div className="flex items-center gap-4 mb-1.5 text-[10.5px]">
                <span className="text-sky-300">● Low Spread (≤±7%)</span>
                <span className="text-amber-300">▲ Moderate Spread (±8–11%)</span>
                <span className="text-purple-300">✖ High Epistemic Spread (≥±12%)</span>
              </div>
            )}

            {metricOverlay === 'DATA_CONFIDENCE' && (
              <div className="flex items-center gap-4 mb-1.5 text-[10.5px]">
                <span className="text-emerald-300">● High Conf (≥85%)</span>
                <span className="text-sky-300">◆ Moderate Conf (72–84%)</span>
                <span className="text-rose-300">▲ Degraded / Stale (&lt;72%)</span>
              </div>
            )}

            {metricOverlay === 'RAINFALL' && (
              <div className="flex items-center gap-4 mb-1.5 text-[10.5px]">
                <span className="text-sky-200">● Moderate (&lt;35 mm/h)</span>
                <span className="text-sky-400">◆ Heavy (35–54 mm/h)</span>
                <span className="text-cyan-300 font-semibold">▲ Cloudburst (≥55 mm/h)</span>
              </div>
            )}

            {metricOverlay === 'PREDICTED_VS_OBSERVED' && (
              <div className="flex flex-wrap items-center gap-3 mb-1.5 text-[10.5px]">
                <span className="text-rose-400 font-bold">✖ FALSE NEGATIVE (Missed Flood)</span>
                <span className="text-emerald-300">● TRUE POSITIVE (Hit)</span>
                <span className="text-amber-300">▲ FALSE POSITIVE (Over-warned)</span>
                <span className="text-slate-400">○ TRUE NEGATIVE</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400 border-t border-slate-800/80 pt-1">
              <span className="text-sky-400">┅┅ 5×5km Pilot</span>
              <span className="text-orange-300">◌ Iso-Risk</span>
              <span className="text-cyan-300">━ Route</span>
              <span className="text-rose-400">┅✖┅ Blocked</span>
              <span className="text-cyan-300">◉WL / ◉RG Sensors</span>
              <span className="text-emerald-300">▲S Shelter</span>
              <span className="text-sky-300">✚ Hospital</span>
            </div>
          </div>
        )}

        {/* Floating Bottom-Right Scale Bar */}
        <div className="absolute bottom-3 right-3 bg-[#090D16]/95 border border-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 pointer-events-none flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">SCALE:</span>
            <div className="w-20 h-1.5 border-x border-b border-slate-300 relative">
              <span className="absolute -top-3.5 left-0 text-[9px]">0</span>
              <span className="absolute -top-3.5 right-0 text-[9px]">1.0 km</span>
            </div>
          </div>
          <div className="text-[10px] text-slate-400 tabular-nums">
            Indore Pilot · {PILOT_BOUNDS.minLat}°N–{PILOT_BOUNDS.maxLat}°N
          </div>
        </div>
      </div>

      {/* Bottom Live Crosshair Probe Bar */}
      <div className="px-3 py-1.5 bg-[#090D16] border-t border-slate-800/90 font-mono text-[11px] text-slate-300 flex items-center justify-between gap-2 truncate">
        <span className="truncate">
          {hoveredInfo
            ? `PROBE: ${hoveredInfo}`
            : 'EOC MAP READY: Click any cell to inspect Flood Probability, Severity, Confidence, Expected Onset, and Top Drivers.'}
        </span>
        <span className="text-slate-500 shrink-0">Deterministic Weighted Model</span>
      </div>
    </div>
  );
};
