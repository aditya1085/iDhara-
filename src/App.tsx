import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ContextInspectorPanel } from './components/ContextInspectorPanel';
import { DisasterTwinWorkspace } from './components/DisasterTwinWorkspace';
import { IndoreFloodMap, MapInspectionTarget } from './components/IndoreFloodMap';
import { ModuleWorkspace } from './components/ModuleWorkspaces';
import { MODE_META, SEVERITY_META, WARNING_LEVEL_META } from './components/SeverityVisuals';
import { PILOT_SCOPE_ID } from './data/indorePilotData';
import { generateOperationalAlerts } from './modules/alerts';
import {
  DEFAULT_INJECTED_OBSERVATIONS,
  ingestSensorTelemetry,
  wrapInEnvelope,
} from './modules/dataIngestion';
import { evaluateDataHealth } from './modules/dataQuality';
import { evaluateSheltersAndEvacuation } from './modules/evacuation';
import { getPresetById, resolveTimelineStepParameters } from './modules/historicalReplay';
import { predictFloodRiskGrid } from './modules/prediction';
import { evaluateRoadNetworkState } from './modules/roadState';
import { computeRouteRecommendations } from './modules/routing';
import { generateValidationReport } from './modules/validation';
import {
  ActivityFeedEntry,
  DisasterStage,
  FloodSeverity,
  InjectedObservationState,
  NavigationTab,
  ObservationInjectionType,
  ProductMode,
  RoadStatus,
  ScenarioParameters,
  UserRole,
  WarningLevel,
} from './types/idhara';

