export enum ProductMode {
  LIVE = 'LIVE',
  HISTORICAL = 'HISTORICAL',
  SIMULATED = 'SIMULATED',
  MOCK = 'MOCK',
}

export enum DisasterStage {
  EARLY_WARNING = 'EARLY_WARNING',
  PRE_DISASTER_SCENARIO = 'PRE_DISASTER_SCENARIO',
  REAL_TIME_ONGOING = 'REAL_TIME_ONGOING',
  POST_DISASTER_LEARNING = 'POST_DISASTER_LEARNING',
}

export enum UserRole {
  CONTROL_ROOM_OPERATOR = 'Control-room operator',
  EMERGENCY_RESPONDER = 'Emergency responder',
  TRAFFIC_AUTHORITY = 'Traffic authority',
  CITIZEN = 'Citizen',
  ANALYST_MODEL_OPERATOR = 'Analyst/model operator',
}

export type NavigationTab =
  | 'overview'
  | 'risk-map'
  | 'disaster-twin'
  | 'roads-routing'
  | 'evacuation'
  | 'alerts'
  | 'event-replay'
  | 'validation'
  | 'data-health';

export enum FloodSeverity {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export enum RoadStatus {
  OPEN = 'OPEN',
  CAUTION_WATERLOGGING = 'CAUTION_WATERLOGGING',
  RESTRICTED_SHALLOW = 'RESTRICTED_SHALLOW',
  CLOSED_INUNDATED = 'CLOSED_INUNDATED',
}

export type OperationalStep =
  | 'RAIN'
  | 'PREDICT'
  | 'WARN'
  | 'SIMULATE'
  | 'VERIFY'
  | 'REROUTE'
  | 'EVACUATE'
  | 'LEARN';

/**
 * Mandatory metadata contract carried by every prediction, map, route, alert,
 * scenario, API response, and dataset in iDhara.
 */
export interface DataProvenance {
  mode: ProductMode;
  scope_id: string;
  generated_at: string;
  data_as_of: string;
  confidence: number; // 0.00 to 1.00
}

export interface DataEnvelope<T> extends DataProvenance {
  payload: T;
  disclaimer: string;
}

export interface FloodDriver {
  factor: string;
  weight: number; // percentage contribution 0-100
  description: string;
  direction: 'aggravating' | 'mitigating';
}

export interface BaseGridCell {
  id: string;
  row: number;
  col: number;
  wardCode: string;
  localityName: string;
  lat: number;
  lng: number;
  elevationM: number; // meters above MSL (Indore ~543m - 562m)
  slopeDeg: number;
  imperviousness: number; // 0.0 - 1.0
  drainageProxyScore: number; // 0.0 (poor/choked nallah) - 1.0 (modern storm drain)
  landUse: 'Dense Historic Core' | 'Commercial Corridor' | 'Riverfront Low-Lying' | 'Mixed Residential' | 'Institutional / Medical' | 'Industrial / Transport';
  historicalFloodCount10Yr: number;
  historicalContext: string;
  populationEstimate: number;
  nearestCriticalAssetIds: string[];
  nearestShelterId: string;
  distanceToRiverM: number;
}

export interface FloodRiskCell extends BaseGridCell, DataProvenance {
  rainfallMmHr: number;
  cumulativeRainfallMm: number;
  floodProbability: number; // 0.0 - 1.0
  predictedDepthCm: number;
  observedDepthCm?: number; // available in historical / validation or sensor-adjacent cells
  severity: FloodSeverity;
  uncertaintyBand: number; // +/- probability spread
  topDrivers: FloodDriver[];
  dataFreshnessSec: number;
  freshnessLabel: string;
  verifiedBySensorId?: string;
}

export interface IntersectionNode {
  id: string;
  name: string;
  x: number; // 0 - 1000 map canvas coordinate
  y: number; // 0 - 1000 map canvas coordinate
  lat: number;
  lng: number;
  elevationM: number;
}

export interface BaseRoadSegment {
  id: string;
  name: string;
  corridorType: 'Arterial / BRTS' | 'River Bridge' | 'Urban Collector' | 'Historic Underpass / Bazaar';
  fromNodeId: string;
  toNodeId: string;
  lengthKm: number;
  baseTravelTimeMin: number;
  adjacentCellIds: string[];
  lowPointElevationM: number;
  hasUnderpassOrBridge: boolean;
  monitoringSensorId?: string;
}

export interface RoadSegmentState extends BaseRoadSegment, DataProvenance {
  currentState: RoadStatus;
  floodProbability: number;
  estimatedWaterDepthCm: number;
  effectiveTravelTimeMin: number; // Infinity if CLOSED_INUNDATED
  evidence: string[];
  lastUpdate: string;
  routeImpact: string;
  alternativeSummary: string;
}

export interface SensorNode extends DataProvenance {
  id: string;
  name: string;
  type: 'RAIN_GAUGE' | 'WATER_LEVEL_ULTRASONIC' | 'FLOW_DISCHARGE';
  x: number;
  y: number;
  lat: number;
  lng: number;
  cellId: string;
  currentValue: number;
  unit: string;
  warningThreshold: number;
  criticalThreshold: number;
  status: 'NOMINAL' | 'DRIFTING' | 'STALE' | 'CRITICAL_THRESHOLD';
  lastHeartbeatSecAgo: number;
  batteryPct: number;
  packetSuccessRatePct: number;
}

export interface CriticalAsset {
  id: string;
  name: string;
  category: 'HOSPITAL' | 'FIRE_EMERGENCY' | 'POWER_SUBSTATION' | 'TRANSIT_HUB' | 'SCHOOL_CIVIC';
  x: number;
  y: number;
  lat: number;
  lng: number;
  cellId: string;
  elevationM: number;
  criticalityLevel: 'TIER_1_LIFE_SAFETY' | 'TIER_2_INFRASTRUCTURE' | 'TIER_3_COMMUNITY';
  backupPowerHours: number;
  accessRoadIds: string[];
  contactRole: string;
}

export interface Shelter extends DataProvenance {
  id: string;
  name: string;
  ward: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  cellId: string;
  elevationM: number;
  totalCapacity: number;
  currentOccupancy: number;
  status: 'READY_OPEN' | 'FILLING' | 'NEAR_CAPACITY' | 'STANDBY';
  medicalTeamPresent: boolean;
  drinkingWaterLiters: number;
  assignedSourceCellIds: string[];
  accessRoadId: string;
}

export interface DrainageProxyFeature {
  id: string;
  name: string;
  type: 'RIVER_CHANNEL' | 'PRIMARY_NALLAH' | 'STORM_CULVERT_CHOKEPOINT';
  points: Array<{ x: number; y: number }>;
  designCapacityCms: number;
  currentLoadPct: number;
  blockageRiskFactor: number;
  notes: string;
}

export interface RouteRecommendation extends DataProvenance {
  id: string;
  originNodeId: string;
  originName: string;
  destinationNodeId: string;
  destinationName: string;
  purpose: 'EMERGENCY_AMBULANCE' | 'EVACUATION_BUS' | 'MUNICIPAL_RESPONSE' | 'CITIZEN_TRANSIT';
  expiry: string;
  recommendationStatusLabel: 'Recommended under current data' | 'High-caution corridor under current data';
  recommendedPathNodeIds: string[];
  recommendedRoadIds: string[];
  recommendedDistanceKm: number;
  recommendedEtaMin: number;
  maxEncounteredFloodProb: number;
  baselineShortestRoadIds: string[];
  baselineDistanceKm: number;
  baselineBlockedRoadNames: string[];
  avoidedHazardCount: number;
  safetyAdvisory: string;
}

export interface EvacuationPlanItem extends DataProvenance {
  id: string;
  sourceCellId: string;
  sourceLocality: string;
  populationAtRisk: number;
  priorityScore: number;
  severity: FloodSeverity;
  targetShelterId: string;
  targetShelterName: string;
  recommendedRouteId: string;
  distanceKm: number;
  estimatedClearanceMin: number;
  busesAssigned: number;
  status: 'EVACUATING' | 'STAGED' | 'ADVISORY_ISSUED' | 'STANDBY';
  expiry: string;
}

export interface AlertItem extends DataProvenance {
  id: string;
  title: string;
  severity: FloodSeverity;
  targetAudience: UserRole[];
  affectedLocalities: string[];
  triggerEvidence: string;
  recommendedAction: string;
  expiry: string;
  acknowledged: boolean;
  stepLink: OperationalStep;
}

export interface ScenarioParameters {
  mode: ProductMode;
  stage: DisasterStage;
  rainfallIntensityMmHr: number;
  durationHours: number;
  drainageBlockagePct: number; // e.g., 10% to 75% silt/solid-waste blockage proxy
  upstreamKahnInflowMultiplier: number; // 0.8x to 1.8x
  sensorDropoutCount: number; // 0 to 4 offline sensors to test uncertainty
  timelineHourOffset: number; // -3 to +6 hours
  activeEventPresetId: string;
}

export interface HistoricalEventPreset {
  id: string;
  title: string;
  dateLabel: string;
  mode: ProductMode;
  peakRainfallMmHr: number;
  cumulativeMm: number;
  drainageBlockagePct: number;
  upstreamMultiplier: number;
  summary: string;
  hourlyRainProfile: Array<{ hourOffset: number; label: string; mmHr: number; stage: DisasterStage }>;
}

export interface CellValidationRecord {
  cellId: string;
  localityName: string;
  predictedDepthCm: number;
  observedDepthCm: number;
  errorCm: number;
  predictedSeverity: FloodSeverity;
  observedSeverity: FloodSeverity;
  classificationMatch: 'EXACT_MATCH' | 'UNDER_PREDICTED' | 'OVER_PREDICTED';
  learningNote: string;
}

export interface ValidationReport extends DataProvenance {
  eventTitle: string;
  brierScore: number; // lower is better, e.g., 0.084
  criticalSuccessIndex: number; // CSI 0-1
  probabilityOfDetection: number; // POD 0-1
  falseAlarmRatio: number; // FAR 0-1
  meanAbsoluteDepthErrorCm: number;
  records: CellValidationRecord[];
  calibrationRecommendations: Array<{
    id: string;
    parameter: string;
    currentSetting: string;
    proposedAdjustment: string;
    expectedGain: string;
  }>;
}

export interface DataHealthReport extends DataProvenance {
  overallHealthPct: number;
  activeSensorsCount: number;
  totalSensorsCount: number;
  staleFeedsCount: number;
  driftingSensorsCount: number;
  meanLatencySec: number;
  spatialCoveragePct: number;
  subsystems: Array<{
    name: string;
    sourceType: string;
    freshnessSec: number;
    completenessPct: number;
    confidenceImpact: string;
    status: 'HEALTHY' | 'DEGRADED' | 'SIMULATED_SYNTHETIC';
  }>;
}
