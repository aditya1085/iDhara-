import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ContextInspectorPanel } from './components/ContextInspectorPanel';
import { DisasterTwinWorkspace } from './components/DisasterTwinWorkspace';
import { IndoreFloodMap, MapInspectionTarget } from './components/IndoreFloodMap';
import { ModuleWorkspace } from './components/ModuleWorkspaces';
import { MODE_META, SEVERITY_META, WARNING_LEVEL_META } from './components/SeverityVisuals';
import { PILOT_SCOPE_ID } from './data/indorePilotData';
import {
  AlertLifecycleOverride,
  createComposedAlert,
  generateOperationalAlerts,
} from './modules/alerts';
import {
  DEFAULT_INJECTED_OBSERVATIONS,
  ingestSensorTelemetry,
  wrapInEnvelope,
} from './modules/dataIngestion';
import { evaluateDataHealth } from './modules/dataQuality';
import {
  DEFAULT_EVACUATION_CONFIG,
  evaluateSheltersAndEvacuation,
  EvacuationConfig,
} from './modules/evacuation';
import { getPresetById, resolveTimelineStepParameters } from './modules/historicalReplay';
import { predictFloodRiskGrid } from './modules/prediction';
import { evaluateRoadNetworkState } from './modules/roadState';
import {
  computeRouteRecommendations,
  selectDemoIncidentRoad,
  TRAVEL_PROFILE_POLICIES,
} from './modules/routing';
import { generateValidationReport } from './modules/validation';
import {
  ActivityFeedEntry,
  AlertComposerDraftInput,
  AlertItem,
  AlertLifecycleState,
  DisasterStage,
  FloodSeverity,
  InjectedObservationState,
  NavigationTab,
  ObservationInjectionType,
  ProductMode,
  ReplaySpeed,
  RoadStatus,
  RouteUpdateNotification,
  ScenarioParameters,
  TravelProfile,
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
      id: 'ACT-INIT-0',
      timestamp: '18:42:18',
      category: 'ALERT',
      eventTypeLabel: 'Operator approved alert',
      message: 'Published RED — CORRIDOR CLOSURE & REROUTE (Human Confirmed)',
      detail: 'Confirmed by Traffic Control Desk #2 · Barricades active at Krishnapura Bridge & Chandrabhaga Causeway.',
      severity: 'SUCCESS',
      relatedTarget: { type: 'ROAD', id: 'RD-05' },
    },
    {
      id: 'ACT-INIT-0B',
      timestamp: '18:42:16',
      category: 'ALERT',
      eventTypeLabel: 'Alert drafted',
      message: 'Drafted “ORANGE — HIGH FLOOD RISK” for Ward sector W-24 (78% prob)',
      detail: 'Queued in PENDING REVIEW awaiting human confirmation before public dispatch.',
      severity: 'WARNING',
      relatedTarget: { type: 'CELL', id: 'CELL-R2C3' },
    },
    {
      id: 'ACT-INIT-1',
      timestamp: '18:42:15',
      category: 'ROUTING',
      eventTypeLabel: 'Route recalculated',
      message: 'Emergency Ambulance Route recalculated via Regal–Palasia elevated corridor',
      detail: 'Diverted around CLOSED segment RD-05 (MG Road Krishnapura Bridge).',
      severity: 'CRITICAL',
      relatedTarget: { type: 'ROAD', id: 'RD-05' },
    },
    {
      id: 'ACT-INIT-1B',
      timestamp: '18:42:12',
      category: 'ROAD_STATE',
      eventTypeLabel: 'Road changed',
      message: 'RD-05 (MG Road Krishnapura Bridge) transitioned AT_RISK → CLOSED',
      detail: 'Multiple agreeing observations (stage gauge SEN-WL-01 + 88% cell flood probability).',
      severity: 'CRITICAL',
      relatedTarget: { type: 'ROAD', id: 'RD-05' },
    },
    {
      id: 'ACT-INIT-2',
      timestamp: '18:41:56',
      category: 'SENSOR',
      eventTypeLabel: 'Sensor updated',
      message: 'SEN-WL-01 (Krishnapura Bridge Gauge): 3.45m stage (FRESH)',
      detail: 'Ultrasonic river stage rose +0.18m over 15 min; telemetry verified.',
      severity: 'WARNING',
      relatedTarget: { type: 'SENSOR', id: 'SEN-WL-01' },
    },
    {
      id: 'ACT-INIT-4',
      timestamp: '18:41:33',
      category: 'PREDICTION',
      eventTypeLabel: 'Prediction changed',
      message: 'Ward sector W-24 (Krishnapura / MTH) flood probability updated to 78% (HIGH)',
      detail: 'Driven by 42 mm/h rainfall intensity, low elevation (545.2m), and high runoff accumulation.',
      severity: 'WARNING',
      relatedTarget: { type: 'CELL', id: 'CELL-R2C2' },
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
  const [travelProfile, setTravelProfile] = useState<TravelProfile>('AMBULANCE');
  const [selectedRouteId, setSelectedRouteId] = useState<string>(
    'RTE-PLANNER-NODE-RAJWADA-NODE-MY-HOSPITAL'
  );
  const [routeUpdateNotification, setRouteUpdateNotification] =
    useState<RouteUpdateNotification | null>(null);
  const [evacuationConfig, setEvacuationConfig] = useState<EvacuationConfig>(
    DEFAULT_EVACUATION_CONFIG
  );
  const [lastEvacAutoRefreshNote, setLastEvacAutoRefreshNote] = useState<
    string | null
  >(
    'Auto-refreshed at 18:42:15 when RD-05 (MG Road Krishnapura Bridge) transitioned to CLOSED.'
  );
  const [acknowledgedAlerts, setAcknowledgedAlerts] = useState<Set<string>>(new Set());
  const [alertLifecycleOverrides, setAlertLifecycleOverrides] = useState<
    Record<string, AlertLifecycleOverride>
  >({});
  const [customAlerts, setCustomAlerts] = useState<AlertItem[]>([]);
  const [isPlayingTimeline, setIsPlayingTimeline] = useState<boolean>(false);
  const [replaySpeed, setReplaySpeed] = useState<ReplaySpeed>(1);
  const [activeModelVersionId, setActiveModelVersionId] = useState<string>(
    'v2.4.2-indore-pilot'
  );

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
    () =>
      computeRouteRecommendations(
        roads,
        params,
        customOriginId,
        customDestId,
        travelProfile
      ),
    [roads, params, customOriginId, customDestId, travelProfile]
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

      // Automatically refresh Evacuation Plan whenever a major road changes state
      const changedSummary = [...newlyClosed, ...newlyOpened]
        .map((r) => `${r.id} (${r.name}) → ${r.currentState}`)
        .join('; ');
      setEvacuationConfig((prev) => ({
        ...prev,
        recalcVersion: prev.recalcVersion + 1,
      }));
      setLastEvacAutoRefreshNote(
        `Evacuation plan automatically refreshed at ${nowStr} after road state change: ${changedSummary}`
      );

      newlyClosed.forEach((r) => {
        const affectedRoutes = routes.filter((rt) =>
          rt.baselineShortestRoadIds.includes(r.id)
        );
        newEntries.push({
          id: `ACT-RD-CLOSE-${r.id}-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROUTING',
          eventTypeLabel: 'Route recalculated',
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
          eventTypeLabel: 'Road changed',
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
    setRouteUpdateNotification(null);
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

  // ============================================================================
  // LIVE REROUTING SUBSCRIPTION:
  // Monitors road states on the currently selected route. If any road on the
  // selected route changes state, automatically recomputes and notifies operator.
  // ============================================================================
  const subscribedRouteSnapRef = useRef<{
    routeId: string;
    originId: string;
    destId: string;
    profile: TravelProfile;
    roadIds: string[];
    roadStates: Map<string, RoadStatus>;
    etaMin: number;
    summary: string;
  } | null>(null);

  useEffect(() => {
    if (!activeRoute) return;
    const roadMap = new Map(roads.map((r) => [r.id, r]));

    const currentRoadIds = activeRoute.primaryRoute?.roadIds ?? [];
    const currentStates = new Map<string, RoadStatus>();
    roads.forEach((r) => currentStates.set(r.id, r.currentState));

    const currentSummary =
      currentRoadIds.length > 0
        ? currentRoadIds
            .map((id) => `${id} (${roadMap.get(id)?.name.split(' (')[0] ?? id})`)
            .join(' → ')
        : 'No Feasible Route';

    const prevSnap = subscribedRouteSnapRef.current;

    // Only trigger live subscription notification if same origin/dest/profile and a road on the previous route changed state
    if (
      prevSnap &&
      prevSnap.originId === activeRoute.originNodeId &&
      prevSnap.destId === activeRoute.destinationNodeId &&
      prevSnap.profile === activeRoute.travelProfile &&
      prevSnap.roadIds.length > 0
    ) {
      const changedRoadId = prevSnap.roadIds.find((rId) => {
        const prevState = prevSnap.roadStates.get(rId);
        const nowState = currentStates.get(rId);
        return prevState && nowState && prevState !== nowState;
      });

      if (changedRoadId) {
        const changedRoad = roadMap.get(changedRoadId);
        const nowState = changedRoad?.currentState ?? RoadStatus.CLOSED;
        const stateReadable =
          nowState === RoadStatus.LIKELY_FLOODED
            ? 'LIKELY FLOODED'
            : nowState === RoadStatus.AT_RISK
            ? 'AT RISK'
            : nowState;

        const nowStr = new Date().toTimeString().slice(0, 8);
        const profLabel = TRAVEL_PROFILE_POLICIES[activeRoute.travelProfile].label;

        setRouteUpdateNotification({
          id: `RT-UPD-${Date.now()}`,
          timestamp: nowStr,
          bannerTitle: activeRoute.feasible ? 'ROUTE UPDATED' : 'NO FEASIBLE ROUTE',
          reason: `Road segment ${changedRoadId} (${changedRoad?.name ?? ''}) became ${stateReadable}.`,
          affectedRoadId: changedRoadId,
          affectedRoadName: changedRoad?.name ?? changedRoadId,
          newRoadState: nowState,
          previousRouteRoadIds: prevSnap.roadIds,
          previousRouteSummary: prevSnap.summary,
          previousEtaMin: prevSnap.etaMin,
          newRouteRoadIds: currentRoadIds,
          newRouteSummary: currentSummary,
          newEtaMin: activeRoute.feasible ? activeRoute.recommendedEtaMin : null,
          explanation: activeRoute.feasible
            ? `Route subscription detected ${changedRoadId} transitioning to ${nowState} (~${
                changedRoad?.estimatedWaterDepthCm ?? 42
              }cm depth). Under ${profLabel} policy, the previous route became invalid and was recalculated via ${currentSummary} (“Recommended under current data”).`
            : `Route subscription detected ${changedRoadId} transitioning to ${nowState}, severing the last passable corridor for ${profLabel} profile.`,
        });
      }
    }

    subscribedRouteSnapRef.current = {
      routeId: activeRoute.id,
      originId: activeRoute.originNodeId,
      destId: activeRoute.destinationNodeId,
      profile: activeRoute.travelProfile,
      roadIds: currentRoadIds,
      roadStates: currentStates,
      etaMin: activeRoute.recommendedEtaMin,
      summary: currentSummary,
    };
  }, [roads, activeRoute]);

  /**
   * Major Demo Moment: "Demo incident" button
   * 1. Closes one important road on the active route.
   * 2. Shows the current route becoming invalid.
   * 3. Recalculates the route.
   * 4. Displays the alternate route.
   * 5. Explains why the route changed.
   */
  const handleTriggerDemoIncident = () => {
    setActiveTab('roads-routing');
    setStableTicksElapsed(3);

    const targetRoad = selectDemoIncidentRoad(activeRoute, roads, params);
    if (!targetRoad) return;

    const nowStr = new Date().toTimeString().slice(0, 8);

    // Inject closure & crowd/sensor evidence on targetRoad so it transitions on the active route
    setInjectedObservations((prev) => ({
      ...prev,
      officialRoadOverrides: {
        ...prev.officialRoadOverrides,
        [targetRoad.id]: 'CLOSED',
      },
      crowdReportsByRoad: {
        ...prev.crowdReportsByRoad,
        [targetRoad.id]: {
          count: 3,
          lastReportText:
            'DEMO INCIDENT: Flash inundation & police barricade across deck',
          timestamp: nowStr,
        },
      },
    }));

    setSelectedTarget({ type: 'ROAD', id: targetRoad.id });
    setActivityFeed((prev) =>
      [
        {
          id: `ACT-DEMO-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROUTING' as const,
          message: `DEMO INCIDENT: Closed ${targetRoad.id} (${targetRoad.name}) on active route`,
          detail: `Previous route invalidated · Route subscription automatically recalculated alternate corridor.`,
          severity: 'CRITICAL' as const,
          relatedTarget: { type: 'ROAD' as const, id: targetRoad.id },
        },
        ...prev,
      ].slice(0, 25)
    );
  };

  /**
   * Demonstrates "NO FEASIBLE ROUTE" behavior without fabricating a route:
   * Closes all corridors connected to the current Origin node so that no path exists.
   */
  const handleTriggerNoFeasibleRouteDemo = () => {
    setActiveTab('roads-routing');
    setStableTicksElapsed(3);
    const originId = activeRoute?.originNodeId ?? customOriginId;
    const incidentRoads = roads.filter(
      (r) => r.fromNodeId === originId || r.toNodeId === originId
    );

    const overrides: Record<string, 'CLOSED' | 'OPEN'> = {};
    incidentRoads.forEach((r) => {
      overrides[r.id] = 'CLOSED';
    });

    const nowStr = new Date().toTimeString().slice(0, 8);
    setInjectedObservations((prev) => ({
      ...prev,
      officialRoadOverrides: {
        ...prev.officialRoadOverrides,
        ...overrides,
      },
    }));

    setActivityFeed((prev) =>
      [
        {
          id: `ACT-NOROUTE-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROUTING' as const,
          message: `NO FEASIBLE ROUTE: All outgoing corridors from ${
            activeRoute?.originName ?? originId
          } are CLOSED`,
          detail: `Do not fabricate route · Displaying nearest reachable safe point & available shelter.`,
          severity: 'CRITICAL' as const,
        },
        ...prev,
      ].slice(0, 25)
    );
  };

  const {
    shelters,
    evacuationPlans,
    evacuationModeActive,
    evacuationTriggerReason,
  } = useMemo(
    () => evaluateSheltersAndEvacuation(cells, params, roads, evacuationConfig),
    [cells, params, roads, evacuationConfig]
  );

  const handleToggleManualEvacuation = () => {
    setEvacuationConfig((prev) => ({
      ...prev,
      manualModeActive: !prev.manualModeActive,
      recalcVersion: prev.recalcVersion + 1,
    }));
  };

  const handleChangeEvacuationThreshold = (threshold: number) => {
    setEvacuationConfig((prev) => ({
      ...prev,
      thresholdProbability: threshold,
      recalcVersion: prev.recalcVersion + 1,
    }));
  };

  const handleChangeShelterCapacityScale = (scalePct: number) => {
    setEvacuationConfig((prev) => ({
      ...prev,
      shelterCapacityScalePct: scalePct,
      recalcVersion: prev.recalcVersion + 1,
    }));
  };

  const handleRecalculateEvacuationPlan = () => {
    const nowStr = new Date().toTimeString().slice(0, 8);
    setEvacuationConfig((prev) => ({
      ...prev,
      recalcVersion: prev.recalcVersion + 1,
    }));
    setLastEvacAutoRefreshNote(
      `Operator manually recalculated evacuation plan at ${nowStr} under current road & shelter telemetry.`
    );
    setActivityFeed((prev) =>
      [
        {
          id: `ACT-EVAC-RECALC-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROUTING' as const,
          message: 'Recalculated capacity-aware evacuation plan across affected zones',
          detail: 'Removed CLOSED roads, penalized high-risk/uncertain corridors, and updated shelter load.',
          severity: 'INFO' as const,
        },
        ...prev,
      ].slice(0, 25)
    );
  };

  const handleSimulateEvacFailureState = (
    scenario:
      | 'CAPACITY_EXCEEDED'
      | 'ROAD_DISCONNECTED'
      | 'NO_REACHABLE_SHELTER'
      | 'RESET'
  ) => {
    const nowStr = new Date().toTimeString().slice(0, 8);
    setStableTicksElapsed(3);

    if (scenario === 'RESET') {
      setInjectedObservations(DEFAULT_INJECTED_OBSERVATIONS);
      setEvacuationConfig(DEFAULT_EVACUATION_CONFIG);
      setLastEvacAutoRefreshNote(
        `Reset evacuation constraints & road overrides to baseline (${nowStr}).`
      );
      return;
    }

    if (scenario === 'CAPACITY_EXCEEDED') {
      setInjectedObservations(DEFAULT_INJECTED_OBSERVATIONS);
      setEvacuationConfig((prev) => ({
        ...prev,
        thresholdProbability: 0.45,
        shelterCapacityScalePct: 40,
        manualModeActive: true,
        recalcVersion: prev.recalcVersion + 1,
      }));
      setLastEvacAutoRefreshNote(
        `Simulated Shelter Capacity Crunch (${nowStr}): Shelter capacity capped at 40% to verify “Shelter capacity exceeded” failure state.`
      );
    } else if (scenario === 'ROAD_DISCONNECTED') {
      // Close all roads connected to NODE-KRISHNAPURA (RD-05, RD-06, RD-11) and NODE-RAJWADA (RD-04, RD-05, RD-15)
      setInjectedObservations((prev) => ({
        ...prev,
        officialRoadOverrides: {
          ...prev.officialRoadOverrides,
          'RD-04': 'CLOSED',
          'RD-05': 'CLOSED',
          'RD-06': 'CLOSED',
          'RD-11': 'CLOSED',
          'RD-15': 'CLOSED',
        },
      }));
      setEvacuationConfig((prev) => ({
        ...prev,
        shelterCapacityScalePct: 100,
        recalcVersion: prev.recalcVersion + 1,
      }));
      setLastEvacAutoRefreshNote(
        `Auto-refreshed at ${nowStr}: Corridors RD-04, RD-05, RD-06, RD-11, RD-15 CLOSED — Krishnapura & Rajwada zones disconnected from road network.`
      );
    } else if (scenario === 'NO_REACHABLE_SHELTER') {
      // Close the access roads to all 4 municipal shelters (RD-02, RD-10, RD-20, RD-21)
      setInjectedObservations((prev) => ({
        ...prev,
        officialRoadOverrides: {
          'RD-02': 'CLOSED',
          'RD-10': 'CLOSED',
          'RD-20': 'CLOSED',
          'RD-21': 'CLOSED',
        },
      }));
      setEvacuationConfig((prev) => ({
        ...prev,
        shelterCapacityScalePct: 100,
        recalcVersion: prev.recalcVersion + 1,
      }));
      setLastEvacAutoRefreshNote(
        `Auto-refreshed at ${nowStr}: Shelter access roads RD-02, RD-10, RD-20, RD-21 CLOSED — No reachable shelters remaining.`
      );
    }
  };

  const alerts = useMemo(
    () =>
      generateOperationalAlerts(
        cells,
        roads,
        sensors,
        params,
        acknowledgedAlerts,
        alertLifecycleOverrides,
        customAlerts
      ),
    [
      cells,
      roads,
      sensors,
      params,
      acknowledgedAlerts,
      alertLifecycleOverrides,
      customAlerts,
    ]
  );

  const handleTransitionAlertLifecycle = (
    alertId: string,
    nextState: AlertLifecycleState
  ) => {
    const nowStr = new Date().toTimeString().slice(0, 8);
    const targetAlert = alerts.find((a) => a.id === alertId);

    setAlertLifecycleOverrides((prev) => ({
      ...prev,
      [alertId]: {
        lifecycleState: nextState,
        humanConfirmedBy:
          nextState === 'PUBLISHED' || nextState === 'UPDATED'
            ? `${activeRole} (Human Confirmed)`
            : prev[alertId]?.humanConfirmedBy,
        humanConfirmedAt:
          nextState === 'PUBLISHED' || nextState === 'UPDATED'
            ? `${nowStr}Z`
            : prev[alertId]?.humanConfirmedAt,
      },
    }));

    const eventTypeLabel =
      nextState === 'PUBLISHED' || nextState === 'UPDATED'
        ? ('Operator approved alert' as const)
        : ('Alert drafted' as const);

    setActivityFeed((prev) =>
      [
        {
          id: `ACT-ALT-LC-${Date.now()}`,
          timestamp: nowStr,
          category: 'ALERT' as const,
          eventTypeLabel,
          message: `Alert ${alertId} transitioned to ${nextState}: ${
            targetAlert?.actionHeadline ?? ''
          }`,
          detail:
            nextState === 'PUBLISHED'
              ? `Human confirmation recorded by ${activeRole} · Dispatched to ${
                  targetAlert?.audiences.join(', ') ?? 'Control room'
                }.`
              : `Lifecycle updated to ${nextState} for ${
                  targetAlert?.location ?? 'Indore Pilot'
                }.`,
          severity:
            nextState === 'PUBLISHED'
              ? ('SUCCESS' as const)
              : nextState === 'REJECTED' || nextState === 'CANCELLED'
              ? ('WARNING' as const)
              : ('INFO' as const),
        },
        ...prev,
      ].slice(0, 25)
    );
  };

  const handleComposeAlert = (draft: AlertComposerDraftInput) => {
    const newAlert = createComposedAlert(draft, cells, params);
    const nowStr = new Date().toTimeString().slice(0, 8);

    setCustomAlerts((prev) => [newAlert, ...prev]);

    const eventTypeLabel =
      newAlert.lifecycleState === 'PUBLISHED'
        ? ('Operator approved alert' as const)
        : ('Alert drafted' as const);

    setActivityFeed((prev) =>
      [
        {
          id: `ACT-ALT-COMP-${Date.now()}`,
          timestamp: nowStr,
          category: 'ALERT' as const,
          eventTypeLabel,
          message: `${newAlert.lifecycleState}: “${newAlert.actionHeadline}” for ${newAlert.location}`,
          detail: `${newAlert.probabilityStatement} Audience: ${newAlert.audiences.join(
            ', '
          )}.`,
          severity:
            newAlert.lifecycleState === 'PUBLISHED'
              ? ('SUCCESS' as const)
              : ('WARNING' as const),
          relatedTarget: draft.cellId
            ? { type: 'CELL' as const, id: draft.cellId }
            : undefined,
        },
        ...prev,
      ].slice(0, 25)
    );
  };

  // Gentle deterministic live heartbeat so the chronological Activity Feed feels alive
  const livePulseIdxRef = useRef<number>(0);
  useEffect(() => {
    const pulseTimer = window.setInterval(() => {
      const nowStr = new Date().toTimeString().slice(0, 8);
      const step = livePulseIdxRef.current % 4;
      livePulseIdxRef.current += 1;

      const topCell = cells[18]; // Krishnapura
      const gaugeA = sensors.find((s) => s.id === 'SEN-RG-01') ?? sensors[0];
      const bridgeRoad = roads.find((r) => r.id === 'RD-05') ?? roads[0];

      const pulseTemplates: ActivityFeedEntry[] = [
        {
          id: `ACT-PULSE-${Date.now()}`,
          timestamp: nowStr,
          category: 'SENSOR',
          eventTypeLabel: 'Sensor updated',
          message: `${gaugeA.id} (${gaugeA.name}) heartbeat: ${gaugeA.currentValue} ${gaugeA.unit} (${gaugeA.freshnessState})`,
          detail: `Packet integrity ${gaugeA.packetSuccessRatePct}% · Data confidence ${Math.round(
            gaugeA.confidence * 100
          )}%.`,
          severity: 'INFO',
          relatedTarget: { type: 'SENSOR', id: gaugeA.id },
        },
        {
          id: `ACT-PULSE-${Date.now()}`,
          timestamp: nowStr,
          category: 'PREDICTION',
          eventTypeLabel: 'Prediction changed',
          message: `Hydro-terrain sweep: ${topCell.localityName} (${topCell.wardCode}) at ${Math.round(
            topCell.floodProbability * 100
          )}% flood probability`,
          detail: `Expected onset ~${topCell.leadTimeMin} min · Warning level ${topCell.warningLevel}.`,
          severity: 'WARNING',
          relatedTarget: { type: 'CELL', id: topCell.id },
        },
        {
          id: `ACT-PULSE-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROAD_STATE',
          eventTypeLabel: 'Road changed',
          message: `Road state verification: ${bridgeRoad.id} (${bridgeRoad.name}) remains ${bridgeRoad.currentState}`,
          detail: `Estimated water depth ~${bridgeRoad.estimatedWaterDepthCm}cm (${bridgeRoad.agreeingObservationsCount} agreeing sources).`,
          severity:
            bridgeRoad.currentState === RoadStatus.CLOSED ? 'CRITICAL' : 'INFO',
          relatedTarget: { type: 'ROAD', id: bridgeRoad.id },
        },
        {
          id: `ACT-PULSE-${Date.now()}`,
          timestamp: nowStr,
          category: 'ROUTING',
          eventTypeLabel: 'Route recalculated',
          message: `Route subscription verified: ${
            activeRoute?.originName ?? 'Rajwada'
          } → ${activeRoute?.destinationName ?? 'MY Hospital'} (${
            activeRoute?.recommendedEtaMin ?? 14
          } min)`,
          detail: `Recommended under current data · Risk score ${
            activeRoute?.riskScore ?? 28
          }/100.`,
          severity: 'INFO',
        },
      ];

      setActivityFeed((prev) =>
        [pulseTemplates[step], ...prev].slice(0, 25)
      );
    }, 11000);

    return () => window.clearInterval(pulseTimer);
  }, [cells, sensors, roads, activeRoute]);

  const validationReport = useMemo(
    () => generateValidationReport(cells, params, activeModelVersionId),
    [cells, params, activeModelVersionId]
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

  // Timeline Autoplay Handler (Supports 1x / 2x / 5x speed)
  useEffect(() => {
    if (!isPlayingTimeline) return;
    const intervalMs = Math.max(440, Math.round(2200 / replaySpeed));
    const timer = window.setInterval(() => {
      updateParamsWithHysteresis((prev) => {
        const nextHour =
          prev.timelineHourOffset >= 4 ? -3 : prev.timelineHourOffset + 1;
        return resolveTimelineStepParameters(prev, nextHour);
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [isPlayingTimeline, replaySpeed]);

  const handleStepTimeline = (deltaHours: number) => {
    setIsPlayingTimeline(false);
    updateParamsWithHysteresis((prev) => {
      let nextHour = prev.timelineHourOffset + deltaHours;
      if (nextHour > 4) nextHour = -3;
      if (nextHour < -3) nextHour = 4;
      return resolveTimelineStepParameters(prev, nextHour);
    });
  };

  const handleChangeModelVersionId = (versionId: string) => {
    setActiveModelVersionId(versionId);
    const nowStr = new Date().toTimeString().slice(0, 8);
    setActivityFeed((prev) =>
      [
        {
          id: `ACT-MDL-${Date.now()}`,
          timestamp: nowStr,
          category: 'PREDICTION' as const,
          eventTypeLabel: 'Prediction changed' as const,
          message: `Switched Post-Disaster Learning model version to ${versionId}`,
          detail:
            versionId === 'v2.5.0-calibrated-candidate'
              ? 'Applied secondary culvert surcharge calibration (+7% nallah weight) & 45% threshold.'
              : `Evaluating validation metrics under ${versionId}.`,
          severity: 'INFO' as const,
        },
        ...prev,
      ].slice(0, 25)
    );
  };

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
    setRouteUpdateNotification(null);
    if (originId !== destId) {
      setSelectedRouteId(`RTE-PLANNER-${originId}-${destId}`);
    }
  };

  const handleChangeTravelProfile = (profile: TravelProfile) => {
    setTravelProfile(profile);
    setRouteUpdateNotification(null);
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
                evacuationModeActive={evacuationModeActive}
                evacuationTriggerReason={evacuationTriggerReason}
                evacuationThreshold={evacuationConfig.thresholdProbability}
                manualEvacuationActive={evacuationConfig.manualModeActive}
                shelterCapacityScalePct={evacuationConfig.shelterCapacityScalePct}
                lastEvacAutoRefreshNote={lastEvacAutoRefreshNote}
                onToggleManualEvacuation={handleToggleManualEvacuation}
                onChangeEvacuationThreshold={handleChangeEvacuationThreshold}
                onChangeShelterCapacityScale={handleChangeShelterCapacityScale}
                onRecalculateEvacuationPlan={handleRecalculateEvacuationPlan}
                onSimulateEvacFailureState={handleSimulateEvacFailureState}
                routes={routes}
                activeRouteId={activeRoute?.id ?? ''}
                onSelectRouteId={setSelectedRouteId}
                customOriginId={customOriginId}
                customDestId={customDestId}
                travelProfile={travelProfile}
                onChangeCustomRoute={handleChangeCustomRoute}
                onChangeTravelProfile={handleChangeTravelProfile}
                routeUpdateNotification={routeUpdateNotification}
                onDismissRouteUpdate={() => setRouteUpdateNotification(null)}
                onTriggerDemoIncident={handleTriggerDemoIncident}
                onTriggerNoFeasibleRouteDemo={handleTriggerNoFeasibleRouteDemo}
                alerts={alerts}
                onAcknowledgeAlert={handleAcknowledgeAlert}
                onTransitionAlertLifecycle={handleTransitionAlertLifecycle}
                onComposeAlert={handleComposeAlert}
                validationReport={validationReport}
                isPlayingTimeline={isPlayingTimeline}
                onTogglePlayTimeline={() => setIsPlayingTimeline((p) => !p)}
                replaySpeed={replaySpeed}
                onChangeReplaySpeed={setReplaySpeed}
                onStepTimeline={handleStepTimeline}
                activeModelVersionId={activeModelVersionId}
                onChangeModelVersionId={handleChangeModelVersionId}
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
                  routeUpdateNotification={routeUpdateNotification}
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
          routeUpdateNotification={routeUpdateNotification}
          onTriggerDemoIncident={handleTriggerDemoIncident}
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
        {/* Timeline Play + Step Backward/Forward + Speed 1x/2x/5x + Past / Now / Forecast Period Selector */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
          <button
            type="button"
            onClick={() => handleStepTimeline(-1)}
            className="px-2 py-1.5 bg-[#0D1320] hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold whitespace-nowrap"
            title="Step backward 1 hour"
          >
            ⏮
          </button>

          <button
            type="button"
            onClick={() => setIsPlayingTimeline((p) => !p)}
            className="px-3 py-1.5 bg-cyan-950/70 hover:bg-cyan-900/80 border border-cyan-500/60 text-cyan-200 font-semibold whitespace-nowrap transition-colors"
          >
            {isPlayingTimeline ? '❚❚ Pause' : '▶ Play'}
          </button>

          <button
            type="button"
            onClick={() => handleStepTimeline(1)}
            className="px-2 py-1.5 bg-[#0D1320] hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold whitespace-nowrap"
            title="Step forward 1 hour"
          >
            ⏭
          </button>

          <div className="flex items-center gap-0.5 mr-1">
            {([1, 2, 5] as ReplaySpeed[]).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setReplaySpeed(spd)}
                className={`px-1.5 py-1 border text-[10.5px] font-bold ${
                  replaySpeed === spd
                    ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200'
                    : 'bg-[#0D1320] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

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
