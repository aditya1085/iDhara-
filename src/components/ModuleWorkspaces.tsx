import React from 'react';
import { INTERSECTION_NODES } from '../data/indorePilotData';
import {
  getDisasterTwinStages,
  OPERATIONAL_CHAIN,
} from '../modules/disasterTwin';
import { getEventPresets } from '../modules/historicalReplay';
import {
  ActivityFeedEntry,
  AlertItem,
  DataHealthReport,
  DisasterStage,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  NavigationTab,
  ObservationInjectionType,
  ProductMode,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  SensorNode,
  Shelter,
  UserRole,
  ValidationReport,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';
import { LiveFeedSimulator } from './LiveFeedSimulator';
import {
  ProvenanceStrip,
  RoadStateIndicator,
  SENSOR_FRESHNESS_META,
  SeverityIndicator,
} from './SeverityVisuals';

interface ModuleWorkspaceProps {
  activeTab: NavigationTab;
  params: ScenarioParameters;
  onUpdateParams: (updater: (prev: ScenarioParameters) => ScenarioParameters) => void;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  shelters: Shelter[];
  evacuationPlans: EvacuationPlanItem[];
  routes: RouteRecommendation[];
  activeRouteId: string;
  onSelectRouteId: (id: string) => void;
  customOriginId: string;
  customDestId: string;
  onChangeCustomRoute: (originId: string, destId: string) => void;
  alerts: AlertItem[];
  onAcknowledgeAlert: (id: string) => void;
  validationReport: ValidationReport;
  dataHealthReport: DataHealthReport;
  activeRole: UserRole;
  onSelectMapTarget: (target: MapInspectionTarget) => void;
  onNavigateTab: (tab: NavigationTab) => void;
  activityFeed: ActivityFeedEntry[];
  onInjectObservation: (type: ObservationInjectionType, targetId: string) => void;
  onResetObservations: () => void;
}

export const ModuleWorkspace: React.FC<ModuleWorkspaceProps> = ({
  activeTab,
  params,
  onUpdateParams,
  cells,
  roads,
  sensors,
  shelters,
  evacuationPlans,
  routes,
  activeRouteId,
  onSelectRouteId,
  customOriginId,
  customDestId,
  onChangeCustomRoute,
  alerts,
  onAcknowledgeAlert,
  validationReport,
  dataHealthReport,
  activeRole,
  onSelectMapTarget,
  onNavigateTab,
  activityFeed,
  onInjectObservation,
  onResetObservations,
}) => {
  const criticalCells = cells.filter((c) => c.severity === FloodSeverity.CRITICAL);
  const highCells = cells.filter((c) => c.severity === FloodSeverity.HIGH);
  const closedRoads = roads.filter((r) => r.currentState === RoadStatus.CLOSED);
  const likelyFloodedRoads = roads.filter(
    (r) => r.currentState === RoadStatus.LIKELY_FLOODED
  );

  // 1. OVERVIEW / MISSION SUMMARY STRIP
  if (activeTab === 'overview') {
    return (
      <div className="bg-[#080C14] border-b border-slate-800/90 px-4 py-3 space-y-3">
        {/* Operational Chain Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/70">
          <div className="flex items-center gap-1.5 overflow-x-auto py-0.5">
            {OPERATIONAL_CHAIN.map((item, idx) => (
              <React.Fragment key={item.step}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.step === 'SIMULATE') onNavigateTab('disaster-twin');
                    else if (item.step === 'REROUTE') onNavigateTab('roads-routing');
                    else if (item.step === 'EVACUATE') onNavigateTab('evacuation');
                    else if (item.step === 'WARN') onNavigateTab('alerts');
                    else if (item.step === 'LEARN') onNavigateTab('validation');
                    else if (item.step === 'VERIFY') onNavigateTab('data-health');
                    else onNavigateTab('risk-map');
                  }}
                  className="px-2 py-1 bg-[#0D1320] hover:bg-slate-800 border border-slate-800 text-[11px] font-mono text-slate-200 whitespace-nowrap transition-colors"
                  title={item.shortDesc}
                >
                  <span className="text-cyan-400 font-semibold">{item.label}</span>
                </button>
                {idx < OPERATIONAL_CHAIN.length - 1 && (
                  <span className="text-slate-600 font-mono text-xs" aria-hidden="true">
                    →
                  </span>
                )}
              </React.Fragment>
            ))}
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            Predict the Flood. Protect the City.
          </div>
        </div>

        {/* 4 Key Operational Metrics Row */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <div className="p-2.5 bg-[#0C121E] border border-slate-800/90">
            <div className="font-mono text-[11px] text-slate-400">
              CRITICAL / HIGH FLOOD CELLS
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-mono font-semibold text-rose-400 tabular-nums">
                {criticalCells.length}
              </span>
              <span className="text-xs font-mono text-amber-400 tabular-nums">
                + {highCells.length} High
              </span>
              <span className="text-[11px] font-mono text-slate-500">
                / 64 cells
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
              Peak: Krishnapura ({cells.find((c) => c.id === 'CELL-R2C2')?.predictedDepthCm ?? 68} cm)
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800/90">
            <div className="font-mono text-[11px] text-slate-400">
              ROAD STATE MACHINE (24 CORRIDORS)
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-mono font-semibold text-rose-400 tabular-nums">
                {closedRoads.length} Closed
              </span>
              <span className="text-xs font-mono text-amber-400 tabular-nums">
                + {likelyFloodedRoads.length} Likely Flooded
              </span>
            </div>
            <div className="text-[11px] font-mono text-cyan-300 mt-0.5 truncate">
              {routes.filter((r) => r.avoidedHazardCount > 0).length} Active Routes Recalculated
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800/90">
            <div className="font-mono text-[11px] text-slate-400">
              POPULATION IN PRIORITY EVAC
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-mono font-semibold text-white tabular-nums">
                {evacuationPlans.reduce((s, p) => s + p.populationAtRisk, 0).toLocaleString()}
              </span>
              <span className="text-xs font-mono text-emerald-400">
                4 Shelters Active
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
              Total Shelter Reserve:{' '}
              {shelters
                .reduce((s, sh) => s + (sh.totalCapacity - sh.currentOccupancy), 0)
                .toLocaleString()}{' '}
              berths
            </div>
          </div>

          <div className="p-2.5 bg-[#0C121E] border border-slate-800/90">
            <div className="font-mono text-[11px] text-slate-400">
              SENSOR & MODEL CONFIDENCE
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
                {Math.round(dataHealthReport.confidence * 100)}%
              </span>
              <span className="text-xs font-mono text-slate-400 tabular-nums">
                {sensors.filter((s) => s.freshnessState === 'FRESH').length} Fresh / {sensors.length} Total
              </span>
            </div>
            <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
              {sensors.filter((s) => s.freshnessState !== 'FRESH').length} Stale/Suspect/Missing
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 2. RISK MAP
  if (activeTab === 'risk-map') {
    return null;
  }

  // 4. ROADS & ROUTING WORKSPACE (with Live Feed Simulator + 4-State Road Machine)
  if (activeTab === 'roads-routing') {
    return (
      <div className="p-4 bg-[#080C14] border-b border-slate-800/90 space-y-4 max-h-[55vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] text-cyan-400">
              ROAD STATE MACHINE (OPEN · AT_RISK · LIKELY_FLOODED · CLOSED) & DYNAMIC ROUTING
            </div>
            <h2 className="text-base font-semibold text-white">
              Real-Time Road Graph & Route Recalculation (“Recommended under current data”)
            </h2>
          </div>

          {/* Custom Origin -> Destination Route Builder */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="text-slate-400">Origin:</span>
            <select
              aria-label="Route Origin Node"
              value={customOriginId}
              onChange={(e) => onChangeCustomRoute(e.target.value, customDestId)}
              className="bg-[#0D1320] border border-slate-700 text-slate-200 px-2 py-1 text-xs"
            >
              {INTERSECTION_NODES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
            <span className="text-slate-400">→ Dest:</span>
            <select
              aria-label="Route Destination Node"
              value={customDestId}
              onChange={(e) => onChangeCustomRoute(customOriginId, e.target.value)}
              className="bg-[#0D1320] border border-slate-700 text-slate-200 px-2 py-1 text-xs"
            >
              {INTERSECTION_NODES.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Live Feed Simulator embedded for immediate Road Closure / Reopen / Water-Level testing */}
        <LiveFeedSimulator
          roads={roads}
          sensors={sensors}
          activityFeed={activityFeed}
          onInjectObservation={onInjectObservation}
          onResetObservations={onResetObservations}
          onSelectMapTarget={onSelectMapTarget}
          compact
        />

        {/* Route Recommendations Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {routes.map((rt) => {
            const isSelected = rt.id === activeRouteId;
            return (
              <div
                key={rt.id}
                onClick={() => onSelectRouteId(rt.id)}
                className={`p-3 border cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-cyan-950/30 border-cyan-500/70'
                    : 'bg-[#0C121E] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-cyan-300 font-semibold">
                    ● {rt.recommendationStatusLabel}
                  </span>
                  <span className="text-slate-400">{rt.purpose.replace(/_/g, ' ')}</span>
                </div>
                <div className="text-sm font-semibold text-white mt-1">
                  {rt.originName} → {rt.destinationName}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-300 mt-1.5 tabular-nums">
                  <span>Distance: {rt.recommendedDistanceKm} km</span>
                  <span>·</span>
                  <span>Est. Time: {rt.recommendedEtaMin} min</span>
                  <span>·</span>
                  <span className="text-emerald-300">
                    Avoids {rt.avoidedHazardCount} CLOSED/LIKELY_FLOODED segment(s)
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
                  {rt.safetyAdvisory}
                </p>
                <ProvenanceStrip provenance={rt} expiry={rt.expiry} compact />
              </div>
            );
          })}
        </div>

        {/* Road Segment Status Table */}
        <div className="overflow-x-auto border border-slate-800">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-[#0C121E] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Road Segment</th>
                <th className="py-2 px-3">State Machine</th>
                <th className="py-2 px-3 text-right">Flood Prob</th>
                <th className="py-2 px-3 text-right">Obs Sources</th>
                <th className="py-2 px-3">Transition Evidence</th>
                <th className="py-2 px-3 text-right">Conf</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {roads.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => onSelectMapTarget({ type: 'ROAD', id: r.id })}
                  className="hover:bg-slate-900/80 cursor-pointer"
                >
                  <td className="py-2 px-3 text-slate-200 font-sans font-medium">
                    <span className="font-mono text-cyan-400 mr-1.5">{r.id}</span>
                    {r.name}
                  </td>
                  <td className="py-2 px-3">
                    <RoadStateIndicator state={r.currentState} />
                    {r.isHysteresisHeld && (
                      <span className="ml-1.5 text-[10px] text-amber-300">(Hold)</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-200">
                    {Math.round(r.floodProbability * 100)}%
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-300">
                    {r.agreeingObservationsCount} source(s)
                  </td>
                  <td className="py-2 px-3 text-slate-400 truncate max-w-xs">
                    {r.transitionReason}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-cyan-300">
                    {Math.round(r.confidence * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 5. EVACUATION & SHELTERS WORKSPACE
  if (activeTab === 'evacuation') {
    return (
      <div className="p-4 bg-[#080C14] border-b border-slate-800/90 space-y-4 max-h-[54vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] text-emerald-400">
              PROTECTIVE SHELTER ALLOCATION & EVACUATION DISPATCH
            </div>
            <h2 className="text-base font-semibold text-white">
              High-Ground Municipal Relief Shelters & Vulnerable Pocket Clearance
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-400">
            All evacuation corridors labeled “Recommended under current data”
          </span>
        </div>

        {/* 4 Shelters Readiness Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {shelters.map((sh) => {
            const pct = Math.round((sh.currentOccupancy / sh.totalCapacity) * 100);
            return (
              <div
                key={sh.id}
                onClick={() => onSelectMapTarget({ type: 'SHELTER', id: sh.id })}
                className="p-3 bg-[#0C121E] border border-slate-800 hover:border-emerald-500/50 cursor-pointer"
              >
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-emerald-300 font-semibold">▲ {sh.id} · {sh.ward}</span>
                  <span className="text-slate-400">{sh.elevationM}m MSL</span>
                </div>
                <div className="text-sm font-semibold text-white mt-1 truncate">
                  {sh.name}
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-xs tabular-nums">
                  <span className="text-slate-300">
                    Occupancy: {sh.currentOccupancy}/{sh.totalCapacity} ({pct}%)
                  </span>
                  <span className="text-cyan-300">{sh.status}</span>
                </div>
                <div className="w-full h-1.5 bg-slate-900 mt-1.5 overflow-hidden">
                  <div
                    className={`h-full ${
                      pct > 85 ? 'bg-amber-400' : 'bg-emerald-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <ProvenanceStrip provenance={sh} compact />
              </div>
            );
          })}
        </div>

        {/* Priority Cell Evacuation Table */}
        <div className="overflow-x-auto border border-slate-800">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-[#0C121E] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Source Pocket (Ward)</th>
                <th className="py-2 px-3">Severity</th>
                <th className="py-2 px-3 text-right">Pop. at Risk</th>
                <th className="py-2 px-3">Assigned High-Ground Shelter</th>
                <th className="py-2 px-3 text-right">Buses / ETA</th>
                <th className="py-2 px-3">Dispatch Status</th>
                <th className="py-2 px-3 text-right">Confidence & Expiry</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {evacuationPlans.map((plan) => (
                <tr
                  key={plan.id}
                  onClick={() => onSelectMapTarget({ type: 'CELL', id: plan.sourceCellId })}
                  className="hover:bg-slate-900/80 cursor-pointer"
                >
                  <td className="py-2 px-3 text-slate-200 font-sans font-medium">
                    {plan.sourceLocality}
                  </td>
                  <td className="py-2 px-3">
                    <SeverityIndicator severity={plan.severity} />
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-white">
                    {plan.populationAtRisk}
                  </td>
                  <td className="py-2 px-3 text-emerald-300">
                    {plan.targetShelterName}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-300">
                    {plan.busesAssigned} buses · ~{plan.estimatedClearanceMin}m
                  </td>
                  <td className="py-2 px-3">
                    <span
                      className={
                        plan.status === 'EVACUATING'
                          ? 'text-rose-400 font-semibold'
                          : plan.status === 'STAGED'
                          ? 'text-amber-300'
                          : 'text-cyan-300'
                      }
                    >
                      {plan.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-slate-400">
                    {Math.round(plan.confidence * 100)}% · Exp {plan.expiry.slice(11, 16)}Z
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // 6. ALERTS WORKSPACE
  if (activeTab === 'alerts') {
    return (
      <div className="p-4 bg-[#080C14] border-b border-slate-800/90 space-y-3 max-h-[54vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] text-amber-400">
              CAP-ALIGNED MUNICIPAL EARLY WARNING & ACTION BULLETINS
            </div>
            <h2 className="text-base font-semibold text-white">
              Active Control-Room Advisories (Filtered & Prioritized for {activeRole})
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {alerts.map((alt) => {
            const isRoleTargeted = alt.targetAudience.includes(activeRole);
            return (
              <div
                key={alt.id}
                className={`p-3.5 border ${
                  alt.acknowledged
                    ? 'bg-[#0A0E17] border-slate-800/70 opacity-80'
                    : 'bg-[#0D1320] border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <SeverityIndicator severity={alt.severity} showPatternNote />
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    {isRoleTargeted && (
                      <span className="text-cyan-300">★ Priority for {activeRole}</span>
                    )}
                    <span className="text-slate-400">Step: {alt.stepLink}</span>
                  </div>
                </div>
                <h3 className="text-sm font-semibold text-white mt-1.5">
                  {alt.title}
                </h3>
                <div className="font-mono text-[11px] text-slate-400 mt-1">
                  Affected: <span className="text-slate-200">{alt.affectedLocalities.join(' · ')}</span>
                </div>
                <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                  <strong className="text-slate-200">Trigger Evidence:</strong> {alt.triggerEvidence}
                </p>
                <p className="text-xs text-cyan-200 mt-1.5 leading-relaxed bg-cyan-950/20 border border-cyan-500/30 p-2">
                  <strong>Recommended Action:</strong> {alt.recommendedAction}
                </p>

                <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => onAcknowledgeAlert(alt.id)}
                    className={`px-3 py-1 font-mono text-xs border transition-colors whitespace-nowrap ${
                      alt.acknowledged
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-600 text-white'
                    }`}
                  >
                    {alt.acknowledged ? '✓ Acknowledged in EOC Log' : 'Acknowledge Bulletin'}
                  </button>
                  <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                    Conf {Math.round(alt.confidence * 100)}% · Exp {alt.expiry.slice(11, 16)}Z
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 7. EVENT REPLAY WORKSPACE
  if (activeTab === 'event-replay') {
    const presets = getEventPresets();
    const activePreset =
      presets.find((p) => p.id === params.activeEventPresetId) ?? presets[0];

    return (
      <div className="p-4 bg-[#080C14] border-b border-slate-800/90 space-y-4 max-h-[54vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] text-amber-300">
              DETERMINISTIC HISTORICAL & SCENARIO EVENT REPLAY
            </div>
            <h2 className="text-base font-semibold text-white">
              Indore Monsoon Cloudburst Profiles & Hourly Hydrograph Scrubber
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {presets.map((preset) => {
            const isSelected = preset.id === params.activeEventPresetId;
            return (
              <div
                key={preset.id}
                onClick={() =>
                  onUpdateParams((prev) => ({
                    ...prev,
                    activeEventPresetId: preset.id,
                    mode: preset.mode,
                    rainfallIntensityMmHr: preset.peakRainfallMmHr,
                    drainageBlockagePct: preset.drainageBlockagePct,
                    upstreamKahnInflowMultiplier: preset.upstreamMultiplier,
                    timelineHourOffset: 0,
                    stage: DisasterStage.REAL_TIME_ONGOING,
                  }))
                }
                className={`p-3 border cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-amber-950/30 border-amber-500/70'
                    : 'bg-[#0C121E] border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-amber-300 font-semibold">MODE: {preset.mode}</span>
                  <span className="text-slate-400 tabular-nums">Peak {preset.peakRainfallMmHr} mm/hr</span>
                </div>
                <div className="text-xs font-semibold text-white mt-1">
                  {preset.title}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {preset.summary}
                </p>
              </div>
            );
          })}
        </div>

        <div className="p-3 bg-[#0C121E] border border-slate-800">
          <div className="flex items-center justify-between font-mono text-xs text-slate-300 mb-2">
            <span>HOURLY RAINFALL & STAGE PROFILE — {activePreset.title}</span>
            <span className="text-cyan-300">Click any hour bar to scrub the map</span>
          </div>
          <div className="grid grid-cols-8 gap-2 items-end h-28 pt-4 px-2 bg-[#070B12] border border-slate-800/80">
            {activePreset.hourlyRainProfile.map((step) => {
              const isCurrent = params.timelineHourOffset === step.hourOffset;
              const heightPct = Math.max(12, Math.round((step.mmHr / 95) * 100));
              return (
                <button
                  key={step.hourOffset}
                  type="button"
                  onClick={() =>
                    onUpdateParams((prev) => ({
                      ...prev,
                      mode: activePreset.mode,
                      stage: step.stage,
                      rainfallIntensityMmHr: step.mmHr,
                      timelineHourOffset: step.hourOffset,
                    }))
                  }
                  className="flex flex-col items-center justify-end h-full group cursor-pointer"
                >
                  <span className="font-mono text-[10px] text-slate-300 tabular-nums mb-1">
                    {step.mmHr}mm
                  </span>
                  <div
                    className={`w-full transition-all ${
                      isCurrent
                        ? 'bg-cyan-400 border border-white'
                        : step.mmHr >= 55
                        ? 'bg-rose-500/70 group-hover:bg-rose-400'
                        : step.mmHr >= 30
                        ? 'bg-amber-500/70 group-hover:bg-amber-400'
                        : 'bg-sky-500/60 group-hover:bg-sky-400'
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                  <span
                    className={`font-mono text-[10px] mt-1 truncate max-w-full ${
                      isCurrent ? 'text-cyan-300 font-semibold' : 'text-slate-400'
                    }`}
                  >
                    {step.label.split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // 8. VALIDATION & POST-DISASTER LEARNING WORKSPACE
  if (activeTab === 'validation') {
    return (
      <div className="p-4 bg-[#080C14] border-b border-slate-800/90 space-y-4 max-h-[54vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] text-cyan-400">
              STAGE 4: POST-DISASTER LEARNING & HIGH-WATER MARK (HWM) VALIDATION
            </div>
            <h2 className="text-base font-semibold text-white">
              Predicted vs. Observed Inundation Audit ({validationReport.eventTitle})
            </h2>
          </div>
          <ProvenanceStrip provenance={validationReport} compact />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="font-mono text-[10.5px] text-slate-400">CRITICAL SUCCESS INDEX</div>
            <div className="text-xl font-mono font-semibold text-emerald-300 tabular-nums mt-0.5">
              {(validationReport.criticalSuccessIndex * 100).toFixed(0)}%
            </div>
            <div className="font-mono text-[10px] text-slate-500">CSI Threat Score</div>
          </div>
          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="font-mono text-[10.5px] text-slate-400">PROBABILITY OF DETECTION</div>
            <div className="text-xl font-mono font-semibold text-cyan-300 tabular-nums mt-0.5">
              {(validationReport.probabilityOfDetection * 100).toFixed(0)}%
            </div>
            <div className="font-mono text-[10px] text-slate-500">POD Hit Rate</div>
          </div>
          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="font-mono text-[10.5px] text-slate-400">FALSE ALARM RATIO</div>
            <div className="text-xl font-mono font-semibold text-amber-300 tabular-nums mt-0.5">
              {(validationReport.falseAlarmRatio * 100).toFixed(0)}%
            </div>
            <div className="font-mono text-[10px] text-slate-500">FAR Over-warn</div>
          </div>
          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="font-mono text-[10.5px] text-slate-400">MEAN ABS DEPTH ERROR</div>
            <div className="text-xl font-mono font-semibold text-white tabular-nums mt-0.5">
              ±{validationReport.meanAbsoluteDepthErrorCm} cm
            </div>
            <div className="font-mono text-[10px] text-slate-500">Across 64 Grid Cells</div>
          </div>
          <div className="p-2.5 bg-[#0C121E] border border-slate-800">
            <div className="font-mono text-[10.5px] text-slate-400">BRIER SKILL SCORE</div>
            <div className="text-xl font-mono font-semibold text-sky-300 tabular-nums mt-0.5">
              {validationReport.brierScore}
            </div>
            <div className="font-mono text-[10px] text-slate-500">Probabilistic Calibration</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="p-3 bg-[#0C121E] border border-slate-800 space-y-2">
            <div className="font-mono text-xs text-cyan-300 font-semibold">
              POST-EVENT MODEL CALIBRATION UPDATES (LEARN STEP)
            </div>
            {validationReport.calibrationRecommendations.map((rec) => (
              <div
                key={rec.id}
                className="p-2 bg-[#080C14] border border-slate-800/90 text-xs space-y-0.5"
              >
                <div className="text-slate-200 font-medium">{rec.parameter}</div>
                <div className="font-mono text-[11px] text-slate-400">
                  Adjustment: <span className="text-amber-300">{rec.proposedAdjustment}</span>
                </div>
                <div className="font-mono text-[11px] text-emerald-400">
                  Gain: {rec.expectedGain}
                </div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto border border-slate-800">
            <table className="w-full text-left border-collapse font-mono text-xs">
              <thead>
                <tr className="bg-[#0C121E] text-slate-400 border-b border-slate-800">
                  <th className="py-1.5 px-2.5">Cell Locality</th>
                  <th className="py-1.5 px-2.5 text-right">Pred</th>
                  <th className="py-1.5 px-2.5 text-right">Obs HWM</th>
                  <th className="py-1.5 px-2.5 text-right">Delta</th>
                  <th className="py-1.5 px-2.5">Diagnosis</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {validationReport.records.slice(0, 7).map((rec) => (
                  <tr
                    key={rec.cellId}
                    onClick={() => onSelectMapTarget({ type: 'CELL', id: rec.cellId })}
                    className="hover:bg-slate-900/80 cursor-pointer"
                  >
                    <td className="py-1.5 px-2.5 text-slate-200 font-sans">
                      {rec.localityName}
                    </td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums text-slate-300">
                      {rec.predictedDepthCm} cm
                    </td>
                    <td className="py-1.5 px-2.5 text-right tabular-nums text-white">
                      {rec.observedDepthCm} cm
                    </td>
                    <td
                      className={`py-1.5 px-2.5 text-right tabular-nums ${
                        Math.abs(rec.errorCm) <= 4 ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {rec.errorCm > 0 ? `+${rec.errorCm}` : rec.errorCm} cm
                    </td>
                    <td className="py-1.5 px-2.5 text-slate-400 truncate max-w-[180px]">
                      {rec.learningNote}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // 9. DATA HEALTH & SENSOR TELEMETRY WORKSPACE (FRESH | STALE | SUSPECT | MISSING)
  if (activeTab === 'data-health') {
    const rainGaugeA = sensors.find((s) => s.id === 'SEN-RG-01') ?? sensors[6];
    const waterSensorB = sensors.find((s) => s.id === 'SEN-WL-05') ?? sensors[4];
    const waterSensorC = sensors.find((s) => s.id === 'SEN-WL-04') ?? sensors[3];

    return (
      <div className="p-4 bg-[#080C14] border-b border-slate-800/90 space-y-4 max-h-[55vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="font-mono text-[11px] text-cyan-400">
              DATA QUALITY & SENSOR FRESHNESS STATES (FRESH · STALE · SUSPECT · MISSING)
            </div>
            <h2 className="text-base font-semibold text-white">
              Data Health & Telemetry Quality Panel ({dataHealthReport.overallHealthPct}%)
            </h2>
          </div>
          <ProvenanceStrip provenance={dataHealthReport} compact />
        </div>

        {/* Highlighted Sensor State Examples (Rain Gauge A: FRESH, Water Sensor B: STALE, Water Sensor C: SUSPECT) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono">
          {[
            { label: 'Rain Gauge A (Rajwada)', sensor: rainGaugeA },
            { label: 'Water Sensor B (Harsiddhi)', sensor: waterSensorB },
            { label: 'Water Sensor C (Sarwate Sump)', sensor: waterSensorC },
          ].map((item) => {
            const fMeta = SENSOR_FRESHNESS_META[item.sensor.freshnessState];
            return (
              <div
                key={item.sensor.id}
                onClick={() => onSelectMapTarget({ type: 'SENSOR', id: item.sensor.id })}
                className={`p-3 border ${fMeta.borderColor} ${fMeta.bgTint} cursor-pointer space-y-1`}
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-sans font-semibold text-white">{item.label}</span>
                  <span className={`font-bold ${fMeta.textColor}`}>
                    {fMeta.glyph} {item.sensor.freshnessState}
                  </span>
                </div>
                <div className="text-xs text-slate-200">
                  Last seen: <strong>{item.sensor.lastSeenLabel}</strong>
                </div>
                <div className="text-[11px] text-slate-300">
                  Note: <span className="text-amber-200">{item.sensor.diagnosticNote}</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/80 tabular-nums">
                  <span>
                    Reading: {item.sensor.currentValue} {item.sensor.unit}
                  </span>
                  <span className="text-cyan-300">
                    Conf: {Math.round(item.sensor.confidence * 100)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Live Feed Simulator embedded for injecting Sensor Failures / Water-Level Spikes */}
        <LiveFeedSimulator
          roads={roads}
          sensors={sensors}
          activityFeed={activityFeed}
          onInjectObservation={onInjectObservation}
          onResetObservations={onResetObservations}
          onSelectMapTarget={onSelectMapTarget}
          compact
        />

        {/* 10 Sensors Full Telemetry Quality Table */}
        <div className="overflow-x-auto border border-slate-800">
          <table className="w-full text-left border-collapse font-mono text-xs">
            <thead>
              <tr className="bg-[#0C121E] text-slate-400 border-b border-slate-800">
                <th className="py-2 px-3">Sensor ID & Name</th>
                <th className="py-2 px-3">Freshness State</th>
                <th className="py-2 px-3">Last Seen</th>
                <th className="py-2 px-3 text-right">Reading</th>
                <th className="py-2 px-3">Diagnostic / Quality Note</th>
                <th className="py-2 px-3 text-right">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {sensors.map((s) => {
                const fMeta = SENSOR_FRESHNESS_META[s.freshnessState];
                return (
                  <tr
                    key={s.id}
                    onClick={() => onSelectMapTarget({ type: 'SENSOR', id: s.id })}
                    className="hover:bg-slate-900/80 cursor-pointer"
                  >
                    <td className="py-2 px-3 text-slate-200 font-sans font-medium">
                      <span className="font-mono text-cyan-300 mr-1.5">{s.id}</span>
                      {s.name}
                    </td>
                    <td className="py-2 px-3">
                      <span className={`font-bold ${fMeta.textColor}`}>
                        {fMeta.glyph} {s.freshnessState}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300 tabular-nums">
                      {s.lastSeenLabel}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-white">
                      {s.currentValue} {s.unit}
                    </td>
                    <td className="py-2 px-3 text-slate-400">
                      {s.diagnosticNote}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-cyan-300">
                      {Math.round(s.confidence * 100)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return null;
};
