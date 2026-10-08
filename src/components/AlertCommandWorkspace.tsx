import React, { useMemo, useState } from 'react';
import { buildActionHeadline } from '../modules/alerts';
import { createProvenance } from '../modules/dataIngestion';
import {
  ActivityFeedEntry,
  AlertAudience,
  AlertComposerDraftInput,
  AlertItem,
  AlertLifecycleState,
  FloodRiskCell,
  FloodSeverity,
  RoadSegmentState,
  RoadStatus,
  ScenarioParameters,
  Shelter,
  UserRole,
  WarningLevel,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';
import { ProvenanceStrip, WarningLevelIndicator } from './SeverityVisuals';

interface AlertCommandWorkspaceProps {
  alerts: AlertItem[];
  cells: FloodRiskCell[];
  roads: RoadSegmentState[];
  shelters: Shelter[];
  params: ScenarioParameters;
  activeRole: UserRole;
  activityFeed: ActivityFeedEntry[];
  onTransitionAlertLifecycle: (
    alertId: string,
    nextState: AlertLifecycleState
  ) => void;
  onComposeAlert: (draft: AlertComposerDraftInput) => void;
  onSelectMapTarget: (target: MapInspectionTarget) => void;
}

const ALL_LIFECYCLE_STATES: AlertLifecycleState[] = [
  'DRAFT',
  'PENDING REVIEW',
  'PUBLISHED',
  'UPDATED',
  'EXPIRED',
  'CANCELLED',
  'REJECTED',
];

const AUDIENCE_OPTIONS: AlertAudience[] = [
  'Control room',
  'Emergency responders',
  'Traffic authority',
  'Citizen',
];

const LIFECYCLE_STYLE_MAP: Record<
  AlertLifecycleState,
  { badgeBg: string; badgeText: string; border: string }
> = {
  DRAFT: {
    badgeBg: 'bg-slate-800',
    badgeText: 'text-slate-200',
    border: 'border-slate-600',
  },
  'PENDING REVIEW': {
    badgeBg: 'bg-amber-500/25',
    badgeText: 'text-amber-200',
    border: 'border-amber-400',
  },
  PUBLISHED: {
    badgeBg: 'bg-emerald-500/25',
    badgeText: 'text-emerald-200',
    border: 'border-emerald-400',
  },
  UPDATED: {
    badgeBg: 'bg-cyan-500/25',
    badgeText: 'text-cyan-200',
    border: 'border-cyan-400',
  },
  EXPIRED: {
    badgeBg: 'bg-slate-900',
    badgeText: 'text-slate-400',
    border: 'border-slate-700',
  },
  CANCELLED: {
    badgeBg: 'bg-purple-950/70',
    badgeText: 'text-purple-200',
    border: 'border-purple-500/60',
  },
  REJECTED: {
    badgeBg: 'bg-rose-950/80',
    badgeText: 'text-rose-300',
    border: 'border-rose-500/70',
  },
};

export const AlertCommandWorkspace: React.FC<AlertCommandWorkspaceProps> = ({
  alerts,
  cells,
  roads,
  shelters,
  params,
  activeRole,
  activityFeed,
  onTransitionAlertLifecycle,
  onComposeAlert,
  onSelectMapTarget,
}) => {
  const [lifecycleFilter, setLifecycleFilter] = useState<
    AlertLifecycleState | 'ALL'
  >('ALL');
  const [showComposer, setShowComposer] = useState<boolean>(true);

  // Composer State
  const [selectedAudiences, setSelectedAudiences] = useState<AlertAudience[]>([
    'Control room',
    'Emergency responders',
    'Traffic authority',
  ]);
  const [selectedCellId, setSelectedCellId] = useState<string>('CELL-R2C2');
  const [customLocation, setCustomLocation] = useState<string>(
    'Ward sector W-24 (Krishnapura / MG Road)'
  );
  const [composerWarningLevel, setComposerWarningLevel] =
    useState<WarningLevel>(WarningLevel.ORANGE);
  const [isEvacuationAlert, setIsEvacuationAlert] = useState<boolean>(false);
  const [actionBulletsText, setActionBulletsText] = useState<string>(
    [
      'Monitor affected road',
      'Prepare alternate hospital route',
      'Verify water-level sensor',
      'Review evacuation readiness',
    ].join('\n')
  );
  const [expiryMinutes, setExpiryMinutes] = useState<number>(30);
  const [confidencePct, setConfidencePct] = useState<number>(86);
  const [sourceText, setSourceText] = useState<string>(
    'iDhara Hydro-Terrain Model + Ultrasonic Gauge SEN-WL-01'
  );
  const [humanConfirmChecked, setHumanConfirmChecked] =
    useState<boolean>(false);

  const selectedCell = useMemo(
    () => cells.find((c) => c.id === selectedCellId) ?? cells[18],
    [cells, selectedCellId]
  );

  const previewProbPct = selectedCell
    ? Math.max(78, Math.round(selectedCell.floodProbability * 100))
    : 78;

  const requiresHumanConfirmation =
    composerWarningLevel === WarningLevel.ORANGE ||
    composerWarningLevel === WarningLevel.RED ||
    isEvacuationAlert;

  const previewProv = useMemo(
    () =>
      createProvenance(
        params.mode,
        confidencePct / 100,
        params.timelineHourOffset
      ),
    [params.mode, confidencePct, params.timelineHourOffset]
  );

  const previewExpiryIso = useMemo(
    () =>
      new Date(
        new Date(previewProv.generated_at).getTime() + expiryMinutes * 60 * 1000
      ).toISOString(),
    [previewProv.generated_at, expiryMinutes]
  );

  const handleToggleAudience = (aud: AlertAudience) => {
    setSelectedAudiences((prev) => {
      if (prev.includes(aud)) {
        return prev.length > 1 ? prev.filter((a) => a !== aud) : prev;
      }
      return [...prev, aud];
    });
  };

  const handleSelectCellChange = (cellId: string) => {
    setSelectedCellId(cellId);
    const found = cells.find((c) => c.id === cellId);
    if (found) {
      setCustomLocation(`Ward sector ${found.wardCode} (${found.localityName})`);
      setConfidencePct(Math.round(found.confidence * 100));
      setComposerWarningLevel(
        found.warningLevel === WarningLevel.GREEN
          ? WarningLevel.ORANGE
          : found.warningLevel
      );
    }
  };

  const handleSubmitComposedAlert = (
    targetState: 'DRAFT' | 'PENDING REVIEW' | 'PUBLISHED'
  ) => {
    const severityMap: Record<WarningLevel, FloodSeverity> = {
      [WarningLevel.GREEN]: FloodSeverity.LOW,
      [WarningLevel.YELLOW]: FloodSeverity.MODERATE,
      [WarningLevel.ORANGE]: FloodSeverity.HIGH,
      [WarningLevel.RED]: FloodSeverity.CRITICAL,
    };

    const parsedBullets = actionBulletsText
      .split('\n')
      .map((line) => line.replace(/^[•\-*]\s*/, '').trim())
      .filter(Boolean);

    // Enforce human confirmation rule on ORANGE/RED & evacuation alerts
    const safeInitialState =
      targetState === 'PUBLISHED' &&
      requiresHumanConfirmation &&
      !humanConfirmChecked
        ? 'PENDING REVIEW'
        : targetState;

    onComposeAlert({
      audiences: selectedAudiences,
      location: customLocation,
      cellId: selectedCellId,
      severity: severityMap[composerWarningLevel],
      warningLevel: composerWarningLevel,
      isEvacuationAlert,
      recommendedActionBullets: parsedBullets,
      expiryMinutes,
      confidence: confidencePct / 100,
      source: sourceText,
      initialLifecycleState: safeInitialState,
    });

    setHumanConfirmChecked(false);
  };

  const filteredAlerts = useMemo(
    () =>
      lifecycleFilter === 'ALL'
        ? alerts
        : alerts.filter((a) => a.lifecycleState === lifecycleFilter),
    [alerts, lifecycleFilter]
  );

  // Command Center Top-Level Situation Metrics
  const highRiskZonesCount = cells.filter(
    (c) =>
      c.severity === FloodSeverity.CRITICAL || c.severity === FloodSeverity.HIGH
  ).length;
  const atRiskRoadsCount = roads.filter(
    (r) =>
      r.currentState === RoadStatus.AT_RISK ||
      r.currentState === RoadStatus.LIKELY_FLOODED ||
      r.currentState === RoadStatus.CLOSED
  ).length;
  const closedRoadsCount = roads.filter(
    (r) => r.currentState === RoadStatus.CLOSED
  ).length;
  const availableSheltersCount = shelters.filter(
    (s) => s.reachable && s.remainingCapacity > 0
  ).length;
  const avgConfidencePct = Math.round(
    (cells.reduce((s, c) => s + c.confidence, 0) / Math.max(1, cells.length)) *
      100
  );

  return (
    <div className="flex-1 min-h-0 p-4 bg-[#080C14] space-y-4 overflow-y-auto">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px]">
            <span className="text-amber-400 font-semibold">
              ALERT LIFECYCLE & COMMAND-CENTER DISPATCH
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-rose-300 font-semibold">
              ● ORANGE / RED & EVACUATION ALERTS REQUIRE HUMAN CONFIRMATION
            </span>
          </div>
          <h2 className="text-base font-semibold text-white mt-0.5">
            Action-Oriented Municipal Alert Composer & 7-State Lifecycle Governance
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setShowComposer((prev) => !prev)}
          className="px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-400 font-mono text-xs text-cyan-200 font-bold whitespace-nowrap transition-colors"
        >
          {showComposer ? '▼ Hide Alert Composer' : '+ Open Alert Composer'}
        </button>
      </div>

      {/* =====================================================================
          COMMAND CENTER: CURRENT SITUATION SUMMARY + ACTIVITY FEED STRIP
         ===================================================================== */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
        {/* CURRENT SITUATION */}
        <div className="xl:col-span-7 p-3 bg-[#0C121E] border border-slate-800 space-y-2.5 font-mono">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
            <span className="text-xs font-bold text-cyan-300">
              CURRENT SITUATION (COMMAND CENTER)
            </span>
            <span className="text-[11px] text-slate-400">
              Operator Lens: {activeRole}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2 text-xs tabular-nums">
            <div className="p-2 bg-[#070B12] border border-slate-800/90">
              <div className="text-[10px] text-slate-400">Risk:</div>
              <div className="text-sm font-bold text-rose-400 mt-0.5">
                {highRiskZonesCount >= 4 ? 'HIGH' : 'MODERATE'}
              </div>
            </div>

            <div className="p-2 bg-[#070B12] border border-slate-800/90">
              <div className="text-[10px] text-slate-400">Trend:</div>
              <div className="text-sm font-bold text-amber-400 mt-0.5">
                WORSENING
              </div>
            </div>

            <div className="p-2 bg-[#070B12] border border-slate-800/90">
              <div className="text-[10px] text-slate-400">High-risk zones:</div>
              <div className="text-sm font-bold text-white mt-0.5">
                {highRiskZonesCount}
              </div>
            </div>

            <div className="p-2 bg-[#070B12] border border-slate-800/90">
              <div className="text-[10px] text-slate-400">At-risk roads:</div>
              <div className="text-sm font-bold text-amber-300 mt-0.5">
                {atRiskRoadsCount}
              </div>
            </div>

            <div className="p-2 bg-[#070B12] border border-slate-800/90">
              <div className="text-[10px] text-slate-400">Closed roads:</div>
              <div className="text-sm font-bold text-rose-400 mt-0.5">
                {closedRoadsCount}
              </div>
            </div>

            <div className="p-2 bg-[#070B12] border border-slate-800/90">
              <div className="text-[10px] text-slate-400">Shelters available:</div>
              <div className="text-sm font-bold text-emerald-300 mt-0.5">
                {availableSheltersCount}
              </div>
            </div>

            <div className="p-2 bg-[#070B12] border border-slate-800/90">
              <div className="text-[10px] text-slate-400">Data confidence:</div>
              <div className="text-sm font-bold text-cyan-300 mt-0.5">
                {avgConfidencePct}%
              </div>
            </div>
          </div>
        </div>

        {/* CHRONOLOGICAL OPERATIONAL ACTIVITY FEED */}
        <div className="xl:col-span-5 p-3 bg-[#0C121E] border border-slate-800 space-y-1.5 font-mono">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-emerald-400 font-bold">
              ● CHRONOLOGICAL OPERATIONAL ACTIVITY FEED
            </span>
            <span className="text-slate-400 text-[10px]">
              Prediction · Sensor · Road · Route · Alert
            </span>
          </div>
          <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] tabular-nums pr-1">
            {activityFeed.slice(0, 6).map((item) => (
              <div
                key={item.id}
                onClick={() =>
                  item.relatedTarget && onSelectMapTarget(item.relatedTarget)
                }
                className="px-2 py-1 bg-[#070B12] border-l-2 border-cyan-400 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-900"
              >
                <div className="truncate">
                  <span className="text-slate-400 mr-1.5">{item.timestamp}</span>
                  {item.eventTypeLabel && (
                    <span className="text-cyan-300 font-bold mr-1.5">
                      [{item.eventTypeLabel}]
                    </span>
                  )}
                  <span className="text-slate-200">{item.message}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* =====================================================================
          ALERT COMPOSER (Audience, Location, Severity, Recommended action,
          Generated time, Expiry, Confidence, Source + Action-Oriented Preview)
         ===================================================================== */}
      {showComposer && (
        <div className="p-3.5 bg-[#0C121E] border border-cyan-500/40 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2 font-mono text-xs">
            <span className="text-cyan-300 font-bold">
              ACTION-ORIENTED ALERT COMPOSER (NEVER GENERIC “Heavy rain expected.”)
            </span>
            <span className="text-slate-400 text-[11px]">
              Drafts enter Alert Lifecycle & log to Command Activity Feed
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left 7 Cols: Composer Form Fields */}
            <div className="lg:col-span-7 space-y-3 font-mono text-xs">
              {/* Row 1: Audience Multi-Select */}
              <div>
                <span className="block text-[10.5px] text-slate-400 mb-1">
                  AUDIENCE (SELECT TARGET RECIPIENTS)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {AUDIENCE_OPTIONS.map((aud) => {
                    const selected = selectedAudiences.includes(aud);
                    return (
                      <button
                        key={aud}
                        type="button"
                        onClick={() => handleToggleAudience(aud)}
                        className={`px-2 py-1.5 border text-[11px] transition-colors whitespace-nowrap ${
                          selected
                            ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold'
                            : 'bg-[#070B12] border-slate-700 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {selected ? '✓ ' : ''}
                        {aud}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Row 2: Ward Sector Preset + Location + Severity */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label
                    htmlFor="composer-cell-select"
                    className="block text-[10.5px] text-slate-400 mb-1"
                  >
                    ZONE / SECTOR PRESET
                  </label>
                  <select
                    id="composer-cell-select"
                    value={selectedCellId}
                    onChange={(e) => handleSelectCellChange(e.target.value)}
                    className="w-full bg-[#070B12] border border-slate-700 text-slate-100 px-2 py-1.5 text-xs"
                  >
                    {cells
                      .slice()
                      .sort((a, b) => b.floodProbability - a.floodProbability)
                      .slice(0, 16)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.wardCode} · {c.localityName} (
                          {Math.round(c.floodProbability * 100)}%)
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="composer-location-input"
                    className="block text-[10.5px] text-slate-400 mb-1"
                  >
                    LOCATION
                  </label>
                  <input
                    id="composer-location-input"
                    type="text"
                    value={customLocation}
                    onChange={(e) => setCustomLocation(e.target.value)}
                    className="w-full bg-[#070B12] border border-slate-700 text-slate-100 px-2 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="composer-severity-select"
                    className="block text-[10.5px] text-slate-400 mb-1"
                  >
                    SEVERITY / WARNING LEVEL
                  </label>
                  <select
                    id="composer-severity-select"
                    value={composerWarningLevel}
                    onChange={(e) =>
                      setComposerWarningLevel(e.target.value as WarningLevel)
                    }
                    className="w-full bg-[#070B12] border border-slate-700 text-slate-100 px-2 py-1.5 text-xs font-bold"
                  >
                    <option value={WarningLevel.ORANGE}>
                      ORANGE — HIGH FLOOD RISK
                    </option>
                    <option value={WarningLevel.RED}>
                      RED — CRITICAL FLOOD RISK
                    </option>
                    <option value={WarningLevel.YELLOW}>
                      YELLOW — MODERATE WATCH
                    </option>
                    <option value={WarningLevel.GREEN}>
                      GREEN — LOW / ADVISORY
                    </option>
                  </select>
                </div>
              </div>

              {/* Row 3: Source, Confidence, Generated Time, Expiry */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="col-span-2">
                  <label
                    htmlFor="composer-source-input"
                    className="block text-[10.5px] text-slate-400 mb-1"
                  >
                    SOURCE
                  </label>
                  <input
                    id="composer-source-input"
                    type="text"
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    className="w-full bg-[#070B12] border border-slate-700 text-slate-100 px-2 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label
                    htmlFor="composer-conf-input"
                    className="block text-[10.5px] text-slate-400 mb-1"
                  >
                    CONFIDENCE ({confidencePct}%)
                  </label>
                  <input
                    id="composer-conf-input"
                    type="number"
                    min={40}
                    max={99}
                    value={confidencePct}
                    onChange={(e) =>
                      setConfidencePct(
                        Math.max(40, Math.min(99, Number(e.target.value)))
                      )
                    }
                    className="w-full bg-[#070B12] border border-slate-700 text-cyan-300 px-2 py-1.5 text-xs font-bold"
                  />
                </div>

                <div>
                  <label
                    htmlFor="composer-expiry-select"
                    className="block text-[10.5px] text-slate-400 mb-1"
                  >
                    EXPIRY HORIZON
                  </label>
                  <select
                    id="composer-expiry-select"
                    value={expiryMinutes}
                    onChange={(e) => setExpiryMinutes(Number(e.target.value))}
                    className="w-full bg-[#070B12] border border-slate-700 text-amber-300 px-2 py-1.5 text-xs font-bold"
                  >
                    <option value={15}>+15 min ({previewExpiryIso.slice(11, 16)}Z)</option>
                    <option value={30}>+30 min ({previewExpiryIso.slice(11, 16)}Z)</option>
                    <option value={45}>+45 min ({previewExpiryIso.slice(11, 16)}Z)</option>
                    <option value={60}>+60 min ({previewExpiryIso.slice(11, 16)}Z)</option>
                  </select>
                </div>
              </div>

              {/* Row 4: Recommended Action Bullets */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="composer-actions-textarea"
                    className="text-[10.5px] text-slate-400"
                  >
                    RECOMMENDED ACTION (1 ACTION PER LINE)
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-rose-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isEvacuationAlert}
                      onChange={(e) => setIsEvacuationAlert(e.target.checked)}
                      className="accent-rose-500"
                    />
                    Include Evacuation Trigger
                  </label>
                </div>
                <textarea
                  id="composer-actions-textarea"
                  rows={4}
                  value={actionBulletsText}
                  onChange={(e) => setActionBulletsText(e.target.value)}
                  className="w-full bg-[#070B12] border border-slate-700 text-slate-100 p-2 text-xs font-mono"
                />
              </div>
            </div>

            {/* Right 5 Cols: Live Action-Oriented Alert Preview & Human Confirmation Gate */}
            <div className="lg:col-span-5 flex flex-col justify-between p-3 bg-[#070A12] border border-amber-500/50 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[10.5px]">
                  <span className="text-amber-300 font-bold">
                    ACTION-ORIENTED ALERT PREVIEW
                  </span>
                  <span className="text-slate-400">
                    GEN: {previewProv.generated_at.slice(11, 19)}Z · EXP:{' '}
                    {previewExpiryIso.slice(11, 19)}Z
                  </span>
                </div>

                {/* Headline */}
                <div className="px-2.5 py-1.5 bg-amber-500/20 border border-amber-400 text-amber-200 font-mono font-bold text-sm">
                  “{buildActionHeadline(composerWarningLevel, isEvacuationAlert)}”
                </div>

                {/* Probability Statement */}
                <div className="text-xs text-white font-semibold leading-relaxed bg-[#0C121E] p-2.5 border border-slate-800">
                  “{customLocation} has a {previewProbPct}% estimated flood
                  probability under the current forecast.”
                </div>

                {/* Recommended Action Bullets */}
                <div className="text-xs space-y-1">
                  <div className="font-mono text-[11px] text-cyan-300 font-semibold">
                    Recommended action:
                  </div>
                  <ul className="space-y-1 text-slate-200 pl-1">
                    {actionBulletsText
                      .split('\n')
                      .map((l) => l.replace(/^[•\-*]\s*/, '').trim())
                      .filter(Boolean)
                      .map((act, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-cyan-400 font-mono">•</span>
                          <span>{act}</span>
                        </li>
                      ))}
                  </ul>
                </div>

                <div className="font-mono text-[10.5px] text-slate-400 pt-1 border-t border-slate-800">
                  Audience: {selectedAudiences.join(', ')} · Confidence:{' '}
                  <strong className="text-cyan-300">{confidencePct}%</strong> ·
                  Source: {sourceText}
                </div>
              </div>

              {/* Human Confirmation Requirement Box & Submit Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800 font-mono text-xs">
                {requiresHumanConfirmation && (
                  <label className="flex items-start gap-2 p-2 bg-rose-950/40 border border-rose-500/60 text-rose-200 text-[11px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={humanConfirmChecked}
                      onChange={(e) =>
                        setHumanConfirmChecked(e.target.checked)
                      }
                      className="mt-0.5 accent-emerald-400"
                    />
                    <span>
                      <strong>Human Confirmation Required:</strong> ORANGE/RED
                      and evacuation alerts require explicit operator approval
                      before publishing.
                    </span>
                  </label>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleSubmitComposedAlert('DRAFT')}
                    className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold whitespace-nowrap"
                  >
                    1. Save as DRAFT
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmitComposedAlert('PENDING REVIEW')}
                    className="px-2.5 py-1.5 bg-amber-950/80 hover:bg-amber-900 border border-amber-400 text-amber-200 font-semibold whitespace-nowrap"
                  >
                    2. Queue PENDING REVIEW
                  </button>
                  <button
                    type="button"
                    disabled={requiresHumanConfirmation && !humanConfirmChecked}
                    onClick={() => handleSubmitComposedAlert('PUBLISHED')}
                    className={`px-2.5 py-1.5 border font-bold whitespace-nowrap ${
                      requiresHumanConfirmation && !humanConfirmChecked
                        ? 'bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600/30 hover:bg-emerald-600/40 border-emerald-400 text-emerald-200'
                    }`}
                  >
                    3. Confirm & Publish
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          7-STATE ALERT LIFECYCLE FILTER BAR
          (DRAFT, PENDING REVIEW, PUBLISHED, UPDATED, EXPIRED, CANCELLED, REJECTED)
         ===================================================================== */}
      <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
        <span className="text-slate-400 text-[11px] mr-1">
          LIFECYCLE STATE FILTER:
        </span>
        <button
          type="button"
          onClick={() => setLifecycleFilter('ALL')}
          className={`px-2.5 py-1 border text-[11px] ${
            lifecycleFilter === 'ALL'
              ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold'
              : 'bg-[#0C121E] border-slate-800 text-slate-400 hover:text-slate-200'
          }`}
        >
          ALL ({alerts.length})
        </button>
        {ALL_LIFECYCLE_STATES.map((st) => {
          const count = alerts.filter((a) => a.lifecycleState === st).length;
          const active = lifecycleFilter === st;
          return (
            <button
              key={st}
              type="button"
              onClick={() => setLifecycleFilter(st)}
              className={`px-2.5 py-1 border text-[11px] whitespace-nowrap ${
                active
                  ? 'bg-cyan-500/25 border-cyan-400 text-cyan-200 font-bold'
                  : 'bg-[#0C121E] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {st} ({count})
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          ALERT LIFECYCLE CARDS
         ===================================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filteredAlerts.map((alt) => {
          const lcStyle = LIFECYCLE_STYLE_MAP[alt.lifecycleState];
          return (
            <div
              key={alt.id}
              className={`p-3.5 bg-[#0C121E] border ${lcStyle.border} space-y-2.5 flex flex-col justify-between`}
            >
              <div className="space-y-2">
                {/* Top Row: Warning Level + Lifecycle State Badge */}
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                  <WarningLevelIndicator level={alt.warningLevel} />
                  <div className="flex items-center gap-1.5">
                    {alt.requiresHumanConfirmation && (
                      <span className="px-1.5 py-0.5 bg-rose-950/80 border border-rose-500/50 text-rose-200 text-[10px]">
                        {alt.humanConfirmedBy
                          ? '✓ Human Confirmed'
                          : '⚠ Requires Human Confirmation'}
                      </span>
                    )}
                    <span
                      className={`px-2 py-0.5 font-bold text-[11px] border ${lcStyle.badgeBg} ${lcStyle.badgeText} ${lcStyle.border}`}
                    >
                      {alt.lifecycleState}
                    </span>
                  </div>
                </div>

                {/* Action-Oriented Headline & Probability Statement */}
                <div className="p-2.5 bg-[#070A12] border border-slate-800 space-y-1">
                  <div className="font-mono text-xs font-bold text-amber-300">
                    “{alt.actionHeadline}”
                  </div>
                  <div className="text-sm font-semibold text-white leading-snug">
                    “{alt.probabilityStatement}”
                  </div>
                </div>

                {/* Recommended Action Bullets */}
                <div className="text-xs space-y-1">
                  <div className="font-mono text-[11px] text-cyan-300 font-semibold">
                    Recommended action:
                  </div>
                  <ul className="space-y-1 text-slate-200 pl-1">
                    {alt.recommendedActionBullets.map((b, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="text-cyan-400 font-mono">•</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Metadata Grid: Audience, Location, Source, Confidence, Generated, Expiry */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 p-2 bg-[#070B12] border border-slate-800/80 font-mono text-[10.5px] text-slate-300 tabular-nums">
                  <div className="truncate">
                    <span className="text-slate-500">Audience: </span>
                    {alt.audiences.join(', ')}
                  </div>
                  <div className="truncate">
                    <span className="text-slate-500">Location: </span>
                    {alt.location}
                  </div>
                  <div className="truncate col-span-2">
                    <span className="text-slate-500">Source: </span>
                    {alt.source}
                  </div>
                  <div>
                    <span className="text-slate-500">Confidence: </span>
                    <strong className="text-cyan-300">
                      {Math.round(alt.confidence * 100)}%
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500">Gen / Exp: </span>
                    {alt.generated_at.slice(11, 19)}Z / {alt.expiry.slice(11, 19)}Z
                  </div>
                </div>
              </div>

              {/* Lifecycle Governance Action Bar */}
              <div className="pt-2 border-t border-slate-800 space-y-1.5">
                <div className="font-mono text-[10px] text-slate-400 flex items-center justify-between">
                  <span>TRANSITION LIFECYCLE STATE:</span>
                  {alt.humanConfirmedBy && (
                    <span className="text-emerald-300">
                      {alt.humanConfirmedBy} ({alt.humanConfirmedAt})
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                  {alt.lifecycleState === 'DRAFT' && (
                    <button
                      type="button"
                      onClick={() =>
                        onTransitionAlertLifecycle(alt.id, 'PENDING REVIEW')
                      }
                      className="px-2.5 py-1 bg-amber-950/70 hover:bg-amber-900 border border-amber-400 text-amber-200 font-semibold"
                    >
                      → Submit to PENDING REVIEW
                    </button>
                  )}

                  {(alt.lifecycleState === 'PENDING REVIEW' ||
                    alt.lifecycleState === 'DRAFT') && (
                    <button
                      type="button"
                      onClick={() =>
                        onTransitionAlertLifecycle(alt.id, 'PUBLISHED')
                      }
                      className="px-2.5 py-1 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-400 text-emerald-200 font-bold"
                    >
                      ✓ Human Confirm & Publish (PUBLISHED)
                    </button>
                  )}

                  {alt.lifecycleState === 'PUBLISHED' && (
                    <button
                      type="button"
                      onClick={() =>
                        onTransitionAlertLifecycle(alt.id, 'UPDATED')
                      }
                      className="px-2.5 py-1 bg-cyan-950/70 hover:bg-cyan-900 border border-cyan-400 text-cyan-200 font-semibold"
                    >
                      ↻ Issue Update (UPDATED)
                    </button>
                  )}

                  {(alt.lifecycleState === 'PUBLISHED' ||
                    alt.lifecycleState === 'UPDATED') && (
                    <button
                      type="button"
                      onClick={() =>
                        onTransitionAlertLifecycle(alt.id, 'EXPIRED')
                      }
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300"
                    >
                      Mark EXPIRED
                    </button>
                  )}

                  {alt.lifecycleState !== 'CANCELLED' && (
                    <button
                      type="button"
                      onClick={() =>
                        onTransitionAlertLifecycle(alt.id, 'CANCELLED')
                      }
                      className="px-2 py-1 bg-purple-950/60 hover:bg-purple-900 border border-purple-500/60 text-purple-200"
                    >
                      Cancel (CANCELLED)
                    </button>
                  )}

                  {(alt.lifecycleState === 'PENDING REVIEW' ||
                    alt.lifecycleState === 'DRAFT') && (
                    <button
                      type="button"
                      onClick={() =>
                        onTransitionAlertLifecycle(alt.id, 'REJECTED')
                      }
                      className="px-2 py-1 bg-rose-950/70 hover:bg-rose-900 border border-rose-500/60 text-rose-200"
                    >
                      ✖ Reject (REJECTED)
                    </button>
                  )}
                </div>

                <ProvenanceStrip
                  provenance={alt}
                  expiry={alt.expiry}
                  compact
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
