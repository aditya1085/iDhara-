import { INTERSECTION_NODES } from '../data/indorePilotData';
import {
  RoadSegmentState,
  RoadStatus,
  RouteRecommendation,
  ScenarioParameters,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';

interface GraphEdge {
  road: RoadSegmentState;
  toNodeId: string;
}

/**
 * Runs Dijkstra shortest path over the 16-node, 24-corridor Indore network.
 * When `floodAware` is true, CLOSED_INUNDATED roads are impassable and
 * RESTRICTED_SHALLOW / CAUTION_WATERLOGGING roads carry strong risk-weighted penalties.
 */
function findOptimalPath(
  originNodeId: string,
  destinationNodeId: string,
  roads: RoadSegmentState[],
  floodAware: boolean
): { nodeIds: string[]; roadIds: string[]; distanceKm: number; etaMin: number; maxProb: number } {
  const adj = new Map<string, GraphEdge[]>();
  INTERSECTION_NODES.forEach((n) => adj.set(n.id, []));

  roads.forEach((r) => {
    adj.get(r.fromNodeId)?.push({ road: r, toNodeId: r.toNodeId });
    adj.get(r.toNodeId)?.push({ road: r, toNodeId: r.fromNodeId });
  });

  const dist = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevRoad = new Map<string, RoadSegmentState>();
  const visited = new Set<string>();

  INTERSECTION_NODES.forEach((n) => dist.set(n.id, Number.POSITIVE_INFINITY));
  dist.set(originNodeId, 0);

  while (visited.size < INTERSECTION_NODES.length) {
    let u: string | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [nodeId, d] of dist.entries()) {
      if (!visited.has(nodeId) && d < bestD) {
        bestD = d;
        u = nodeId;
      }
    }
    if (!u || u === destinationNodeId) break;
    visited.add(u);

    const neighbors = adj.get(u) || [];
    for (const edge of neighbors) {
      if (visited.has(edge.toNodeId)) continue;

      let weight = edge.road.baseTravelTimeMin;
      if (floodAware) {
        if (edge.road.currentState === RoadStatus.CLOSED_INUNDATED) {
          weight = 9999; // Avoid inundated closures unless no physical path exists
        } else if (edge.road.currentState === RoadStatus.RESTRICTED_SHALLOW) {
          weight = edge.road.baseTravelTimeMin * 3.8 + edge.road.floodProbability * 15;
        } else if (edge.road.currentState === RoadStatus.CAUTION_WATERLOGGING) {
          weight = edge.road.baseTravelTimeMin * 1.6 + edge.road.floodProbability * 5;
        } else {
          weight = edge.road.baseTravelTimeMin + edge.road.floodProbability * 2;
        }
      }

      const alt = (dist.get(u) ?? Number.POSITIVE_INFINITY) + weight;
      if (alt < (dist.get(edge.toNodeId) ?? Number.POSITIVE_INFINITY)) {
        dist.set(edge.toNodeId, alt);
        prevNode.set(edge.toNodeId, u);
        prevRoad.set(edge.toNodeId, edge.road);
      }
    }
  }

  const nodeIds: string[] = [];
  const roadIds: string[] = [];
  let curr: string | undefined = destinationNodeId;
  let distanceKm = 0;
  let etaMin = 0;
  let maxProb = 0;

  while (curr) {
    nodeIds.unshift(curr);
    const r = prevRoad.get(curr);
    if (r) {
      roadIds.unshift(r.id);
      distanceKm += r.lengthKm;
      const segTime =
        r.effectiveTravelTimeMin === Number.POSITIVE_INFINITY
          ? r.baseTravelTimeMin * 3.5
          : r.effectiveTravelTimeMin;
      etaMin += segTime;
      maxProb = Math.max(maxProb, r.floodProbability);
    }
    curr = prevNode.get(curr);
  }

  return {
    nodeIds,
    roadIds,
    distanceKm: Number(distanceKm.toFixed(2)),
    etaMin: Number(etaMin.toFixed(1)),
    maxProb: Number(maxProb.toFixed(2)),
  };
}

/**
 * Computes flood-aware route recommendations across key Indore operational corridors.
 * Strictly adheres to iDhara interaction rule:
 * Never describe a route as "guaranteed safe". Always use "Recommended under current data".
 */
