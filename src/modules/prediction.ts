import { BASE_GRID_CELLS } from '../data/indorePilotData';
import {
  FloodDriver,
  FloodRiskCell,
  FloodSeverity,
  ScenarioParameters,
  SensorNode,
} from '../types/idhara';
import { createProvenance } from './dataIngestion';
import { computeCellUncertainty } from './uncertainty';

/**
 * Core Hydrological-Terrain Proxy Prediction Engine for iDhara.
 * Demonstrates the core thesis:
 * "The same rainfall does not create the same flood risk everywhere."
 */
export function predictFloodRiskGrid(
  params: ScenarioParameters,
  sensors: SensorNode[]
): FloodRiskCell[] {
  const minElev = 544.0;
  const maxElev = 562.0;

  return BASE_GRID_CELLS.map((cell) => {
    // Subtle micro-variation in rainfall across 5x5 km catchment
    const spatialRainVar = 0.94 + (((cell.row * 3 + cell.col * 5) % 7) * 0.02);
    const cellRainMmHr = Number((params.rainfallIntensityMmHr * spatialRainVar).toFixed(1));
    const cumulativeRainfallMm = Number(
      (cellRainMmHr * Math.max(1, params.durationHours) * 0.82).toFixed(1)
    );

    // 1. Topographic Depression Factor (0.0 at high ridge 562m, 1.0 at confluence 544m)
    const elevationFactor = Math.max(
      0,
      Math.min(1, (maxElev - cell.elevationM) / (maxElev - minElev))
    );

    // 2. Slope Stagnation Factor (flatter slopes trap sheet flow)
    const slopeFactor = Math.max(0, Math.min(1, (2.8 - cell.slopeDeg) / 2.6));

    // 3. Drainage Proxy Vulnerability (combines inherent drain score + active nallah blockage %)
    const effectiveDrainageDeficit = Math.min(
      1,
      (1 - cell.drainageProxyScore) * (0.75 + (params.drainageBlockagePct / 100) * 0.85)
    );

    // 4. River Backwater & Channel Proximity Factor (Kahn / Saraswati overbank spill)
    const riverProximityFactor =
      cell.distanceToRiverM < 120
        ? 0.92 * params.upstreamKahnInflowMultiplier
        : cell.distanceToRiverM < 350
        ? 0.58 * params.upstreamKahnInflowMultiplier
        : cell.distanceToRiverM < 700
        ? 0.25
        : 0.05;

    // 5. Impervious Surface Runoff Coefficient
    const imperviousFactor = cell.imperviousness;

    // Rainfall forcing normalized (reference 65 mm/hr severe monsoon burst)
    const rainForcing = Math.min(1.45, cellRainMmHr / 60);

    // Composite hydrological vulnerability index
    const terrainVulnerability =
      elevationFactor * 0.30 +
      effectiveDrainageDeficit * 0.28 +
      Math.min(1.2, riverProximityFactor) * 0.22 +
      imperviousFactor * 0.12 +
      slopeFactor * 0.08;

    const rawProbability = Math.min(
      0.99,
      Math.max(0.02, terrainVulnerability * (0.42 + 0.88 * rainForcing))
    );
    const floodProbability = Number(rawProbability.toFixed(2));

    // Predicted inundation depth in cm
    const rawDepthCm =
      floodProbability < 0.22
        ? floodProbability * 18
        : Math.pow(floodProbability, 1.65) * 115 * (0.7 + 0.35 * rainForcing);
    const predictedDepthCm = Math.round(rawDepthCm);

    // Determine discrete FloodSeverity (never communicated by color alone in UI)
    let severity: FloodSeverity = FloodSeverity.LOW;
    if (floodProbability >= 0.75 || predictedDepthCm >= 55) {
      severity = FloodSeverity.CRITICAL;
    } else if (floodProbability >= 0.52 || predictedDepthCm >= 30) {
      severity = FloodSeverity.HIGH;
    } else if (floodProbability >= 0.30 || predictedDepthCm >= 14) {
      severity = FloodSeverity.MODERATE;
    }

    // Build explainable Top Drivers for this specific cell
    const rawDrivers: FloodDriver[] = [
      {
        factor: 'Terrain Elevation & Slope',
        weight: Math.round(elevationFactor * 34 + slopeFactor * 8),
        description:
          cell.elevationM < 547.5
            ? `Low-lying topographic depression (${cell.elevationM}m MSL, ${cell.slopeDeg}° slope) accumulates catchment runoff.`
            : cell.elevationM > 555.0
            ? `Elevated ridge (${cell.elevationM}m MSL, ${cell.slopeDeg}° slope) sheds surface water rapidly.`
            : `Mid-slope gradient (${cell.elevationM}m MSL) with moderate sheet flow retention.`,
        direction: cell.elevationM < 550.5 ? 'aggravating' : 'mitigating',
      },
      {
        factor: 'Drainage Proxy & Culvert State',
        weight: Math.round(effectiveDrainageDeficit * 32),
        description:
          cell.drainageProxyScore < 0.42
            ? `Constrained masonry drain / culvert proxy (score ${cell.drainageProxyScore.toFixed(2)}) compounded by ${params.drainageBlockagePct}% silt/debris choke.`
            : `Storm drainage proxy capacity (${cell.drainageProxyScore.toFixed(2)}) absorbing primary runoff under ${params.drainageBlockagePct}% blockage.`,
        direction: effectiveDrainageDeficit > 0.45 ? 'aggravating' : 'mitigating',
      },
      {
        factor: 'Kahn / Saraswati River Stage',
        weight: Math.round(Math.min(1, riverProximityFactor) * 24),
        description:
          cell.distanceToRiverM < 200
            ? `${cell.distanceToRiverM}m from primary channel; backwater surcharge at ${params.upstreamKahnInflowMultiplier.toFixed(2)}× upstream inflow.`
            : `${cell.distanceToRiverM}m from river channel; insulated from direct overbank spill.`,
        direction: cell.distanceToRiverM < 320 ? 'aggravating' : 'mitigating',
      },
      {
        factor: 'Land Use & Impervious Cover',
        weight: Math.round(imperviousFactor * 18),
        description: `${cell.landUse} (${Math.round(cell.imperviousness * 100)}% impervious cover) leaves minimal soil infiltration.`,
        direction: cell.imperviousness > 0.78 ? 'aggravating' : 'mitigating',
      },
    ];
    const drivers: FloodDriver[] = rawDrivers.sort((a, b) => b.weight - a.weight);

    const uncertainty = computeCellUncertainty(cell, sensors, params);
    const prov = createProvenance(
      params.mode,
      uncertainty.confidence,
      params.timelineHourOffset
    );

    // Deterministic synthetic observed depth for historical/validation comparison
    const biasDirection = (cell.row + cell.col) % 2 === 0 ? 1 : -1;
    const residualCm = Math.round(
      biasDirection * (2 + ((cell.row * 5 + cell.col * 3) % 7))
    );
    const observedDepthCm = Math.max(0, predictedDepthCm + residualCm);

    return {
      ...cell,
      ...prov,
      rainfallMmHr: cellRainMmHr,
      cumulativeRainfallMm,
      floodProbability,
      predictedDepthCm,
      observedDepthCm,
      severity,
      uncertaintyBand: uncertainty.uncertaintyBand,
      topDrivers: drivers,
      dataFreshnessSec: uncertainty.freshnessSec,
      freshnessLabel: uncertainty.freshnessLabel,
      verifiedBySensorId: uncertainty.verifiedBySensorId,
    };
  });
}
