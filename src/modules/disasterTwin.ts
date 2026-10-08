import {
  DisasterStage,
  FloodRiskCell,
  FloodSeverity,
  OperationalStep,
  RoadSegmentState,
  RoadStatus,
  ScenarioParameters,
} from '../types/idhara';

export interface TwinStageDescriptor {
  stage: DisasterStage;
  number: number;
  title: string;
  windowLabel: string;
  objective: string;
  primarySteps: OperationalStep[];
  activeReadinessChecklist: Array<{
    id: string;
    label: string;
    owner: string;
    status: 'COMPLETE' | 'ACTIVE' | 'PENDING';
  }>;
}

export const OPERATIONAL_CHAIN: Array<{
  step: OperationalStep;
  label: string;
  shortDesc: string;
}> = [
  { step: 'RAIN', label: 'RAIN', shortDesc: 'Pluviometer & catchment forcing' },
  { step: 'PREDICT', label: 'PREDICT', shortDesc: '64-cell terrain-drainage model' },
  { step: 'WARN', label: 'WARN', shortDesc: 'Ward & asset targeted advisories' },
  { step: 'SIMULATE', label: 'SIMULATE', shortDesc: 'Culvert choke & surge stress' },
  { step: 'VERIFY', label: 'VERIFY', shortDesc: 'Ultrasonic & field staff check' },
  { step: 'REROUTE', label: 'REROUTE', shortDesc: 'Flood-aware ambulance corridors' },
  { step: 'EVACUATE', label: 'EVACUATE', shortDesc: 'High-ground shelter dispatch' },
  { step: 'LEARN', label: 'LEARN', shortDesc: 'HWM validation & model tuning' },
];

export function getDisasterTwinStages(
  cells: FloodRiskCell[],
  roads: RoadSegmentState[],
  params: ScenarioParameters
): TwinStageDescriptor[] {
  const critCount = cells.filter((c) => c.severity === FloodSeverity.CRITICAL).length;
  const closedCount = roads.filter(
    (r) => r.currentState === RoadStatus.CLOSED_INUNDATED
  ).length;

  return [
    {
      stage: DisasterStage.EARLY_WARNING,
      number: 1,
      title: '1. EARLY WARNING',
      windowLabel: 'T-6h to T-1h · Pre-Monsoon / Watch',
      objective:
        'Ingest rainfall forecast & upstream Kahn inflow; identify low-elevation depressions before surface accumulation begins.',
      primarySteps: ['RAIN', 'PREDICT', 'WARN'],
      activeReadinessChecklist: [
        {
          id: 'CHK-EW-1',
          label: 'Poll 4 Indore rain gauges & Navalakha upstream discharge radar',
          owner: 'Telemetry Pipeline',
          status: 'COMPLETE',
        },
        {
          id: 'CHK-EW-2',
          label: `Flag ${critCount + 4} low-lying cells (<547m MSL) along Kahn–Saraswati confluence`,
          owner: 'Control-room operator',
          status: 'COMPLETE',
        },
        {
          id: 'CHK-EW-3',
          label: 'Issue pre-positioning advisory to Chimanbagh SDRF & MTH Hospital',
          owner: 'Emergency responder',
          status: params.stage === DisasterStage.EARLY_WARNING ? 'ACTIVE' : 'COMPLETE',
        },
      ],
    },
    {
      stage: DisasterStage.PRE_DISASTER_SCENARIO,
      number: 2,
      title: '2. PRE-DISASTER SCENARIO',
      windowLabel: 'T-1h to T+0h · What-If Stress Testing',
      objective:
        'Simulate rainfall bursts (30–95 mm/hr) and nallah blockage proxies (10–75%) to pre-stage pumps, barricades, and shelter buses.',
      primarySteps: ['SIMULATE', 'WARN', 'REROUTE'],
      activeReadinessChecklist: [
        {
          id: 'CHK-PRE-1',
          label: `Evaluate ${params.drainageBlockagePct}% culvert silt/solid-waste choke at Sarwate & Chandrabhaga`,
          owner: 'Analyst/model operator',
          status: 'COMPLETE',
        },
        {
          id: 'CHK-PRE-2',
          label: 'Pre-stage mobile dewatering pumps at Sarwate Underpass & MTH Gate',
          owner: 'Emergency responder',
          status:
            params.stage === DisasterStage.PRE_DISASTER_SCENARIO
              ? 'ACTIVE'
              : params.stage === DisasterStage.EARLY_WARNING
              ? 'PENDING'
              : 'COMPLETE',
        },
        {
          id: 'CHK-PRE-3',
          label: 'Pre-compute ambulance diversion routes avoiding low river bridges',
          owner: 'Traffic authority',
          status:
            params.stage === DisasterStage.PRE_DISASTER_SCENARIO ? 'ACTIVE' : 'COMPLETE',
        },
      ],
    },
    {
      stage: DisasterStage.REAL_TIME_ONGOING,
      number: 3,
      title: '3. REAL-TIME ONGOING',
      windowLabel: 'T+0h to T+3h · Active Incident Operations',
      objective:
        'Fuse ultrasonic water-level gauges with model depths, barricade flooded bridges, reroute emergency response, and execute shelter evacuation.',
      primarySteps: ['VERIFY', 'REROUTE', 'EVACUATE'],
      activeReadinessChecklist: [
        {
          id: 'CHK-RT-1',
          label: `Enforce road closures on ${closedCount} inundated bridge/underpass segments`,
          owner: 'Traffic authority',
          status:
            params.stage === DisasterStage.REAL_TIME_ONGOING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-RT-2',
          label: 'Verify ultrasonic stage at Krishnapura (SEN-WL-01) & Rambagh (SEN-WL-02)',
          owner: 'Control-room operator',
          status:
            params.stage === DisasterStage.REAL_TIME_ONGOING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-RT-3',
          label: 'Dispatch AICTSL evacuation buses from flooded pockets to 4 high-ground shelters',
          owner: 'Emergency responder',
          status:
            params.stage === DisasterStage.REAL_TIME_ONGOING ? 'ACTIVE' : 'PENDING',
        },
      ],
    },
    {
      stage: DisasterStage.POST_DISASTER_LEARNING,
      number: 4,
      title: '4. POST-DISASTER LEARNING',
      windowLabel: 'T+3h+ · Validation & Model Recalibration',
      objective:
        'Compare predicted inundation depths against observed high-water marks (HWM), audit sensor drift, and update ward drainage proxy scores.',
      primarySteps: ['VERIFY', 'LEARN'],
      activeReadinessChecklist: [
        {
          id: 'CHK-POST-1',
          label: 'Ingest field High-Water Mark (HWM) survey across 64 Indore grid cells',
          owner: 'Analyst/model operator',
          status:
            params.stage === DisasterStage.POST_DISASTER_LEARNING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-POST-2',
          label: 'Compute Brier Score, Critical Success Index (CSI), and cell residual errors',
          owner: 'Analyst/model operator',
          status:
            params.stage === DisasterStage.POST_DISASTER_LEARNING ? 'ACTIVE' : 'PENDING',
        },
        {
          id: 'CHK-POST-3',
          label: 'Export municipal desilting priority list for IMC drainage engineering wing',
          owner: 'Control-room operator',
          status:
            params.stage === DisasterStage.POST_DISASTER_LEARNING ? 'ACTIVE' : 'PENDING',
        },
      ],
    },
  ];
}