export function computeRouteRecommendations(
  roads: RoadSegmentState[],
  params: ScenarioParameters,
  customOriginId?: string,
  customDestId?: string
): RouteRecommendation[] {
  const nodeMap = new Map(INTERSECTION_NODES.map((n) => [n.id, n]));
  const roadMap = new Map(roads.map((r) => [r.id, r]));

  const pairs: Array<{
    id: string;
    from: string;
    to: string;
    purpose: RouteRecommendation['purpose'];
  }> = [
    {
      id: 'RTE-AMB-RAJWADA-MYH',
      from: 'NODE-RAJWADA',
      to: 'NODE-MY-HOSPITAL',
      purpose: 'EMERGENCY_AMBULANCE',
    },
    {
      id: 'RTE-SDRF-CHIMANBAGH-HARSIDDHI',
      from: 'NODE-CHIMANBAGH',
      to: 'NODE-HARSIDDHI',
      purpose: 'MUNICIPAL_RESPONSE',
    },
    {
      id: 'RTE-EVAC-SARWATE-PALASIA',
      from: 'NODE-SARWATE',
      to: 'NODE-PALASIA',
      purpose: 'EVACUATION_BUS',
    },
    {
      id: 'RTE-TRANSIT-BADA-NAVALAKHA',
      from: 'NODE-BADA-GANPATI',
      to: 'NODE-NAVALAKHA',
      purpose: 'CITIZEN_TRANSIT',
    },
  ];

  if (
    customOriginId &&
    customDestId &&
    customOriginId !== customDestId &&
    !pairs.some((p) => p.from === customOriginId && p.to === customDestId)
  ) {
    pairs.unshift({
      id: `RTE-CUSTOM-${customOriginId}-${customDestId}`,
      from: customOriginId,
      to: customDestId,
      purpose: 'MUNICIPAL_RESPONSE',
    });
  }

  return pairs.map((pair) => {
    const baseline = findOptimalPath(pair.from, pair.to, roads, false);
    const recommended = findOptimalPath(pair.from, pair.to, roads, true);

    const baselineBlockedRoadNames = baseline.roadIds
      .map((id) => roadMap.get(id))
      .filter((r): r is RoadSegmentState => r !== undefined)
      .filter(
        (r) =>
          r.currentState === RoadStatus.CLOSED_INUNDATED ||
          r.currentState === RoadStatus.RESTRICTED_SHALLOW
      )
      .map((r) => r.name);

    const recRoads = recommended.roadIds
      .map((id) => roadMap.get(id))
      .filter((r): r is RoadSegmentState => r !== undefined);

    const avgConf =
      recRoads.reduce((acc, r) => acc + r.confidence, 0) /
      Math.max(1, recRoads.length);

    const prov = createProvenance(params.mode, avgConf, params.timelineHourOffset);
    const expiryDate = new Date(new Date(prov.generated_at).getTime() + 15 * 60 * 1000);

    const recommendationStatusLabel: RouteRecommendation['recommendationStatusLabel'] =
      recommended.maxProb <= 0.48
        ? 'Recommended under current data'
        : 'High-caution corridor under current data';

    const safetyAdvisory =
      baselineBlockedRoadNames.length > 0
        ? `Recommended under current data. Diverts around ${baselineBlockedRoadNames.length} flooded/restricted segment(s) (${baselineBlockedRoadNames.join(', ')}). Re-verify water levels before dispatch; route is not guaranteed safe.`
        : `Recommended under current data. Baseline corridor currently passable with max segment flood probability of ${Math.round(
            recommended.maxProb * 100
          )}%. Subject to rapid change during convective bursts.`;

    return {
      ...prov,
      id: pair.id,
      originNodeId: pair.from,
      originName: nodeMap.get(pair.from)?.name ?? pair.from,
      destinationNodeId: pair.to,
      destinationName: nodeMap.get(pair.to)?.name ?? pair.to,
      purpose: pair.purpose,
      expiry: expiryDate.toISOString(),
      recommendationStatusLabel,
      recommendedPathNodeIds: recommended.nodeIds,
      recommendedRoadIds: recommended.roadIds,
      recommendedDistanceKm: recommended.distanceKm,
      recommendedEtaMin: recommended.etaMin,
      maxEncounteredFloodProb: recommended.maxProb,
      baselineShortestRoadIds: baseline.roadIds,
      baselineDistanceKm: baseline.distanceKm,
      baselineBlockedRoadNames,
      avoidedHazardCount: baselineBlockedRoadNames.length,
      safetyAdvisory,
    };
  });
}
