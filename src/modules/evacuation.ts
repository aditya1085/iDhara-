import { BASE_SHELTERS } from '../data/indorePilotData';
import {
  EvacuationPlanItem,
  FloodRiskCell,
  FloodSeverity,
  ScenarioParameters,
  Shelter,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';

export function evaluateSheltersAndEvacuation(
  cells: FloodRiskCell[],
  params: ScenarioParameters
): { shelters: Shelter[]; evacuationPlans: EvacuationPlanItem[] } {
  const cellMap = new Map(cells.map((c) => [c.id, c]));

  const shelters: Shelter[] = BASE_SHELTERS.map((sh) => {
    const sourceCells = sh.assignedSourceCellIds
      .map((id) => cellMap.get(id))
      .filter((c): c is FloodRiskCell => Boolean(c));

    const dynamicInflux = sourceCells.reduce((sum, c) => {
      if (c.severity === FloodSeverity.CRITICAL) return sum + Math.round(c.populationEstimate * 0.042);
      if (c.severity === FloodSeverity.HIGH) return sum + Math.round(c.populationEstimate * 0.018);
      return sum;
    }, 0);

    const currentOccupancy = Math.min(
      sh.totalCapacity,
      sh.baseOccupancy + dynamicInflux
    );

    const ratio = currentOccupancy / sh.totalCapacity;
    let status: Shelter['status'] = 'READY_OPEN';
    if (ratio >= 0.88) status = 'NEAR_CAPACITY';
    else if (ratio >= 0.45) status = 'FILLING';

    const avgConf =
      sourceCells.reduce((acc, c) => acc + c.confidence, 0) /
      Math.max(1, sourceCells.length);

    const prov = createProvenance(params.mode, avgConf, params.timelineHourOffset);

    return {
      ...prov,
      id: sh.id,
      name: sh.name,
      ward: sh.ward,
      x: sh.x,
      y: sh.y,
      lat: sh.lat,
      lng: sh.lng,
      cellId: sh.cellId,
      elevationM: sh.elevationM,
      totalCapacity: sh.totalCapacity,
      currentOccupancy,
      status,
      medicalTeamPresent: sh.medicalTeamPresent,
      drinkingWaterLiters: sh.drinkingWaterLiters,
      assignedSourceCellIds: sh.assignedSourceCellIds,
      accessRoadId: sh.accessRoadId,
    };
  });

  const shelterMap = new Map(shelters.map((s) => [s.id, s]));

  // Select highest-risk cells requiring prioritized evacuation / protective staging
  const highRiskCells = [...cells]
    .filter(
      (c) =>
        c.severity === FloodSeverity.CRITICAL || c.severity === FloodSeverity.HIGH
    )
    .sort((a, b) => b.floodProbability - a.floodProbability)
    .slice(0, 10);

  const evacuationPlans: EvacuationPlanItem[] = highRiskCells.map((cell, idx) => {
    const targetShelter = shelterMap.get(cell.nearestShelterId) ?? shelters[0];
    const popAtRisk = Math.round(
      cell.populationEstimate *
        (cell.severity === FloodSeverity.CRITICAL ? 0.065 : 0.03)
    );
    const priorityScore = Math.round(
      cell.floodProbability * 65 + (cell.predictedDepthCm / 100) * 35
    );
    const busesAssigned = Math.max(2, Math.ceil(popAtRisk / 55));
    const distanceKm = Number((1.1 + ((idx * 3) % 5) * 0.35).toFixed(2));
    const estimatedClearanceMin = Math.round(distanceKm * 11 + popAtRisk * 0.06);

    const prov = createProvenance(
      params.mode,
      cell.confidence,
      params.timelineHourOffset
    );
    const expiryDate = new Date(
      new Date(prov.generated_at).getTime() + 20 * 60 * 1000
    );

    let status: EvacuationPlanItem['status'] = 'ADVISORY_ISSUED';
    if (cell.severity === FloodSeverity.CRITICAL && cell.predictedDepthCm >= 55) {
      status = 'EVACUATING';
    } else if (cell.severity === FloodSeverity.CRITICAL || cell.floodProbability >= 0.65) {
      status = 'STAGED';
    }

    return {
      ...prov,
      id: `EVAC-${cell.id}`,
      sourceCellId: cell.id,
      sourceLocality: `${cell.localityName} (${cell.wardCode})`,
      populationAtRisk: popAtRisk,
      priorityScore,
      severity: cell.severity,
      targetShelterId: targetShelter.id,
      targetShelterName: targetShelter.name,
      recommendedRouteId: targetShelter.accessRoadId,
      distanceKm,
      estimatedClearanceMin,
      busesAssigned,
      status,
      expiry: expiryDate.toISOString(),
    };
  });

  return { shelters, evacuationPlans };
}
