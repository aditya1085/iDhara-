import {
  AlertItem,
  FloodRiskCell,
  FloodSeverity,
  RoadSegmentState,
  RoadStatus,
  ScenarioParameters,
  SensorNode,
  UserRole,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';

export function generateOperationalAlerts(
  cells: FloodRiskCell[],
  roads: RoadSegmentState[],
  sensors: SensorNode[],
  params: ScenarioParameters,
  acknowledgedIds: Set<string>
): AlertItem[] {
  const alerts: AlertItem[] = [];

  // 1. Critical Confluence / Riverfront Inundation Alert
  const criticalCells = cells
    .filter((c) => c.severity === FloodSeverity.CRITICAL)
    .sort((a, b) => b.predictedDepthCm - a.predictedDepthCm);

  if (criticalCells.length > 0) {
    const topNames = criticalCells.slice(0, 4).map((c) => c.localityName);
    const avgConf =
      criticalCells.reduce((acc, c) => acc + c.confidence, 0) /
      criticalCells.length;
    const prov = createProvenance(params.mode, avgConf, params.timelineHourOffset);
    const expiry = new Date(new Date(prov.generated_at).getTime() + 30 * 60 * 1000).toISOString();

    alerts.push({
      ...prov,
      id: 'ALT-CRIT-CONFLUENCE',
      title: `Critical Flood Surge Predicted Across ${criticalCells.length} Low-Lying Pockets`,
      severity: FloodSeverity.CRITICAL,
      targetAudience: [
        UserRole.CONTROL_ROOM_OPERATOR,
        UserRole.EMERGENCY_RESPONDER,
        UserRole.CITIZEN,
      ],
      affectedLocalities: topNames,
      triggerEvidence: `${params.rainfallIntensityMmHr} mm/hr rainfall + ${params.drainageBlockagePct}% culvert choke driving up to ${criticalCells[0].predictedDepthCm} cm depth at ${criticalCells[0].localityName}.`,
      recommendedAction:
        'Deploy SDRF inflatable boats to Krishnapura & Chandrabhaga; initiate ground-floor evacuation to Chimanbagh & Lalbagh shelters under current data.',
      expiry,
      acknowledged: acknowledgedIds.has('ALT-CRIT-CONFLUENCE'),
      stepLink: 'EVACUATE',
    });
  }

  // 2. Road Closure & Bridge Overtopping Alert
  const closedRoads = roads.filter(
    (r) => r.currentState === RoadStatus.CLOSED_INUNDATED
  );
  if (closedRoads.length > 0) {
    const prov = createProvenance(params.mode, closedRoads[0].confidence, params.timelineHourOffset);
    const expiry = new Date(new Date(prov.generated_at).getTime() + 20 * 60 * 1000).toISOString();

    alerts.push({
      ...prov,
      id: 'ALT-ROAD-BARRICADE',
      title: `${closedRoads.length} Bridge / Underpass Corridors Impassable — Rerouting Active`,
      severity: FloodSeverity.CRITICAL,
      targetAudience: [
        UserRole.TRAFFIC_AUTHORITY,
        UserRole.CONTROL_ROOM_OPERATOR,
        UserRole.EMERGENCY_RESPONDER,
      ],
      affectedLocalities: closedRoads.map((r) => r.name),
      triggerEvidence: closedRoads[0].evidence.join(' · '),
      recommendedAction:
        'Place physical traffic barricades at Krishnapura Bridge, Chandrabhaga Causeway, and Sarwate Underpass. Divert ambulances via Regal–Palasia–MY Hospital elevated corridor under current data.',
      expiry,
      acknowledged: acknowledgedIds.has('ALT-ROAD-BARRICADE'),
      stepLink: 'REROUTE',
    });
  }

  // 3. Hospital / Critical Asset Access Protection Warning
  const mthCell = cells.find((c) => c.id === 'CELL-R2C3');
  if (mthCell && mthCell.floodProbability >= 0.45) {
    const prov = createProvenance(params.mode, mthCell.confidence, params.timelineHourOffset);
    const expiry = new Date(new Date(prov.generated_at).getTime() + 25 * 60 * 1000).toISOString();

    alerts.push({
      ...prov,
      id: 'ALT-ASSET-MTH',
      title: 'MTH Women & Children Hospital Perimeter Waterlogging Risk',
      severity: mthCell.severity,
      targetAudience: [
        UserRole.EMERGENCY_RESPONDER,
        UserRole.CONTROL_ROOM_OPERATOR,
      ],
      affectedLocalities: ['MTH Hospital Compound (W-24)', 'MG Road Central'],
      triggerEvidence: `Cell CELL-R2C3 flood probability at ${Math.round(
        mthCell.floodProbability * 100
      )}% (${mthCell.predictedDepthCm} cm depth) with ${mthCell.elevationM}m MSL elevation.`,
      recommendedAction:
        'Position 2 mobile dewatering pumps at MTH Eastern Gate and route neonatal ambulances exclusively via Regal Square approach under current data.',
      expiry,
      acknowledged: acknowledgedIds.has('ALT-ASSET-MTH'),
      stepLink: 'WARN',
    });
  }

  // 4. Sensor Telemetry / Drainage Proxy Uncertainty Alert
  const staleSensors = sensors.filter((s) => s.status === 'STALE');
  if (staleSensors.length > 0 || params.drainageBlockagePct >= 40) {
    const prov = createProvenance(params.mode, 0.78, params.timelineHourOffset);
    const expiry = new Date(new Date(prov.generated_at).getTime() + 45 * 60 * 1000).toISOString();

    alerts.push({
      ...prov,
      id: 'ALT-DATA-VERIFY',
      title:
        staleSensors.length > 0
          ? `${staleSensors.length} Sensor Feed(s) Stale — Field Verification Requested`
          : `High Culvert Blockage Proxy (${params.drainageBlockagePct}%) Elevating Subsurface Uncertainty`,
      severity: staleSensors.length > 1 ? FloodSeverity.HIGH : FloodSeverity.MODERATE,
      targetAudience: [
        UserRole.ANALYST_MODEL_OPERATOR,
        UserRole.CONTROL_ROOM_OPERATOR,
      ],
      affectedLocalities:
        staleSensors.length > 0
          ? staleSensors.map((s) => s.name)
          : ['Sarwate–Gwaltoli Box Culvert', 'Chandrabhaga Nallah Mouth'],
      triggerEvidence:
        staleSensors.length > 0
          ? `Telemetry dropout detected on ${staleSensors.map((s) => s.id).join(', ')}; model fallback active.`
          : `Solid-waste and silt accumulation proxy at ${params.drainageBlockagePct}% reduces storm drain capacity.`,
      recommendedAction:
        'Dispatch municipal ward engineers to visually verify gauge staff plates and clear trash screens at Sarwate and Chandrabhaga culverts.',
      expiry,
      acknowledged: acknowledgedIds.has('ALT-DATA-VERIFY'),
      stepLink: 'VERIFY',
    });
  }

  return alerts;
}
