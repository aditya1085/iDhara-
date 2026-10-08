import React, { useMemo, useState } from 'react';
import { CRITICAL_ASSETS } from '../data/indorePilotData';
import { createProvenance } from '../modules/dataIngestion';
import { defaultPredictionEngine } from '../modules/prediction';
import {
  AlertItem,
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  NavigationTab,
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
  SensorNode,
  Shelter,
  UserRole,
  WarningLevel,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';
import {
  ProvenanceStrip,
  RoadStateIndicator,
  SeverityIndicator,
  WARNING_LEVEL_META,
  WarningLevelIndicator,
} from './SeverityVisuals';

interface ContextInspectorPanelProps {
  selectedTarget: MapInspectionTarget;
  onSelectTarget: (target: MapInspectionTarget) => void;
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  sensors: SensorNode[];
  shelters: Shelter[];
  evacuationPlans: EvacuationPlanItem[];
  alerts: AlertItem[];
  params: ScenarioParameters;
  activeRoute: RouteRecommendation | null;
  activeRole: UserRole;
  onNavigateTab: (tab: NavigationTab) => void;
  stableTicksElapsed: number;
  onStepStableTick: () => void;
}

export const ContextInspectorPanel: React.FC<ContextInspectorPanelProps> = ({
  selectedTarget,
  onSelectTarget,
  cells,
  roads,
  sensors,
  shelters,
  evacuationPlans,
  alerts,
  params,
  activeRoute,
  activeRole,
  onNavigateTab,
  stableTicksElapsed,
  onStepStableTick,
}) => {
  const [panelTab, setPanelTab] = useState<'SITUATION' | 'INSPECTOR'>('SITUATION');
  const [expandedWhyIds, setExpandedWhyIds] = useState<Set<string>>(
    new Set(['CARD-PRIMARY'])
  );

  const toggleWhyWarning = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedWhyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // High-risk zones & At-risk roads computation for "Situation Overview"
  const highRiskZones = useMemo(
    () =>
      [...cells]
        .filter(
          (c) =>
            c.severity === FloodSeverity.CRITICAL ||
            c.severity === FloodSeverity.HIGH
        )
        .sort((a, b) => b.floodProbability - a.floodProbability),
    [cells]
  );

  const atRiskRoads = useMemo(
    () =>
      roads
        .filter(
          (r) =>
            r.currentState === RoadStatus.CLOSED_INUNDATED ||
            r.currentState === RoadStatus.RESTRICTED_SHALLOW ||
            r.currentState === RoadStatus.CAUTION_WATERLOGGING
        )
        .sort((a, b) => b.floodProbability - a.floodProbability),
    [roads]
  );

  const affectedPopulation = useMemo(
    () => evacuationPlans.reduce((sum, p) => sum + p.populationAtRisk, 0),
    [evacuationPlans]
  );

  const affectedAssets = useMemo(() => {
    const cellMap = new Map<string, FloodRiskCell>(cells.map((c) => [c.id, c]));
    return CRITICAL_ASSETS.filter((a) => {
      const host = cellMap.get(a.cellId);
      return (
        host &&
        (host.severity === FloodSeverity.CRITICAL ||
          host.severity === FloodSeverity.HIGH ||
          host.severity === FloodSeverity.MODERATE)
      );
    });
  }, [cells]);

  // Action Cards built from the top representative warning clusters across the city
  const actionCards = useMemo(() => {
    const sortedByProb = [...cells].sort(
      (a, b) => b.floodProbability - a.floodProbability
    );
    const primaryHotspot = sortedByProb[0] ?? cells[18];
    const secondaryCell =
      cells.find((c) => c.id === 'CELL-R3C4') ?? // Sarwate Bus Stand
      sortedByProb[3] ??
      cells[28];
    const mthHospitalCell =
      cells.find((c) => c.id === 'CELL-R2C3') ?? cells[19];

    const buildCard = (id: string, cell: FloodRiskCell, customActions: string[]) => {
      const prov = createProvenance(
        params.mode,
        cell.confidence,
        params.timelineHourOffset
      );
      const expiryIso = new Date(
        new Date(prov.generated_at).getTime() + 18 * 60 * 1000
      ).toISOString();

      return {
        id,
        cell,
        warningLevel: cell.warningLevel,
        directive: WARNING_LEVEL_META[cell.warningLevel].actionTitle,
        floodProbabilityPct: Math.round(cell.floodProbability * 100),
        confidencePct: Math.round(cell.confidence * 100),
        leadTimeMin: cell.leadTimeMin,
        actions: customActions,
        generated_at: prov.generated_at,
        expiry: expiryIso,
        confidence: cell.confidence,
      };
    };

    return [
      buildCard('CARD-PRIMARY', primaryHotspot, [
        `Monitor affected roads (${
          atRiskRoads[0]?.name ?? 'MG Road / Krishnapura Bridge'
        })`,
        `Verify nearby water-level sensor (${
          primaryHotspot.verifiedBySensorId ?? 'SEN-WL-01'
        })`,
        'Prepare alternate hospital route via Regal–Palasia elevated corridor',
        `Review evacuation readiness for ${primaryHotspot.localityName} (${primaryHotspot.wardCode})`,
      ]),
      buildCard('CARD-SARWATE', secondaryCell, [
        'Monitor Sarwate Underpass & Patel Bridge approach for curb ponding',
        'Verify water-level sensor SEN-WL-04 & activate sump pumps',
        'Prepare AICTSL bus diversion away from low-lying transit bays',
        'Review evacuation readiness at Holkar Science College shelter (SH-04)',
      ]),
      buildCard('CARD-HOSPITAL', mthHospitalCell, [
        'Monitor MTH Hospital eastern ambulance gate waterlogging',
        'Verify ultrasonic stage at Krishnapura Bridge (SEN-WL-01)',
        'Prepare alternate neonatal ambulance route via Regal Square',
        'Review standby dewatering pump readiness with Chimanbagh SDRF',
      ]),
    ];
  }, [cells, atRiskRoads, params.mode, params.timelineHourOffset]);

  const inspectedCell =
    selectedTarget.type === 'CELL'
      ? cells.find((c) => c.id === selectedTarget.id) ?? cells[18]
      : null;

  const inspectedRoad =
    selectedTarget.type === 'ROAD'
      ? roads.find((r) => r.id === selectedTarget.id) ?? roads[4]
      : null;

  const inspectedSensor =
    selectedTarget.type === 'SENSOR'
      ? sensors.find((s) => s.id === selectedTarget.id) ?? sensors[0]
      : null;

  const inspectedShelter =
    selectedTarget.type === 'SHELTER'
      ? shelters.find((sh) => sh.id === selectedTarget.id) ?? shelters[0]
      : null;

  const inspectedAsset =
    selectedTarget.type === 'ASSET'
      ? CRITICAL_ASSETS.find((a) => a.id === selectedTarget.id) ?? CRITICAL_ASSETS[0]
      : null;

  const handleSelectAndInspect = (target: MapInspectionTarget) => {
    onSelectTarget(target);
    setPanelTab('INSPECTOR');
  };

  return (
    <aside className="w-full lg:w-[410px] xl:w-[440px] shrink-0 bg-[#090D16] border-l border-slate-800/90 flex flex-col h-full overflow-y-auto">
      {/* Right Panel Mode Switcher */}
      <div className="px-3.5 py-2.5 border-b border-slate-800/90 bg-[#0B101B] flex flex-col gap-1.5 shrink-0">
        <div className="flex items-center justify-between font-mono text-[10.5px]">
          <span className="text-cyan-400 font-semibold">
            WHAT SHOULD THE CITY DO NEXT?
          </span>
          <span className="text-slate-400">{activeRole}</span>
        </div>

        <div className="flex items-center gap-1 bg-[#060911] p-0.5 border border-slate-800 w-full">
          <button
            type="button"
            onClick={() => setPanelTab('SITUATION')}
            className={`flex-1 py-1.5 px-2.5 text-xs font-mono transition-colors whitespace-nowrap ${
              panelTab === 'SITUATION'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Action Cards & Situation
          </button>
          <button
            type="button"
            onClick={() => setPanelTab('INSPECTOR')}
            className={`flex-1 py-1.5 px-2.5 text-xs font-mono transition-colors whitespace-nowrap ${
              panelTab === 'INSPECTOR'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Cell / Target Prediction ({selectedTarget.id.replace('CELL-', '')})
          </button>
        </div>
      </div>

      {/* ==================================================
          VIEW 1: ACTION CARDS + SITUATION OVERVIEW
          ================================================== */}
      {panelTab === 'SITUATION' && (
        <div className="p-4 space-y-4 flex-1">
          {/* SECTION A: EARLY-WARNING ACTION CARDS + "WHY THIS WARNING?" */}
          <section aria-label="Action Cards" className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800/90 pb-2">
              <div>
                <div className="font-mono text-[10.5px] text-amber-400">
                  EARLY-WARNING & RESPONSE ACTION CARDS
                </div>
                <h2 className="text-sm font-semibold text-white">
                  What Should the City Do Next?
                </h2>
              </div>
              <span className="font-mono text-[10.5px] text-slate-400">
                Hysteresis Active
              </span>
            </div>

            {actionCards.map((card) => {
              const wMeta = WARNING_LEVEL_META[card.warningLevel];
              const isWhyOpen = expandedWhyIds.has(card.id);
              const inp = card.cell.predictionInput;

              return (
                <div
                  key={card.id}
                  className={`p-3 border ${wMeta.borderColor} ${wMeta.bgTint} space-y-2.5 transition-colors`}
                >
                  {/* Warning Header */}
                  <div className="flex items-center justify-between gap-2">
                    <WarningLevelIndicator level={card.warningLevel} />
                    <button
                      type="button"
                      onClick={() =>
                        handleSelectAndInspect({ type: 'CELL', id: card.cell.id })
                      }
                      className="font-mono text-[11px] text-cyan-300 hover:underline whitespace-nowrap"
                    >
                      {card.cell.localityName} ({card.cell.wardCode}) →
                    </button>
                  </div>

                  {/* Probability, Confidence & Expected Onset */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-200 tabular-nums bg-[#090D16]/80 px-2.5 py-1.5 border border-slate-800/90">
                    <span>
                      Flood probability:{' '}
                      <strong className="text-white">{card.floodProbabilityPct}%</strong>
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>
                      Confidence:{' '}
                      <strong className="text-cyan-300">{card.confidencePct}%</strong>
                    </span>
                    <span className="text-slate-600">·</span>
                    <span>
                      Onset: <strong className="text-amber-300">~{card.leadTimeMin} min</strong>
                    </span>
                  </div>

                  {/* Hysteresis Hold Notice (when de-escalating) */}
                  {card.cell.warningHysteresis.isHoldingDeescalation && (
                    <div className="px-2.5 py-1.5 bg-amber-950/60 border border-amber-500/50 flex items-center justify-between gap-2 font-mono text-[10.5px] text-amber-200">
                      <span>
                        ⧖ Hysteresis Hold ({stableTicksElapsed}/3 stable ticks before de-escalation)
                      </span>
                      <button
                        type="button"
                        onClick={onStepStableTick}
                        className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 whitespace-nowrap"
                      >
                        +1 Stable Tick
                      </button>
                    </div>
                  )}

                  {/* Recommended Actions List */}
                  <div>
                    <div className="font-mono text-[10.5px] text-slate-300 font-semibold mb-1">
                      Recommended actions:
                    </div>
                    <ul className="space-y-1 text-xs text-slate-100">
                      {card.actions.map((act, i) => (
                        <li key={i} className="flex items-start gap-1.5 leading-snug">
                          <span className="text-cyan-400 font-mono">•</span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Visible "Why this warning?" Interactive Button */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={(e) => toggleWhyWarning(card.id, e)}
                      className="w-full py-1.5 px-2.5 bg-[#090D16] hover:bg-slate-900 border border-slate-700/90 text-left font-mono text-[11px] text-cyan-300 flex items-center justify-between transition-colors"
                    >
                      <span>
                        {isWhyOpen ? '▼ Hide warning explanation' : '▶ Why this warning?'}
                      </span>
                      <span className="text-slate-400 text-[10px]">
                        Drivers & Hysteresis Rule
                      </span>
                    </button>

                    {isWhyOpen && (
                      <div className="mt-1.5 p-2.5 bg-[#070A12] border border-slate-800 space-y-2 text-[11px] font-mono">
                        <div className="text-slate-300">
                          <span className="text-slate-400">Trigger Rule: </span>
                          <span className={wMeta.textColor}>{wMeta.ruleSummary}</span>
                        </div>
                        <div className="text-slate-300">
                          <span className="text-slate-400">Hysteresis State: </span>
                          <span>{card.cell.warningHysteresis.rationale}</span>
                        </div>

                        <div className="border-t border-slate-800/80 pt-1.5">
                          <div className="text-slate-400 mb-1">
                            Top Drivers ({card.cell.localityName}):
                          </div>
                          <div className="space-y-1">
                            {card.cell.topDrivers.map((drv) => (
                              <div
                                key={drv.factor}
                                className="flex items-center justify-between text-slate-200"
                              >
                                <span>{drv.factor}</span>
                                <span className="text-cyan-300 tabular-nums">
                                  {drv.weight}% wt
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="border-t border-slate-800/80 pt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-slate-400 tabular-nums">
                          <span>rain_1h: {inp.rainfall_1h}mm</span>
                          <span>rain_3h: {inp.rainfall_3h}mm</span>
                          <span>rain_6h: {inp.rainfall_6h}mm</span>
                          <span>rain_24h: {inp.rainfall_24h}mm</span>
                          <span>elev: {inp.elevation}m</span>
                          <span>flow_acc: {Math.round(inp.flow_accumulation * 100)}%</span>
                          <span>drain_proxy: {inp.drainage_proxy}</span>
                          <span>imperv: {Math.round(inp.imperviousness * 100)}%</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Mandatory Card Provenance: generated time, expiry, data confidence */}
                  <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] text-slate-300 tabular-nums pt-1.5 border-t border-slate-800/80">
                    <span>
                      GEN {card.generated_at.slice(11, 19)}Z · EXP {card.expiry.slice(11, 19)}Z
                    </span>
                    <span className="text-cyan-300 font-semibold">
                      DATA CONF: {card.confidencePct}%
                    </span>
                  </div>
                </div>
              );
            })}
          </section>

          {/* SECTION B: SITUATION OVERVIEW */}
          <section aria-label="Situation Overview" className="space-y-2.5 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono font-semibold text-slate-300 uppercase">
                Situation Overview (Indore 5×5 km Pilot)
              </h2>
              <span className="font-mono text-[10.5px] text-slate-400">
                {params.mode}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div
                onClick={() =>
                  highRiskZones[0] &&
                  handleSelectAndInspect({ type: 'CELL', id: highRiskZones[0].id })
                }
                className="p-2 bg-[#0D1320] border border-slate-800 hover:border-rose-500/50 cursor-pointer"
              >
                <div className="font-mono text-[10px] text-slate-400">HIGH-RISK ZONES</div>
                <div className="text-lg font-mono font-semibold text-rose-400 tabular-nums">
                  {highRiskZones.length} <span className="text-[11px] text-slate-400">/ 64</span>
                </div>
              </div>

              <div
                onClick={() =>
                  atRiskRoads[0] &&
                  handleSelectAndInspect({ type: 'ROAD', id: atRiskRoads[0].id })
                }
                className="p-2 bg-[#0D1320] border border-slate-800 hover:border-amber-500/50 cursor-pointer"
              >
                <div className="font-mono text-[10px] text-slate-400">AT-RISK ROADS</div>
                <div className="text-lg font-mono font-semibold text-amber-400 tabular-nums">
                  {atRiskRoads.length} <span className="text-[11px] text-slate-400">/ 24</span>
                </div>
              </div>

              <div
                onClick={() => onNavigateTab('evacuation')}
                className="p-2 bg-[#0D1320] border border-slate-800 hover:border-cyan-500/50 cursor-pointer"
              >
                <div className="font-mono text-[10px] text-slate-400">PEOPLE / ASSETS</div>
                <div className="text-sm font-mono font-semibold text-white tabular-nums mt-0.5">
                  {affectedPopulation.toLocaleString()} pop · {affectedAssets.length} assets
                </div>
              </div>

              <div
                onClick={() => onNavigateTab('evacuation')}
                className="p-2 bg-[#0D1320] border border-slate-800 hover:border-emerald-500/50 cursor-pointer"
              >
                <div className="font-mono text-[10px] text-slate-400">SHELTERS & ALERTS</div>
                <div className="text-sm font-mono font-semibold text-emerald-300 tabular-nums mt-0.5">
                  {shelters.length} Open · {alerts.filter((a) => !a.acknowledged).length} Alerts
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ==================================================
          VIEW 2: CELL PREDICTION DISPLAY & ENTITY INSPECTOR
          ================================================== */}
      {panelTab === 'INSPECTOR' && (
        <div className="flex flex-col flex-1">
          {/* Quick Entity Switcher Bar */}
          <div className="px-4 py-2 bg-[#070B12] border-b border-slate-800/80 flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono">
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'CELL', id: 'CELL-R2C2' })}
              className={`px-2 py-1 border whitespace-nowrap transition-colors ${
                selectedTarget.type === 'CELL'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Cell: Krishnapura
            </button>
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'ROAD', id: 'RD-05' })}
              className={`px-2 py-1 border whitespace-nowrap transition-colors ${
                selectedTarget.type === 'ROAD'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Road: MG Bridge
            </button>
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'SENSOR', id: 'SEN-WL-01' })}
              className={`px-2 py-1 border whitespace-nowrap transition-colors ${
                selectedTarget.type === 'SENSOR'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Sensor: WL-01
            </button>
            <button
              type="button"
              onClick={() => onSelectTarget({ type: 'SHELTER', id: 'SH-01' })}
              className={`px-2 py-1 border whitespace-nowrap transition-colors ${
                selectedTarget.type === 'SHELTER'
                  ? 'bg-cyan-950/60 border-cyan-500/60 text-cyan-300'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Shelter: SH-01
            </button>
          </div>

          {/* 1. FLOOD-RISK CELL PREDICTION DISPLAY */}
          {inspectedCell && (
            <div className="p-4 space-y-4 flex-1">
              <div className="border-b border-slate-800/80 pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-slate-400">
                      {inspectedCell.id} · Ward {inspectedCell.wardCode} · {inspectedCell.landUse}
                    </div>
                    <h3 className="text-base font-semibold text-white mt-0.5">
                      {inspectedCell.localityName}
                    </h3>
                  </div>
                  <WarningLevelIndicator level={inspectedCell.warningLevel} showDirective={false} />
                </div>
                <div className="mt-1.5 flex items-center justify-between font-mono text-[11px] text-slate-400 tabular-nums">
                  <span>
                    Elev {inspectedCell.elevationM}m MSL · Slope {inspectedCell.slopeDeg}°
                  </span>
                  <span className="text-cyan-300">{inspectedCell.warningHysteresis.actionDirective}</span>
                </div>
              </div>

              {/* Structured Cell Prediction Display (Flood probability, Severity, Data confidence, Expected onset, Rainfall) */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">Flood probability</div>
                  <div className="text-2xl font-mono font-bold text-white tabular-nums mt-0.5">
                    {Math.round(inspectedCell.floodProbability * 100)}%
                    <span className="text-xs text-slate-400 font-normal ml-1.5">
                      ±{Math.round(inspectedCell.uncertaintyBand * 100)}%
                    </span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Est. Depth: <span className="text-slate-200">{inspectedCell.predictedDepthCm} cm</span>
                  </div>
                </div>

                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">Severity</div>
                  <div className="mt-1">
                    <SeverityIndicator severity={inspectedCell.severity} />
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-1.5">
                    Expected onset:{' '}
                    <span className="text-amber-300 font-semibold">
                      {inspectedCell.expectedOnsetLabel}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">Data confidence</div>
                  <div className="text-2xl font-mono font-bold text-cyan-300 tabular-nums mt-0.5">
                    {Math.round(inspectedCell.confidence * 100)}%
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Freshness: <span className="text-slate-200">{inspectedCell.freshnessLabel}</span>
                  </div>
                </div>

                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">Rainfall (1h / 3h)</div>
                  <div className="text-lg font-mono font-semibold text-sky-300 tabular-nums mt-0.5">
                    {inspectedCell.predictionInput.rainfall_1h} / {inspectedCell.predictionInput.rainfall_3h}{' '}
                    <span className="text-xs text-slate-400">mm</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5 tabular-nums">
                    6h: {inspectedCell.predictionInput.rainfall_6h}mm · 24h: {inspectedCell.predictionInput.rainfall_24h}mm
                  </div>
                </div>
              </div>

              {/* Top 3-5 Drivers List */}
              <div className="p-3 bg-[#0D1320] border border-slate-800/90 space-y-2">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-slate-300 font-semibold">Top drivers</span>
                  <span className="text-slate-500 text-[10.5px]">Weighted Model Impact</span>
                </div>
                <div className="space-y-1.5">
                  {inspectedCell.topDrivers.map((d) => (
                    <div
                      key={d.factor}
                      className="p-2 bg-[#080C14] border border-slate-800/80 text-xs"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <span
                          className={
                            d.direction === 'aggravating'
                              ? 'text-amber-300 font-semibold'
                              : 'text-emerald-300 font-semibold'
                          }
                        >
                          {d.factor}
                        </span>
                        <span className="text-slate-400 tabular-nums">{d.weight}% wt</span>
                      </div>
                      <p className="text-slate-400 text-[11px] mt-0.5 leading-relaxed">
                        {d.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Interactive "Why this warning?" Feature Vector & Hysteresis Inspector */}
              <div className="p-3 bg-[#0B111D] border border-cyan-500/40 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between text-cyan-300 font-semibold">
                  <span>WHY THIS WARNING? ({inspectedCell.warningLevel})</span>
                  <span className="text-[10px] text-slate-400">
                    {defaultPredictionEngine.modelVersion}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  {WARNING_LEVEL_META[inspectedCell.warningLevel].ruleSummary}.{' '}
                  {inspectedCell.warningHysteresis.rationale}
                </p>

                {inspectedCell.warningHysteresis.isHoldingDeescalation && (
                  <button
                    type="button"
                    onClick={onStepStableTick}
                    className="w-full py-1 px-2 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-amber-200 text-[11px]"
                  >
                    Verify Stable Tick ({stableTicksElapsed}/3) to Allow De-escalation
                  </button>
                )}

                <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-2 border-t border-slate-800 text-[10.5px] text-slate-300 tabular-nums">
                  <div>rainfall_1h: {inspectedCell.predictionInput.rainfall_1h} mm</div>
                  <div>rainfall_3h: {inspectedCell.predictionInput.rainfall_3h} mm</div>
                  <div>rainfall_6h: {inspectedCell.predictionInput.rainfall_6h} mm</div>
                  <div>rainfall_24h: {inspectedCell.predictionInput.rainfall_24h} mm</div>
                  <div>elevation: {inspectedCell.predictionInput.elevation} m</div>
                  <div>slope: {inspectedCell.predictionInput.slope}°</div>
                  <div>flow_accum: {inspectedCell.predictionInput.flow_accumulation}</div>
                  <div>drain_proxy: {inspectedCell.predictionInput.drainage_proxy}</div>
                  <div>impervious: {inspectedCell.predictionInput.imperviousness}</div>
                  <div>hist_score: {inspectedCell.predictionInput.historical_flood_score}</div>
                  <div>road_expos: {inspectedCell.predictionInput.road_exposure}</div>
                  <div>lead_time: {inspectedCell.leadTimeMin} min</div>
                </div>
              </div>

              {/* Nearest Critical Assets & Nearest Shelter */}
              <div className="space-y-2">
                <div className="font-mono text-[11px] text-slate-400">
                  NEAREST CRITICAL ASSETS & DESIGNATED SHELTER
                </div>

                {inspectedCell.nearestCriticalAssetIds.map((assetId) => {
                  const asset = CRITICAL_ASSETS.find((a) => a.id === assetId);
                  if (!asset) return null;
                  return (
                    <div
                      key={asset.id}
                      className="flex items-center justify-between p-2 bg-[#0D1320] border border-slate-800/80 text-xs"
                    >
                      <div>
                        <div className="text-slate-200 font-medium">✚ {asset.name}</div>
                        <div className="font-mono text-[10.5px] text-slate-400">
                          {asset.category} · Elev {asset.elevationM}m MSL
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelectTarget({ type: 'ASSET', id: asset.id })}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono text-[11px] whitespace-nowrap"
                      >
                        Inspect
                      </button>
                    </div>
                  );
                })}

                {(() => {
                  const shelter = shelters.find((s) => s.id === inspectedCell.nearestShelterId);
                  if (!shelter) return null;
                  return (
                    <div className="flex items-center justify-between p-2.5 bg-emerald-950/20 border border-emerald-500/40 text-xs">
                      <div>
                        <div className="text-emerald-300 font-medium">
                          ▲ Nearest Shelter: {shelter.name}
                        </div>
                        <div className="font-mono text-[10.5px] text-slate-300 tabular-nums mt-0.5">
                          Occupancy: {shelter.currentOccupancy}/{shelter.totalCapacity} · Elev {shelter.elevationM}m MSL
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigateTab('evacuation')}
                        className="px-2.5 py-1 bg-emerald-900/60 hover:bg-emerald-800/70 border border-emerald-500/50 text-emerald-200 font-mono text-[11px] whitespace-nowrap"
                      >
                        Evac Plan
                      </button>
                    </div>
                  );
                })()}
              </div>

              <ProvenanceStrip provenance={inspectedCell} />
            </div>
          )}

          {/* 2. ROAD SEGMENT INSPECTION */}
          {inspectedRoad && (
            <div className="p-4 space-y-4 flex-1">
              <div className="border-b border-slate-800/80 pb-3">
                <div className="font-mono text-xs text-slate-400">
                  {inspectedRoad.id} · {inspectedRoad.corridorType} · {inspectedRoad.lengthKm} km
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5">
                  {inspectedRoad.name}
                </h3>
                <div className="mt-2">
                  <RoadStateIndicator state={inspectedRoad.currentState} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">FLOOD PROBABILITY</div>
                  <div className="text-xl font-mono font-semibold text-white tabular-nums mt-0.5">
                    {Math.round(inspectedRoad.floodProbability * 100)}%
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Est. Water Depth: <span className="text-slate-200">{inspectedRoad.estimatedWaterDepthCm} cm</span>
                  </div>
                </div>

                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">LAST UPDATE & CONF</div>
                  <div className="text-lg font-mono font-semibold text-cyan-300 tabular-nums mt-0.5">
                    {Math.round(inspectedRoad.confidence * 100)}% Conf
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Updated: {inspectedRoad.lastUpdate}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[#0D1320] border border-slate-800/90 text-xs space-y-1.5">
                <div className="font-mono text-[11px] text-slate-400">
                  EVIDENCE & SENSOR VERIFICATION CHAIN
                </div>
                <ul className="space-y-1.5 text-slate-300 text-[11.5px] list-disc pl-4">
                  {inspectedRoad.evidence.map((ev, i) => (
                    <li key={i} className="leading-relaxed">
                      {ev}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-3 bg-[#0D1320] border border-slate-800/90 text-xs space-y-1.5">
                <div className="font-mono text-[11px] text-slate-400">
                  OPERATIONAL ROUTE IMPACT
                </div>
                <p className="text-slate-200 text-[11.5px] leading-relaxed">
                  {inspectedRoad.routeImpact}
                </p>
                <div className="pt-1.5 border-t border-slate-800/80 text-[11px] text-cyan-300 font-mono">
                  Advisory: {inspectedRoad.alternativeSummary}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateTab('roads-routing')}
                  className="flex-1 py-2 px-3 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-500/50 text-cyan-200 font-mono text-xs transition-colors whitespace-nowrap"
                >
                  Open Dynamic Reroute Solver
                </button>
              </div>

              <ProvenanceStrip provenance={inspectedRoad} />
            </div>
          )}

          {/* 3. SENSOR NODE INSPECTION */}
          {inspectedSensor && (
            <div className="p-4 space-y-4 flex-1">
              <div className="border-b border-slate-800/80 pb-3">
                <div className="font-mono text-xs text-slate-400">
                  {inspectedSensor.id} · {inspectedSensor.type} · Host Cell {inspectedSensor.cellId}
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5">
                  {inspectedSensor.name}
                </h3>
                <div className="mt-1 font-mono text-xs text-cyan-300">
                  Status: {inspectedSensor.status} · Heartbeat {inspectedSensor.lastHeartbeatSecAgo}s ago
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">CURRENT READING</div>
                  <div className="text-xl font-mono font-semibold text-white tabular-nums mt-0.5">
                    {inspectedSensor.currentValue}{' '}
                    <span className="text-xs text-slate-400">{inspectedSensor.unit}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Warn: {inspectedSensor.warningThreshold} · Crit: {inspectedSensor.criticalThreshold}
                  </div>
                </div>

                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">PACKET & BATTERY</div>
                  <div className="text-xl font-mono font-semibold text-emerald-300 tabular-nums mt-0.5">
                    {inspectedSensor.packetSuccessRatePct}%
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Battery: {inspectedSensor.batteryPct}%
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onSelectTarget({ type: 'CELL', id: inspectedSensor.cellId })}
                className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs whitespace-nowrap"
              >
                Inspect Host Grid Cell ({inspectedSensor.cellId})
              </button>

              <ProvenanceStrip provenance={inspectedSensor} />
            </div>
          )}

          {/* 4. SHELTER INSPECTION */}
          {inspectedShelter && (
            <div className="p-4 space-y-4 flex-1">
              <div className="border-b border-slate-800/80 pb-3">
                <div className="font-mono text-xs text-slate-400">
                  {inspectedShelter.id} · Ward {inspectedShelter.ward} · Elev {inspectedShelter.elevationM}m MSL
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5">
                  {inspectedShelter.name}
                </h3>
                <div className="mt-1 font-mono text-xs text-emerald-300">
                  Status: {inspectedShelter.status} · Medical Team: {inspectedShelter.medicalTeamPresent ? 'On-Site' : 'Standby'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">OCCUPANCY</div>
                  <div className="text-xl font-mono font-semibold text-white tabular-nums mt-0.5">
                    {inspectedShelter.currentOccupancy} / {inspectedShelter.totalCapacity}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Available Berths: {inspectedShelter.totalCapacity - inspectedShelter.currentOccupancy}
                  </div>
                </div>
                <div className="p-2.5 bg-[#0D1320] border border-slate-800/90">
                  <div className="text-[11px] font-mono text-slate-400">WATER RESERVE</div>
                  <div className="text-xl font-mono font-semibold text-cyan-300 tabular-nums mt-0.5">
                    {(inspectedShelter.drinkingWaterLiters / 1000).toFixed(1)}k L
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    Access Corridor: {inspectedShelter.accessRoadId}
                  </div>
                </div>
              </div>

              <ProvenanceStrip provenance={inspectedShelter} />
            </div>
          )}

          {/* 5. CRITICAL ASSET INSPECTION */}
          {inspectedAsset && (
            <div className="p-4 space-y-4 flex-1">
              <div className="border-b border-slate-800/80 pb-3">
                <div className="font-mono text-xs text-slate-400">
                  {inspectedAsset.id} · {inspectedAsset.category} · {inspectedAsset.criticalityLevel}
                </div>
                <h3 className="text-base font-semibold text-white mt-0.5">
                  {inspectedAsset.name}
                </h3>
                <div className="mt-1 font-mono text-xs text-slate-300">
                  Elevation: {inspectedAsset.elevationM}m MSL · Backup Power: {inspectedAsset.backupPowerHours}h
                </div>
              </div>
              <div className="p-3 bg-[#0D1320] border border-slate-800 text-xs space-y-1">
                <div className="font-mono text-slate-400">EMERGENCY CONTACT DESK</div>
                <div className="text-slate-200">{inspectedAsset.contactRole}</div>
                <div className="font-mono text-slate-400 pt-2">LINKED ACCESS ROADS</div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {inspectedAsset.accessRoadIds.map((rId) => (
                    <button
                      key={rId}
                      type="button"
                      onClick={() => onSelectTarget({ type: 'ROAD', id: rId })}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono text-[11px]"
                    >
                      {rId}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pinned Active Route Recommendation Summary ("Recommended under current data") */}
      {activeRoute && (
        <div className="p-3.5 bg-[#070B12] border-t border-slate-800/90 text-xs shrink-0">
          <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
            <span className="text-cyan-300 font-semibold">
              CORRIDOR: {activeRoute.recommendationStatusLabel.toUpperCase()}
            </span>
            <span className="text-slate-400 tabular-nums">
              ETA {activeRoute.recommendedEtaMin}m ({activeRoute.recommendedDistanceKm} km)
            </span>
          </div>
          <div className="text-slate-200 font-medium mt-1">
            {activeRoute.originName} → {activeRoute.destinationName}
          </div>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            {activeRoute.safetyAdvisory}
          </p>
          <ProvenanceStrip
            provenance={activeRoute}
            expiry={activeRoute.expiry}
            compact
          />
        </div>
      )}
    </aside>
  );
};
