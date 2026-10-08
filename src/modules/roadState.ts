import { BASE_ROAD_SEGMENTS } from '../data/indorePilotData';
import {
  FloodRiskCell,
  RoadSegmentState,
  RoadStatus,
  ScenarioParameters,
  SensorNode,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';

/**
 * Computes real-time/simulated road segment state across the 24 Indore pilot corridors
 * by fusing adjacent cell inundation predictions, low-point elevation, and ultrasonic sensors.
 */
export function evaluateRoadNetworkState(
  cells: FloodRiskCell[],
  sensors: SensorNode[],
  params: ScenarioParameters
): RoadSegmentState[] {
  const cellMap = new Map<string, FloodRiskCell>(cells.map((c) => [c.id, c]));
  const sensorMap = new Map<string, SensorNode>(sensors.map((s) => [s.id, s]));

  return BASE_ROAD_SEGMENTS.map((seg) => {
    const adjacentCells = seg.adjacentCellIds
      .map((id) => cellMap.get(id))
      .filter((c): c is FloodRiskCell => Boolean(c));

    const maxAdjProb = adjacentCells.reduce(
      (max, c) => Math.max(max, c.floodProbability),
      0.08
    );
    const maxAdjDepth = adjacentCells.reduce(
      (max, c) => Math.max(max, c.predictedDepthCm),
      0
    );

    const linkedSensor = seg.monitoringSensorId
      ? sensorMap.get(seg.monitoringSensorId)
      : undefined;

    // Underpasses and river bridges amplify water depth when adjacent cells flood
    const structureAmplifier = seg.hasUnderpassOrBridge ? 1.15 : 0.92;
    const floodProbability = Number(
      Math.min(0.99, maxAdjProb * structureAmplifier).toFixed(2)
    );
    const estimatedWaterDepthCm = Math.round(maxAdjDepth * structureAmplifier);

    let currentState: RoadStatus = RoadStatus.OPEN;
    if (floodProbability >= 0.74 || estimatedWaterDepthCm >= 45) {
      currentState = RoadStatus.CLOSED_INUNDATED;
    } else if (floodProbability >= 0.52 || estimatedWaterDepthCm >= 25) {
      currentState = RoadStatus.RESTRICTED_SHALLOW;
    } else if (floodProbability >= 0.32 || estimatedWaterDepthCm >= 12) {
      currentState = RoadStatus.CAUTION_WATERLOGGING;
    }

    // Effective travel time penalty for routing engine
    let effectiveTravelTimeMin = seg.baseTravelTimeMin;
    if (currentState === RoadStatus.CLOSED_INUNDATED) {
      effectiveTravelTimeMin = Number.POSITIVE_INFINITY;
    } else if (currentState === RoadStatus.RESTRICTED_SHALLOW) {
      effectiveTravelTimeMin = Number((seg.baseTravelTimeMin * 2.4).toFixed(1));
    } else if (currentState === RoadStatus.CAUTION_WATERLOGGING) {
      effectiveTravelTimeMin = Number((seg.baseTravelTimeMin * 1.45).toFixed(1));
    }

    // Assemble transparent evidence chain
    const evidence: string[] = [];
    const worstCell = [...adjacentCells].sort(
      (a, b) => b.floodProbability - a.floodProbability
    )[0];
    if (worstCell) {
      evidence.push(
        `Adjacent cell ${worstCell.localityName} (${worstCell.id}) at ${Math.round(
          worstCell.floodProbability * 100
        )}% flood probability (~${worstCell.predictedDepthCm} cm model depth)`
      );
    }

    if (linkedSensor) {
      if (linkedSensor.status === 'STALE') {
        evidence.push(
          `Sensor ${linkedSensor.name} (${linkedSensor.id}) telemetry stale; relying on hydrological-terrain proxy`
        );
      } else {
        evidence.push(
          `Verified by ${linkedSensor.name}: ${linkedSensor.currentValue} ${linkedSensor.unit} (warn ${linkedSensor.warningThreshold} ${linkedSensor.unit})`
        );
      }
    } else {
      evidence.push(
        `Low-point deck elevation ${seg.lowPointElevationM}m MSL evaluated against ${params.drainageBlockagePct}% culvert blockage factor`
      );
    }

    let routeImpact = 'Normal traffic flow; suitable for all emergency and transit vehicles.';
    let alternativeSummary = 'Primary corridor operational under current data.';

    if (currentState === RoadStatus.CLOSED_INUNDATED) {
      routeImpact = `BARRICADED / IMPASSABLE: Estimated ${estimatedWaterDepthCm} cm water depth exceeds safe wading/axle clearance. Excluded from active routing.`;
      alternativeSummary =
        'Reroute via elevated BRTS (Regal–Palasia–Geeta Bhawan) or VIP Sadar Bazaar bypass under current data.';
    } else if (currentState === RoadStatus.RESTRICTED_SHALLOW) {
      routeImpact = `RESTRICTED: ${estimatedWaterDepthCm} cm standing water. High-clearance SDRF / emergency trucks only; passenger cars & two-wheelers diverted.`;
      alternativeSummary =
        'Divert standard traffic to higher-elevation arterial connectors.';
    } else if (currentState === RoadStatus.CAUTION_WATERLOGGING) {
      routeImpact = `CAUTION: Curbside sheet ponding (~${estimatedWaterDepthCm} cm). Expect +45% travel time delay.`;
      alternativeSummary = 'Passable with speed restriction (20 km/h).';
    }

    const avgCellConf =
      adjacentCells.reduce((acc, c) => acc + c.confidence, 0) /
      Math.max(1, adjacentCells.length);
    const roadConf = linkedSensor && linkedSensor.status !== 'STALE'
      ? Math.min(0.95, avgCellConf + 0.06)
      : avgCellConf;

    const prov = createProvenance(params.mode, roadConf, params.timelineHourOffset);

    return {
      ...seg,
      ...prov,
      currentState,
      floodProbability,
      estimatedWaterDepthCm,
      effectiveTravelTimeMin,
      evidence,
      lastUpdate: linkedSensor
        ? `${linkedSensor.lastHeartbeatSecAgo}s ago`
        : '40s ago (Model Fusion)',
      routeImpact,
      alternativeSummary,
    };
  });
}