const NAV_ITEMS: Array<{ id: NavigationTab; label: string; shortBadge?: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'risk-map', label: 'Risk Map' },
  { id: 'disaster-twin', label: 'Disaster Twin', shortBadge: '4-Stage' },
  { id: 'roads-routing', label: 'Roads & Routing' },
  { id: 'evacuation', label: 'Evacuation' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'event-replay', label: 'Event Replay' },
  { id: 'validation', label: 'Validation' },
  { id: 'data-health', label: 'Data Health' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<NavigationTab>('overview');
  const [activeRole, setActiveRole] = useState<UserRole>(UserRole.CONTROL_ROOM_OPERATOR);

  const [params, setParams] = useState<ScenarioParameters>({
    mode: ProductMode.SIMULATED,
    stage: DisasterStage.REAL_TIME_ONGOING,
    rainfallIntensityMmHr: 42,
    durationHours: 3,
    drainageBlockagePct: 40,
    upstreamKahnInflowMultiplier: 1.25,
    sensorDropoutCount: 0,
    timelineHourOffset: 0,
    activeEventPresetId: 'EVT-SIM-MONSOON-SURGE',
  });

  // Hysteresis state tracking across ticks
  const previousWarningsRef = useRef<Map<string, WarningLevel>>(new Map());
  const previousRoadStatesRef = useRef<Map<string, RoadStatus>>(new Map());
  const prevRainRef = useRef<number>(params.rainfallIntensityMmHr);
  const [stableTicksElapsed, setStableTicksElapsed] = useState<number>(3);

  // Real-time injected observations state (Live Feed Simulator)
  const [injectedObservations, setInjectedObservations] =
    useState<InjectedObservationState>(DEFAULT_INJECTED_OBSERVATIONS);

  const [activityFeed, setActivityFeed] = useState<ActivityFeedEntry[]>([
    {
      id: 'ACT-INIT-1',
      timestamp: '18:42:15',
      category: 'ROAD_STATE',
      message: 'RD-05 (MG Road Krishnapura Bridge) state: CLOSED',
      detail: 'Road graph updated · Emergency ambulance routes recalculated via elevated Regal–Palasia corridor.',
      severity: 'CRITICAL',
      relatedTarget: { type: 'ROAD', id: 'RD-05' },
    },
    {
      id: 'ACT-INIT-2',
      timestamp: '18:41:56',
      category: 'SENSOR',
      message: 'SEN-WL-04 (Water Sensor C · Sarwate): SUSPECT',
      detail: 'Abnormal ultrasonic spike (+0.48m jump) flagged by telemetry quality filter.',
      severity: 'WARNING',
      relatedTarget: { type: 'SENSOR', id: 'SEN-WL-04' },
    },
    {
      id: 'ACT-INIT-3',
      timestamp: '18:34:15',
      category: 'SENSOR',
      message: 'SEN-WL-05 (Water Sensor B · Harsiddhi): STALE',
      detail: 'Last seen 8 minutes ago · Local confidence adjusted in cell CELL-R5C2.',
      severity: 'WARNING',
      relatedTarget: { type: 'SENSOR', id: 'SEN-WL-05' },
    },
    {
      id: 'ACT-INIT-4',
      timestamp: '18:41:33',
      category: 'SENSOR',
      message: 'SEN-RG-01 (Rain Gauge A · Rajwada): FRESH',
      detail: 'Last seen 42 seconds ago · 42.0 mm/h verified.',
      severity: 'INFO',
      relatedTarget: { type: 'SENSOR', id: 'SEN-RG-01' },
    },
  ]);

  const updateParamsWithHysteresis = (
    updater: (prev: ScenarioParameters) => ScenarioParameters
  ) => {
    setParams((prev) => {
      const next = updater(prev);
      if (next.rainfallIntensityMmHr < prev.rainfallIntensityMmHr) {
        // De-escalation requires 3 stable ticks; start at tick 1
        setStableTicksElapsed(1);
      } else if (next.rainfallIntensityMmHr > prev.rainfallIntensityMmHr) {
        // Escalation happens immediately
        setStableTicksElapsed(3);
      }
      prevRainRef.current = next.rainfallIntensityMmHr;
      return next;
    });
  };

  const handleStepStableTick = () => {
    setStableTicksElapsed((prev) => Math.min(3, prev + 1));
  };

  const [selectedTarget, setSelectedTarget] = useState<MapInspectionTarget>({
    type: 'CELL',
    id: 'CELL-R2C2', // Krishnapura Confluence hotspot
  });

  const [customOriginId, setCustomOriginId] = useState<string>('NODE-RAJWADA');
  const [customDestId, setCustomDestId] = useState<string>('NODE-MY-HOSPITAL');
  const [selectedRouteId, setSelectedRouteId] = useState<string>('RTE-AMB-RAJWADA-MYH');
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());
  const [isPlayingTimeline, setIsPlayingTimeline] = useState<boolean>(false);

  // Modular Service Pipeline Execution (every injected observation enters this same pipeline)
  const sensors = useMemo(
    () => ingestSensorTelemetry(params, injectedObservations),
    [params, injectedObservations]
  );

  const cells = useMemo(() => {
    const computed = predictFloodRiskGrid(
      params,
      sensors,
      previousWarningsRef.current,
      stableTicksElapsed,
      injectedObservations
    );
    // Record peak effective warnings when stable or escalating
    if (stableTicksElapsed >= 3) {
      const nextMap = new Map<string, WarningLevel>();
      computed.forEach((c) => nextMap.set(c.id, c.warningLevel));
      previousWarningsRef.current = nextMap;
    }
    return computed;
  }, [params, sensors, stableTicksElapsed, injectedObservations]);

  const roads = useMemo(() => {
    const computedRoads = evaluateRoadNetworkState(
      cells,
      sensors,
      params,
      injectedObservations,
      previousRoadStatesRef.current,
      stableTicksElapsed
    );
    if (stableTicksElapsed >= 3) {
      const nextRoadMap = new Map<string, RoadStatus>();
      computedRoads.forEach((r) => nextRoadMap.set(r.id, r.currentState));
      previousRoadStatesRef.current = nextRoadMap;
    }
    return computedRoads;
  }, [cells, sensors, params, injectedObservations, stableTicksElapsed]);

  const routes = useMemo(
    () => computeRouteRecommendations(roads, params, customOriginId, customDestId),
    [roads, params, customOriginId, customDestId]
  );

  // Track road state transitions and route recalculations in real time
  const prevClosedIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const currentClosed = new Set(
      roads.filter((r) => r.currentState === RoadStatus.CLOSED).map((r) => r.id)
    );
    if (prevClosedIdsRef.current === null) {
      prevClosedIdsRef.current = currentClosed;
      return;
    }

    const newlyClosed = roads.filter(
      (r) =>
        r.currentState === RoadStatus.CLOSED &&
        !prevClosedIdsRef.current?.has(r.id)
    );
    const newlyOpened = roads.filter(
      (r) =>
        r.currentState !== RoadStatus.CLOSED &&
        prevClosedIdsRef.current?.has(r.id)
    );

    if (newlyClosed.length > 0 || newlyOpened.length > 0) {
      const nowStr = new Date().toTimeString().slice(0, 8);
      const newEntries: ActivityFeedEntry[] = [];

      newlyClosed.forEach((r) => {
        const affectedRoutes = routes.filter((rt) =>
          rt.baselineShortestRoadIds.includes(r.id)
        );
        newEntries.push({
          id: `ACT-RD-CLOSE-${r.id}-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROUTING',
          message: `ROAD CLOSED: ${r.id} (${r.name}) removed from road graph`,
          detail:
            affectedRoutes.length > 0
              ? `Recalculated ${affectedRoutes.length} route(s) (${affectedRoutes
                  .map((rt) => `${rt.originName}→${rt.destinationName} now ${rt.recommendedEtaMin}m`)
                  .join('; ')})`
              : `Road graph updated · Traffic diverted around ${r.id} (~${r.estimatedWaterDepthCm}cm depth).`,
          severity: 'CRITICAL',
          relatedTarget: { type: 'ROAD', id: r.id },
        });
      });

      newlyOpened.forEach((r) => {
        newEntries.push({
          id: `ACT-RD-OPEN-${r.id}-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROAD_STATE',
          message: `ROAD REOPENED / DE-ESCALATED: ${r.id} (${r.name}) → ${r.currentState}`,
          detail: `Restored to active road graph · Route recommendations updated.`,
          severity: 'SUCCESS',
          relatedTarget: { type: 'ROAD', id: r.id },
        });
      });

      setActivityFeed((prev) => [...newEntries, ...prev].slice(0, 25));
    }

    prevClosedIdsRef.current = currentClosed;
  }, [roads, routes]);

  const handleInjectObservation = (
    type: ObservationInjectionType,
    targetId: string
  ) => {
    const nowStr = new Date().toTimeString().slice(0, 8);

    if (type === 'RAINFALL_INCREASE') {
      setStableTicksElapsed(3);
      setInjectedObservations((prev) => ({
        ...prev,
        extraRainfallMmHr: prev.extraRainfallMmHr + 8,
      }));
      setActivityFeed((prev) =>
        [
          {
            id: `ACT-INJ-${Date.now()}`,
            timestamp: nowStr,
            category: 'PREDICTION' as const,
            message: `Injected +8 mm/h Rainfall Burst across Indore pilot gauges`,
            detail: `Re-evaluating 64-cell flood probabilities, road states, and route recommendations.`,
            severity: 'WARNING' as const,
            relatedTarget: { type: 'SENSOR' as const, id: targetId },
          },
          ...prev,
        ].slice(0, 25)
      );
    } else if (type === 'WATER_LEVEL_INCREASE') {
      setStableTicksElapsed(3);
      const sensorObj = sensors.find((s) => s.id === targetId);
      setInjectedObservations((prev) => {
        const nextFailures = { ...prev.sensorFailureState };
        delete nextFailures[targetId];
        return {
          ...prev,
          sensorFailureState: nextFailures,
          sensorWaterLevelBoostM: {
            ...prev.sensorWaterLevelBoostM,
            [targetId]: Number(
              ((prev.sensorWaterLevelBoostM[targetId] ?? 0) + 0.45).toFixed(2)
            ),
          },
        };
      });
      setSelectedTarget({ type: 'SENSOR', id: targetId });
      setActivityFeed((prev) =>
        [
          {
            id: `ACT-INJ-${Date.now()}`,
            timestamp: nowStr,
            category: 'SENSOR' as const,
            message: `Injected +0.45m Water-Level Surge at ${targetId} (${sensorObj?.name ?? 'Gauge'})`,
            detail: `Propagating ultrasonic stage rise to host cell ${sensorObj?.cellId ?? ''} and adjacent bridge corridors.`,
            severity: 'CRITICAL' as const,
            relatedTarget: { type: 'SENSOR' as const, id: targetId },
          },
          ...prev,
        ].slice(0, 25)
      );
    } else if (type === 'ROAD_CLOSURE') {
      setStableTicksElapsed(3);
      const roadObj = roads.find((r) => r.id === targetId);
      setInjectedObservations((prev) => ({
        ...prev,
        officialRoadOverrides: {
          ...prev.officialRoadOverrides,
          [targetId]: 'CLOSED',
        },
      }));
      setSelectedTarget({ type: 'ROAD', id: targetId });
      setActivityFeed((prev) =>
        [
          {
            id: `ACT-INJ-${Date.now()}`,
            timestamp: nowStr,
            category: 'ROAD_STATE' as const,
            message: `Official Road Closure Injected: ${targetId} (${roadObj?.name ?? ''})`,
            detail: `Transitioned to CLOSED · Triggering road graph update and Dijkstra route recalculation.`,
            severity: 'CRITICAL' as const,
            relatedTarget: { type: 'ROAD' as const, id: targetId },
          },
          ...prev,
        ].slice(0, 25)
      );
    } else if (type === 'ROAD_REOPENED') {
      const roadObj = roads.find((r) => r.id === targetId);
      setInjectedObservations((prev) => {
        const nextCrowd = { ...prev.crowdReportsByRoad };
        delete nextCrowd[targetId];
        return {
          ...prev,
          officialRoadOverrides: {
            ...prev.officialRoadOverrides,
            [targetId]: 'OPEN',
          },
          crowdReportsByRoad: nextCrowd,
        };
      });
      setSelectedTarget({ type: 'ROAD', id: targetId });
      setActivityFeed((prev) =>
        [
          {
            id: `ACT-INJ-${Date.now()}`,
            timestamp: nowStr,
            category: 'ROAD_STATE' as const,
            message: `Official Clearance Injected: ${targetId} (${roadObj?.name ?? ''}) REOPENED`,
            detail: `Corridor restored to OPEN state in road graph · Active routes updated.`,
            severity: 'SUCCESS' as const,
            relatedTarget: { type: 'ROAD' as const, id: targetId },
          },
          ...prev,
        ].slice(0, 25)
      );
    } else if (type === 'CROWD_REPORT') {
      const roadObj = roads.find((r) => r.id === targetId);
      setInjectedObservations((prev) => {
        const existing = prev.crowdReportsByRoad[targetId]?.count ?? 0;
        const nextCount = existing + 1;
        return {
          ...prev,
          crowdReportsByRoad: {
            ...prev.crowdReportsByRoad,
            [targetId]: {
              count: nextCount,
              lastReportText:
                nextCount >= 2
                  ? 'Multiple citizens report axle-deep water (>35cm) stalling two-wheelers'
                  : 'Citizen geo-tagged photo of rapid curb overtopping',
              timestamp: nowStr,
            },
          },
        };
      });
      setSelectedTarget({ type: 'ROAD', id: targetId });
      setActivityFeed((prev) =>
        [
          {
            id: `ACT-INJ-${Date.now()}`,
            timestamp: nowStr,
            category: 'CROWD' as const,
            message: `Crowd Report Injected on ${targetId} (${roadObj?.name ?? ''})`,
            detail: `Corroborating observation fused into Road State Machine (multi-source agreement check).`,
            severity: 'WARNING' as const,
            relatedTarget: { type: 'ROAD' as const, id: targetId },
          },
          ...prev,
        ].slice(0, 25)
      );
    } else if (type === 'SENSOR_FAILURE') {
      const sensorObj = sensors.find((s) => s.id === targetId);
      setInjectedObservations((prev) => {
        const currentFail = prev.sensorFailureState[targetId];
        const nextFail: 'STALE' | 'SUSPECT' | 'MISSING' =
          currentFail === 'STALE'
            ? 'SUSPECT'
            : currentFail === 'SUSPECT'
            ? 'MISSING'
            : 'MISSING';
        return {
          ...prev,
          sensorFailureState: {
            ...prev.sensorFailureState,
            [targetId]: nextFail,
          },
        };
      });
      setSelectedTarget({ type: 'SENSOR', id: targetId });
      setActivityFeed((prev) =>
        [
          {
            id: `ACT-INJ-${Date.now()}`,
            timestamp: nowStr,
            category: 'SENSOR' as const,
            message: `Sensor Failure Injected: ${targetId} (${sensorObj?.name ?? ''}) → MISSING`,
            detail: `Telemetry heartbeat lost · Local cell confidence reduced and uncertainty band widened.`,
            severity: 'WARNING' as const,
            relatedTarget: { type: 'SENSOR' as const, id: targetId },
          },
          ...prev,
        ].slice(0, 25)
      );
    }
  };

  const handleResetObservations = () => {
    setInjectedObservations(DEFAULT_INJECTED_OBSERVATIONS);
    setStableTicksElapsed(3);
    const nowStr = new Date().toTimeString().slice(0, 8);
    setActivityFeed((prev) =>
      [
        {
          id: `ACT-RESET-${Date.now()}`,
          timestamp: nowStr,
          category: 'SYSTEM' as const,
          message: 'Live Feed Simulator reset to baseline Indore pilot telemetry',
          detail: 'Cleared injected closures, crowd reports, and rainfall surges.',
          severity: 'INFO' as const,
        },
        ...prev,
      ].slice(0, 25)
    );
  };

  const activeRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? routes[0] ?? null,
    [routes, selectedRouteId]
  );

  const { shelters, evacuationPlans } = useMemo(
    () => evaluateSheltersAndEvacuation(cells, params),
    [cells, params]
  );

  const alerts = useMemo(
    () => generateOperationalAlerts(cells, roads, sensors, params, acknowledgedAlerts),
    [cells, roads, sensors, params, acknowledgedAlerts]
  );

  const validationReport = useMemo(
    () => generateValidationReport(cells, params),
    [cells, params]
  );

  const dataHealthReport = useMemo(
    () => evaluateDataHealth(sensors, params),
    [sensors, params]
  );

  const systemEnvelope = useMemo(
    () =>
      wrapInEnvelope(
        { cellCount: cells.length, roadCount: roads.length },
        params.mode,
        dataHealthReport.confidence,
        params.timelineHourOffset
      ),
    [params.mode, dataHealthReport.confidence, params.timelineHourOffset, cells.length, roads.length]
  );

  // Overall Pilot Risk Level & Warning Level derived from current cell predictions
  const { overallPilotRisk, overallWarningLevel } = useMemo(() => {
    const critCount = cells.filter((c) => c.severity === FloodSeverity.CRITICAL).length;
    const highCount = cells.filter((c) => c.severity === FloodSeverity.HIGH).length;
    const redCount = cells.filter((c) => c.warningLevel === WarningLevel.RED).length;
    const orangeCount = cells.filter((c) => c.warningLevel === WarningLevel.ORANGE).length;

    let risk = FloodSeverity.LOW;
    if (critCount >= 4) risk = FloodSeverity.CRITICAL;
    else if (critCount >= 1 || highCount >= 4) risk = FloodSeverity.HIGH;
    else if (highCount >= 1) risk = FloodSeverity.MODERATE;

    let warn = WarningLevel.GREEN;
    if (redCount >= 2) warn = WarningLevel.RED;
    else if (redCount >= 1 || orangeCount >= 2) warn = WarningLevel.ORANGE;
    else if (orangeCount >= 1 || highCount >= 1) warn = WarningLevel.YELLOW;

    return { overallPilotRisk: risk, overallWarningLevel: warn };
  }, [cells]);

  // Timeline Autoplay Handler
  useEffect(() => {
    if (!isPlayingTimeline) return;
    const timer = window.setInterval(() => {
      updateParamsWithHysteresis((prev) => {
        const nextHour = prev.timelineHourOffset >= 4 ? -3 : prev.timelineHourOffset + 1;
        return resolveTimelineStepParameters(prev, nextHour);
      });
    }, 2200);
    return () => window.clearInterval(timer);
  }, [isPlayingTimeline]);

  const handleAcknowledgeAlert = (id: string) => {
    setAcknowledgedAlerts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleChangeCustomRoute = (originId: string, destId: string) => {
    setCustomOriginId(originId);
    setCustomDestId(destId);
    if (originId !== destId) {
      setSelectedRouteId(`RTE-CUSTOM-${originId}-${destId}`);
    }
  };

  const modeMeta = MODE_META[params.mode];
  const riskMeta = SEVERITY_META[overallPilotRisk];
  const warnMeta = WARNING_LEVEL_META[overallWarningLevel];
  const activePreset = getPresetById(params.activeEventPresetId);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#070A10] text-slate-100 overflow-hidden">
      {/* 1. TOP COMMAND & STATUS BAR */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2 bg-[#0A0F1A] border-b border-slate-800/90 shrink-0">
        {/* Left: iDhara Brand & Tagline */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-6 bg-cyan-400" />
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold tracking-tight text-white">
                  iDhara
                </span>
                <span className="text-xs text-cyan-300 font-medium whitespace-nowrap">
                  From Prediction to Protection.
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Center: Unmistakable Mode Switcher + Core Command Telemetry */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 font-mono text-xs tabular-nums">
          {/* Impossible-to-miss Mode Badge & Switcher */}
          <div className="flex items-center gap-1 bg-[#05080F] p-1 border border-slate-700/90">
            {(
              [
                ProductMode.SIMULATED,
                ProductMode.HISTORICAL,
                ProductMode.MOCK,
                ProductMode.LIVE,
              ] as ProductMode[]
            ).map((m) => {
              const active = params.mode === m;
              const mMeta = MODE_META[m];
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setParams((prev) => ({ ...prev, mode: m }))}
                  className={`px-2.5 py-0.5 text-xs font-bold transition-colors whitespace-nowrap ${
                    active
                      ? `${mMeta.bgClass} ${mMeta.accentText} border ${mMeta.borderClass}`
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ● {m}
                </button>
              );
            })}
          </div>

          <span className="text-slate-600" aria-hidden="true">·</span>

          <span className="text-slate-200 font-semibold whitespace-nowrap">
            Indore Pilot
          </span>

          <span className="text-slate-600" aria-hidden="true">·</span>

          <span className="whitespace-nowrap">
            <span className="text-slate-400">Rainfall </span>
            <span className="text-sky-300 font-semibold">
              {params.rainfallIntensityMmHr + injectedObservations.extraRainfallMmHr} mm/h
            </span>
          </span>

          <span className="text-slate-600" aria-hidden="true">·</span>

          <span className="whitespace-nowrap">
            <span className="text-slate-400">Risk: </span>
            <span className={`font-semibold ${riskMeta.textColor}`}>
              {riskMeta.glyph} {overallPilotRisk}
            </span>
          </span>

          <span className="text-slate-600" aria-hidden="true">·</span>

          <span className="whitespace-nowrap">
            <span className="text-slate-400">Warning: </span>
            <span className={`font-bold ${warnMeta.textColor}`}>
              {warnMeta.glyph} {overallWarningLevel}
            </span>
          </span>

          <span className="text-slate-600" aria-hidden="true">·</span>

          <span className="whitespace-nowrap">
            <span className="text-slate-400">Data confidence: </span>
            <span className="text-cyan-300 font-semibold">
              {Math.round(dataHealthReport.confidence * 100)}%
            </span>
          </span>

          <span className="hidden lg:inline text-slate-600" aria-hidden="true">·</span>

          <span className="hidden lg:inline whitespace-nowrap">
            <span className="text-slate-400">Updated </span>
            <span className="text-slate-200">
              {systemEnvelope.data_as_of.slice(11, 19)}
            </span>
          </span>

          <span className="hidden xl:inline text-slate-600" aria-hidden="true">·</span>

          {/* System Health Indicator */}
          <button
            type="button"
            onClick={() => setActiveTab('data-health')}
            className="hidden xl:inline-flex items-center gap-1.5 whitespace-nowrap hover:underline"
            title="Inspect Sensor & Data Health"
          >
            <span
              className={
                dataHealthReport.overallHealthPct >= 85
                  ? 'text-emerald-400 font-semibold'
                  : 'text-amber-400 font-semibold'
              }
            >
              {dataHealthReport.overallHealthPct >= 85 ? '● NOMINAL' : '▲ DEGRADED'} (
              {dataHealthReport.overallHealthPct}%)
            </span>
          </button>
        </div>

        {/* Right: Operator Role Lens */}
        <div className="flex items-center gap-2 font-mono text-xs">
          <select
            id="operator-role-select"
            aria-label="Operator Role Perspective"
            value={activeRole}
            onChange={(e) => setActiveRole(e.target.value as UserRole)}
            className="bg-[#0D1320] border border-slate-700 text-slate-200 px-2 py-1 text-xs font-mono"
          >
            {Object.values(UserRole).map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* PROMINENT MODE DISCLOSURE BAR */}
      <div
        className={`px-4 py-1 border-b ${modeMeta.borderClass} ${modeMeta.bgClass} flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] shrink-0`}
      >
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${modeMeta.accentText}`}>
            {modeMeta.indicatorSymbol} {params.mode} MODE ACTIVE
          </span>
          <span className="text-slate-400">—</span>
          <span className="text-slate-200">{systemEnvelope.disclaimer}</span>
        </div>
        <div className="text-slate-400 tabular-nums">
          Scope: {PILOT_SCOPE_ID} · Stage: {params.stage.replace(/_/g, ' ')}
        </div>
      </div>

      {/* MAIN WORKSPACE: 2. LEFT NAV RAIL + 3. CENTRAL GEOSPATIAL MAP + 4. RIGHT INTELLIGENCE PANEL */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 2. LEFT NAVIGATION RAIL */}
        <nav
          aria-label="Primary Control Room Navigation"
          className="w-48 xl:w-52 shrink-0 bg-[#090D16] border-r border-slate-800/90 flex flex-col justify-between overflow-y-auto"
        >
          <div className="p-2.5 space-y-1">
            <div className="px-2.5 py-1.5 font-mono text-[10.5px] text-slate-400">
              CONTROL ROOM NAV
            </div>
            {NAV_ITEMS.map((item) => {
              const isActive = activeTab === item.id;
              const unackCount =
                item.id === 'alerts'
                  ? alerts.filter((a) => !a.acknowledged).length
                  : 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-cyan-950/50 text-cyan-300 border-l-2 border-cyan-400'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                  {unackCount > 0 ? (
                    <span className="font-mono text-[10px] text-amber-300">
                      {unackCount} active
                    </span>
                  ) : item.shortBadge ? (
                    <span className="font-mono text-[10px] text-slate-400">
                      {item.shortBadge}
                    </span>
                  ) : null}
                </button>
              );
            })}

            {/* Four-Stage Disaster Twin Quick Switcher */}
            <div className="pt-3 mt-3 border-t border-slate-800/80">
              <div className="px-2.5 py-1 font-mono text-[10.5px] text-slate-400">
                DISASTER TWIN STAGE
              </div>
              {(
                [
                  { st: DisasterStage.EARLY_WARNING, label: '1. Early Warning' },
                  { st: DisasterStage.PRE_DISASTER_SCENARIO, label: '2. Pre-Disaster Sim' },
                  { st: DisasterStage.REAL_TIME_ONGOING, label: '3. Real-Time Ongoing' },
                  { st: DisasterStage.POST_DISASTER_LEARNING, label: '4. Post-Disaster Learn' },
                ] as const
              ).map((item) => {
                const active = params.stage === item.st;
                return (
                  <button
                    key={item.st}
                    type="button"
                    onClick={() =>
                      updateParamsWithHysteresis((prev) => ({
                        ...prev,
                        stage: item.st,
                      }))
                    }
                    className={`w-full text-left px-3 py-1.5 font-mono text-[11px] transition-colors whitespace-nowrap ${
                      active
                        ? 'text-cyan-300 font-semibold bg-slate-900'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {active ? '▶ ' : '  '}
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-3 border-t border-slate-800/80 bg-[#070B12] font-mono text-[10.5px] text-slate-400 space-y-1">
            <div className="text-slate-200 font-semibold">Indore Pilot (5×5 km)</div>
            <div>Predict the Flood.</div>
            <div>Protect the City.</div>
          </div>
        </nav>

        {/* 3. LARGE CENTRAL GEOSPATIAL MAP + MODULE WORKSPACE */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-[#05080E]">
          {activeTab === 'disaster-twin' ? (
            <DisasterTwinWorkspace
              baselineParams={params}
              selectedTarget={selectedTarget}
              onSelectTarget={setSelectedTarget}
            />
          ) : (
            <>
              <ModuleWorkspace
                activeTab={activeTab}
                params={params}
                onUpdateParams={updateParamsWithHysteresis}
                cells={cells}
                roads={roads}
                sensors={sensors}
                shelters={shelters}
                evacuationPlans={evacuationPlans}
                routes={routes}
                activeRouteId={activeRoute?.id ?? ''}
                onSelectRouteId={setSelectedRouteId}
                customOriginId={customOriginId}
                customDestId={customDestId}
                onChangeCustomRoute={handleChangeCustomRoute}
                alerts={alerts}
                onAcknowledgeAlert={handleAcknowledgeAlert}
                validationReport={validationReport}
                dataHealthReport={dataHealthReport}
                activeRole={activeRole}
                onSelectMapTarget={setSelectedTarget}
                onNavigateTab={setActiveTab}
                activityFeed={activityFeed}
                onInjectObservation={handleInjectObservation}
                onResetObservations={handleResetObservations}
              />

              <div className="flex-1 min-h-[280px] overflow-hidden">
                <IndoreFloodMap
                  mode={params.mode}
                  cells={cells}
                  roads={roads}
                  sensors={sensors}
                  shelters={shelters}
                  activeRoute={activeRoute}
                  selectedTarget={selectedTarget}
                  onSelectTarget={setSelectedTarget}
                />
              </div>
            </>
          )}
        </main>

        {/* 4. RIGHT INTELLIGENCE & ACTION PANEL */}
        <ContextInspectorPanel
          selectedTarget={selectedTarget}
          onSelectTarget={setSelectedTarget}
          cells={cells}
          roads={roads}
          sensors={sensors}
          shelters={shelters}
          evacuationPlans={evacuationPlans}
          alerts={alerts}
          params={params}
          activeRoute={activeRoute}
          activeRole={activeRole}
          onNavigateTab={setActiveTab}
          stableTicksElapsed={stableTicksElapsed}
          onStepStableTick={handleStepStableTick}
          activityFeed={activityFeed}
          onInjectObservation={handleInjectObservation}
          onResetObservations={handleResetObservations}
        />
      </div>

      {/* 5. BOTTOM EVENT TIMELINE (PAST · NOW · NEXT FORECAST PERIOD) */}
      <footer className="px-4 py-2 bg-[#0A0F1A] border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-3 font-mono text-xs shrink-0">
        {/* Timeline Play + Past / Now / Forecast Period Selector */}
        <div className="flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setIsPlayingTimeline((p) => !p)}
            className="px-3 py-1.5 bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-500/60 text-cyan-200 font-semibold whitespace-nowrap transition-colors"
          >
            {isPlayingTimeline ? '❚❚ Pause' : '▶ Auto-Advance'}
          </button>

          <div className="flex items-center gap-1">
            {activePreset.hourlyRainProfile.map((step) => {
              const isCurrent = params.timelineHourOffset === step.hourOffset;
              const periodCategory =
                step.hourOffset < 0
                  ? 'PAST'
                  : step.hourOffset === 0
                  ? 'NOW'
                  : 'FORECAST';

              return (
                <button
                  key={step.hourOffset}
                  type="button"
                  onClick={() => {
                    setIsPlayingTimeline(false);
                    updateParamsWithHysteresis((prev) =>
                      resolveTimelineStepParameters(prev, step.hourOffset)
                    );
                  }}
                  className={`px-2.5 py-1 text-[11px] border transition-colors whitespace-nowrap tabular-nums flex items-center gap-1.5 ${
                    isCurrent
                      ? 'bg-cyan-500/25 border-cyan-400 text-white font-semibold'
                      : step.hourOffset === 0
                      ? 'bg-slate-900 border-slate-700 text-cyan-300 hover:border-slate-500'
                      : 'bg-[#0D1320] border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span
                    className={`text-[9.5px] ${
                      periodCategory === 'NOW'
                        ? 'text-emerald-400 font-bold'
                        : periodCategory === 'FORECAST'
                        ? 'text-amber-300'
                        : 'text-slate-500'
                    }`}
                  >
                    {periodCategory}
                  </span>
                  <span>
                    {step.hourOffset >= 0 ? `T+${step.hourOffset}h` : `T${step.hourOffset}h`}
                  </span>
                  <span className="text-sky-300">({step.mmHr}mm/h)</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Quick Rainfall & Drainage Blockage Scrubber */}
        <div className="flex flex-wrap items-center gap-4 text-[11px]">
          <div className="flex items-center gap-2">
            <label htmlFor="footer-rain-range" className="text-slate-400">
              Rainfall:
            </label>
            <input
              id="footer-rain-range"
              type="range"
              min={10}
              max={95}
              step={2}
              value={params.rainfallIntensityMmHr}
              onChange={(e) => {
                setIsPlayingTimeline(false);
                updateParamsWithHysteresis((p) => ({
                  ...p,
                  mode: ProductMode.SIMULATED,
                  rainfallIntensityMmHr: Number(e.target.value),
                }));
              }}
              className="w-24 accent-cyan-400 cursor-pointer"
            />
            <span className="text-sky-300 font-semibold tabular-nums w-16">
              {params.rainfallIntensityMmHr} mm/h
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="footer-blockage-range" className="text-slate-400">
              Culvert Blockage:
            </label>
            <input
              id="footer-blockage-range"
              type="range"
              min={5}
              max={75}
              step={5}
              value={params.drainageBlockagePct}
              onChange={(e) => {
                setIsPlayingTimeline(false);
                updateParamsWithHysteresis((p) => ({
                  ...p,
                  mode: ProductMode.SIMULATED,
                  drainageBlockagePct: Number(e.target.value),
                }));
              }}
              className="w-20 accent-amber-400 cursor-pointer"
            />
            <span className="text-amber-300 font-semibold tabular-nums w-10">
              {params.drainageBlockagePct}%
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
