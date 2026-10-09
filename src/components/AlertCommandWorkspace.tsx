import React, { useMemo, useState } from 'react';
import {
  ActivityFeedEntry,
  AlertAudience,
  AlertComposerDraftInput,
  AlertItem,
  AlertLifecycleState,
  FloodRiskCell,
  FloodSeverity,
  RoadSegmentState,
  ScenarioParameters,
  Shelter,
  UserRole,
  WarningLevel,
} from '../types/idhara';
import { MapInspectionTarget } from './IndoreFloodMap';
import {
  ProvenanceStrip,
  ScreenHonestyHeader,
  WarningLevelIndicator,
  WARNING_LEVEL_META,
} from './SeverityVisuals';

export interface AlertCommandWorkspaceProps {
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

const LIFECYCLE_BADGE_STYLE: Record<
  AlertLifecycleState,
  { label: string; text: string; bg: string; border: string; glyph: string }
> = {
  PUBLISHED: {
    label: 'PUBLISHED',
    text: 'text-emerald-300',
    bg: 'bg-emerald-950/60',
    border: 'border-emerald-500/50',
    glyph: '●',
  },
  'PENDING REVIEW': {
    label: 'PENDING REVIEW',
    text: 'text-amber-300',
    bg: 'bg-amber-950/60',
    border: 'border-amber-500/50',
    glyph: '▲',
  },
  DRAFT: {
    label: 'DRAFT',
    text: 'text-sky-300',
    bg: 'bg-sky-950/60',
    border: 'border-sky-500/50',
    glyph: '✎',
  },
  UPDATED: {
    label: 'UPDATED',
    text: 'text-cyan-300',
    bg: 'bg-cyan-950/60',
    border: 'border-cyan-500/50',
    glyph: '↻',
  },
  EXPIRED: {
    label: 'EXPIRED',
    text: 'text-slate-400',
    bg: 'bg-slate-900/60',
    border: 'border-slate-700/50',
    glyph: '◷',
  },
  CANCELLED: {
    label: 'CANCELLED',
    text: 'text-zinc-400',
    bg: 'bg-zinc-900/60',
    border: 'border-zinc-700/50',
    glyph: '✖',
  },
  REJECTED: {
    label: 'REJECTED',
    text: 'text-rose-400',
    bg: 'bg-rose-950/60',
    border: 'border-rose-700/50',
    glyph: '✖',
  },
};

const ALL_AUDIENCES: AlertAudience[] = [
  'Control room',
  'Emergency responders',
  'Traffic authority',
  'Citizen',
];

export const AlertCommandWorkspace: React.FC<AlertCommandWorkspaceProps> = ({
  alerts,
  cells,
  roads,
  shelters: _shelters,
  params,
  activeRole,
  activityFeed,
  onTransitionAlertLifecycle,
  onComposeAlert,
  onSelectMapTarget,
}) => {
  const [filterState, setFilterState] = useState<string>('ALL');
  const [filterLevel, setFilterLevel] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);

  // Composer Form State
  const [composeLocation, setComposeLocation] = useState<string>(
    cells[0] ? `${cells[0].wardCode} (${cells[0].localityName})` : 'Indore Central'
  );
  const [composeCellId, setComposeCellId] = useState<string>(cells[0]?.id || '');
  const [composeWarningLevel, setComposeWarningLevel] = useState<WarningLevel>(
    WarningLevel.ORANGE
  );
  const [composeSeverity, setComposeSeverity] = useState<FloodSeverity>(
    FloodSeverity.HIGH
  );
  const [composeIsEvacuation, setComposeIsEvacuation] = useState<boolean>(false);
  const [composeAudiences, setComposeAudiences] = useState<AlertAudience[]>([
    'Control room',
    'Emergency responders',
  ]);
  const [composeActions, setComposeActions] = useState<string>(
    'Monitor vulnerable road corridors\nPre-position rescue pumps at underpasses\nCoordinate traffic diversions with city police'
  );
  const [composeExpiryMin, setComposeExpiryMin] = useState<number>(30);
  const [composeConfidence, setComposeConfidence] = useState<number>(0.85);
  const [composeInitialState, setComposeInitialState] = useState<
    'DRAFT' | 'PENDING REVIEW' | 'PUBLISHED'
  >('PENDING REVIEW');

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      if (filterState !== 'ALL' && alert.lifecycleState !== filterState) {
        return false;
      }
      if (filterLevel !== 'ALL' && alert.warningLevel !== filterLevel) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = alert.title.toLowerCase().includes(q);
        const matchLoc = alert.location.toLowerCase().includes(q);
        const matchAction = alert.recommendedAction.toLowerCase().includes(q);
        const matchId = alert.id.toLowerCase().includes(q);
        if (!matchTitle && !matchLoc && !matchAction && !matchId) {
          return false;
        }
      }
      return true;
    });
  }, [alerts, filterState, filterLevel, searchQuery]);

  const alertStats = useMemo(() => {
    const published = alerts.filter((a) => a.lifecycleState === 'PUBLISHED').length;
    const pending = alerts.filter((a) => a.lifecycleState === 'PENDING REVIEW').length;
    const draft = alerts.filter((a) => a.lifecycleState === 'DRAFT').length;
    const critical = alerts.filter(
      (a) => a.warningLevel === WarningLevel.RED || a.isEvacuationAlert
    ).length;
    return { published, pending, draft, critical };
  }, [alerts]);

  const handleAudienceToggle = (aud: AlertAudience) => {
    setComposeAudiences((prev) =>
      prev.includes(aud) ? prev.filter((a) => a !== aud) : [...prev, aud]
    );
  };

  const handleCellSelect = (cId: string) => {
    setComposeCellId(cId);
    const found = cells.find((c) => c.id === cId);
    if (found) {
      setComposeLocation(`${found.wardCode} (${found.localityName})`);
      if (found.severity === FloodSeverity.CRITICAL) {
        setComposeWarningLevel(WarningLevel.RED);
        setComposeSeverity(FloodSeverity.CRITICAL);
      } else if (found.severity === FloodSeverity.HIGH) {
        setComposeWarningLevel(WarningLevel.ORANGE);
        setComposeSeverity(FloodSeverity.HIGH);
      } else if (found.severity === FloodSeverity.MODERATE) {
        setComposeWarningLevel(WarningLevel.YELLOW);
        setComposeSeverity(FloodSeverity.MODERATE);
      }
    }
  };

  const handleSubmitCompose = (e: React.FormEvent) => {
    e.preventDefault();
    const actionBullets = composeActions
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    onComposeAlert({
      audiences: composeAudiences.length > 0 ? composeAudiences : ['Control room'],
      location: composeLocation,
      cellId: composeCellId || undefined,
      severity: composeSeverity,
      warningLevel: composeWarningLevel,
      isEvacuationAlert: composeIsEvacuation,
      recommendedActionBullets: actionBullets,
      expiryMinutes: composeExpiryMin,
      confidence: composeConfidence,
      source: `Manual Operator Dispatch · ${activeRole}`,
      initialLifecycleState: composeInitialState,
    });

    setIsComposerOpen(false);
  };

  return (
    <div className="flex flex-col h-full bg-[#060910] text-slate-200">
      {/* 1. Mandatory Screen Honesty Strip */}
      <ScreenHonestyHeader
        screenTitle="EOC Alert & Dispatch Command Center"
        screenSubtle="7-Stage Lifecycle · Multi-Audience Dissemination · Human Confirmation Gateway"
        mode={params.mode}
        scopeId="INDORE-PILOT-5X5"
        timestamp={new Date().toISOString()}
        confidencePct={88}
        freshnessLabel="REAL-TIME DISPATCH"
      />

      {/* 2. Top Summary KPI Row & Controls */}
      <div className="bg-[#090E1A] border-b border-slate-800 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Quick Metrics */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <span className="text-slate-400">STATUS:</span>
            <span className="px-2 py-0.5 bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-semibold">
              ● {alertStats.published} Active Published
            </span>
            <span className="px-2 py-0.5 bg-amber-950/60 border border-amber-500/40 text-amber-300 font-semibold">
              ▲ {alertStats.pending} Pending Review
            </span>
            <span className="px-2 py-0.5 bg-rose-950/60 border border-rose-500/40 text-rose-300 font-semibold">
              ✖ {alertStats.critical} Critical/Evac
            </span>
            <span className="px-2 py-0.5 bg-slate-900 border border-slate-700 text-slate-300">
              ✎ {alertStats.draft} Drafts
            </span>
          </div>

          {/* Action Trigger */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsComposerOpen((o) => !o)}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-semibold font-mono tracking-wide rounded-sm transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>{isComposerOpen ? '✕ Close Composer' : '+ Compose New Alert'}</span>
            </button>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-400">LIFECYCLE:</span>
            {(
              [
                'ALL',
                'PUBLISHED',
                'PENDING REVIEW',
                'DRAFT',
                'UPDATED',
                'EXPIRED',
                'CANCELLED',
              ] as const
            ).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilterState(st)}
                className={`px-2 py-0.5 border rounded-none cursor-pointer ${
                  filterState === st
                    ? 'bg-slate-700 border-cyan-400 text-cyan-300 font-semibold'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400">SEVERITY:</span>
            {(['ALL', 'RED', 'ORANGE', 'YELLOW', 'GREEN'] as const).map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-0.5 border cursor-pointer ${
                  filterLevel === lvl
                    ? 'bg-slate-700 border-cyan-400 text-cyan-300 font-semibold'
                    : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {lvl}
              </button>
            ))}

            <input
              type="text"
              placeholder="Search alerts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="ml-2 px-2.5 py-1 bg-slate-900 border border-slate-700 text-slate-200 text-xs placeholder:text-slate-600 focus:outline-none focus:border-cyan-500 w-44 font-mono"
            />
          </div>
        </div>
      </div>

      {/* 3. Composer Drawer / Panel (Collapsible) */}
      {isComposerOpen && (
        <form
          onSubmit={handleSubmitCompose}
          className="bg-[#0B1324] border-b border-cyan-900/50 p-4 font-mono text-xs text-slate-300"
        >
          <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 font-semibold font-sans text-sm">
                Operational Alert Composer
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">
                Authorized as: <strong className="text-slate-200">{activeRole}</strong>
              </span>
            </div>
            <span className="text-[11px] text-amber-300 bg-amber-950/40 border border-amber-500/30 px-2 py-0.5">
              ORANGE/RED alerts enforce human confirmation protocol
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Target Location / Cell */}
            <div className="space-y-1">
              <label className="text-slate-400 font-semibold block">
                Target Zone / Ward Cell:
              </label>
              <select
                value={composeCellId}
                onChange={(e) => handleCellSelect(e.target.value)}
                className="w-full bg-[#060A14] border border-slate-700 p-1.5 text-slate-200 focus:border-cyan-500"
              >
                {cells.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.wardCode} · {c.localityName} ({Math.round(c.floodProbability * 100)}% prob)
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={composeLocation}
                onChange={(e) => setComposeLocation(e.target.value)}
                placeholder="Locality description..."
                className="w-full bg-[#060A14] border border-slate-700 p-1 text-slate-200 mt-1 focus:border-cyan-500"
              />
            </div>

            {/* Warning Level & Severity */}
            <div className="space-y-1">
              <label className="text-slate-400 font-semibold block">
                Warning Level & Severity:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={composeWarningLevel}
                  onChange={(e) =>
                    setComposeWarningLevel(e.target.value as WarningLevel)
                  }
                  className="bg-[#060A14] border border-slate-700 p-1.5 text-slate-200 focus:border-cyan-500"
                >
                  <option value={WarningLevel.RED}>RED (Evacuate/Barricade)</option>
                  <option value={WarningLevel.ORANGE}>ORANGE (Prepare/High Risk)</option>
                  <option value={WarningLevel.YELLOW}>YELLOW (Watch/Moderate)</option>
                  <option value={WarningLevel.GREEN}>GREEN (Monitor/Low)</option>
                </select>

                <select
                  value={composeSeverity}
                  onChange={(e) =>
                    setComposeSeverity(e.target.value as FloodSeverity)
                  }
                  className="bg-[#060A14] border border-slate-700 p-1.5 text-slate-200 focus:border-cyan-500"
                >
                  <option value={FloodSeverity.CRITICAL}>CRITICAL</option>
                  <option value={FloodSeverity.HIGH}>HIGH</option>
                  <option value={FloodSeverity.MODERATE}>MODERATE</option>
                  <option value={FloodSeverity.LOW}>LOW</option>
                </select>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300">
                  <input
                    type="checkbox"
                    checked={composeIsEvacuation}
                    onChange={(e) => setComposeIsEvacuation(e.target.checked)}
                    className="accent-rose-500"
                  />
                  <span className="text-rose-400 font-semibold">
                    Evacuation Order Directive
                  </span>
                </label>
              </div>
            </div>

            {/* Audiences & Lifecycle */}
            <div className="space-y-1">
              <label className="text-slate-400 font-semibold block">
                Target Audiences:
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_AUDIENCES.map((aud) => (
                  <label
                    key={aud}
                    className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={composeAudiences.includes(aud)}
                      onChange={() => handleAudienceToggle(aud)}
                      className="accent-cyan-500"
                    />
                    <span>{aud}</span>
                  </label>
                ))}
              </div>

              <div className="pt-2 grid grid-cols-2 gap-2">
                <div>
                  <span className="text-[11px] text-slate-400 block">Initial State:</span>
                  <select
                    value={composeInitialState}
                    onChange={(e) =>
                      setComposeInitialState(
                        e.target.value as 'DRAFT' | 'PENDING REVIEW' | 'PUBLISHED'
                      )
                    }
                    className="w-full bg-[#060A14] border border-slate-700 p-1 text-slate-200"
                  >
                    <option value="PENDING REVIEW">PENDING REVIEW</option>
                    <option value="DRAFT">DRAFT</option>
                    <option value="PUBLISHED">PUBLISHED (Immediate)</option>
                  </select>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Validity Expiry:</span>
                  <select
                    value={composeExpiryMin}
                    onChange={(e) => setComposeExpiryMin(Number(e.target.value))}
                    className="w-full bg-[#060A14] border border-slate-700 p-1 text-slate-200"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>1 hour</option>
                    <option value={120}>2 hours</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Action Bullets & Submit */}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="md:col-span-2 space-y-1">
              <label className="text-slate-400 font-semibold block">
                Recommended Action Directives (one per line):
              </label>
              <textarea
                rows={2}
                value={composeActions}
                onChange={(e) => setComposeActions(e.target.value)}
                className="w-full bg-[#060A14] border border-slate-700 p-2 text-slate-200 focus:border-cyan-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsComposerOpen(false)}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold font-mono text-xs cursor-pointer tracking-wider"
              >
                SUBMIT ALERT BULLETIN
              </button>
            </div>
          </div>
        </form>
      )}

      {/* 4. Main Body: Alert Items List + Activity Feed Audit Trail */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-0 overflow-hidden">
        {/* Left 2 Cols: Alerts Stream */}
        <div className="lg:col-span-2 overflow-y-auto p-4 space-y-3.5 border-r border-slate-800">
          {filteredAlerts.length === 0 ? (
            <div className="p-8 text-center text-slate-500 font-mono text-xs border border-dashed border-slate-800">
              No alerts match the selected criteria ({filterState} · {filterLevel}).
            </div>
          ) : (
            filteredAlerts.map((alert) => {
              const lcMeta =
                LIFECYCLE_BADGE_STYLE[alert.lifecycleState] ??
                LIFECYCLE_BADGE_STYLE.DRAFT;
              const warnMeta = WARNING_LEVEL_META[alert.warningLevel];

              // Check if matching road exists
              const matchedRoad = roads.find((r) =>
                alert.recommendedAction.includes(r.id) ||
                alert.title.includes(r.id) ||
                alert.triggerEvidence.includes(r.id)
              );

              return (
                <div
                  key={alert.id}
                  className={`bg-[#080D18] border ${
                    alert.warningLevel === WarningLevel.RED
                      ? 'border-rose-900/60'
                      : alert.warningLevel === WarningLevel.ORANGE
                      ? 'border-amber-900/60'
                      : 'border-slate-800'
                  } p-4 transition-all`}
                >
                  {/* Alert Header Row */}
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <WarningLevelIndicator
                          level={alert.warningLevel}
                          showDirective={false}
                        />

                        {/* Lifecycle Badge */}
                        <span
                          className={`font-mono text-[11px] font-bold px-2 py-0.5 border ${lcMeta.border} ${lcMeta.bg} ${lcMeta.text} inline-flex items-center gap-1`}
                        >
                          <span aria-hidden="true">{lcMeta.glyph}</span>
                          <span>{lcMeta.label}</span>
                        </span>

                        {alert.isEvacuationAlert && (
                          <span className="font-mono text-[11px] font-bold px-2 py-0.5 bg-rose-950/80 border border-rose-500/70 text-rose-300">
                            EVACUATION DIRECTIVE
                          </span>
                        )}

                        <span className="font-mono text-[11px] text-slate-400">
                          ID: <strong className="text-slate-200">{alert.id}</strong>
                        </span>
                      </div>

                      <h3 className="font-sans font-bold text-sm text-slate-100">
                        {alert.title}
                      </h3>
                    </div>

                    {/* Human Confirmation Badge */}
                    <div className="text-right font-mono text-[11px]">
                      {alert.humanConfirmedBy ? (
                        <div className="text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 inline-block">
                          ✓ Confirmed by {alert.humanConfirmedBy}
                          {alert.humanConfirmedAt && (
                            <span className="text-slate-400 ml-1">
                              ({alert.humanConfirmedAt})
                            </span>
                          )}
                        </div>
                      ) : alert.requiresHumanConfirmation ? (
                        <div className="text-amber-400 bg-amber-950/40 border border-amber-500/40 px-2 py-0.5 inline-block">
                          ▲ Requires Human Confirmation
                        </div>
                      ) : (
                        <div className="text-slate-500 text-[10px]">
                          Automated Telemetry Dispatch
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Body Content */}
                  <div className="mt-3 space-y-2.5 font-sans text-xs">
                    {/* Probability & Forecast statement */}
                    <p className="text-slate-200 font-medium">
                      {alert.probabilityStatement}
                    </p>

                    {/* Trigger Evidence */}
                    <div className="font-mono text-[11px] text-slate-400 bg-[#040810] p-2 border border-slate-800/80">
                      <strong className="text-slate-300">TRIGGER EVIDENCE: </strong>
                      {alert.triggerEvidence}
                    </div>

                    {/* Recommended Actions Bullets */}
                    <div className="space-y-1">
                      <span className="font-mono text-[11px] text-cyan-400 font-semibold uppercase tracking-wider">
                        Action Plan Directives:
                      </span>
                      <ul className="list-disc list-inside space-y-1 text-slate-300 pl-1">
                        {alert.recommendedActionBullets &&
                        alert.recommendedActionBullets.length > 0 ? (
                          alert.recommendedActionBullets.map((b, idx) => (
                            <li key={idx} className="leading-relaxed">
                              {b}
                            </li>
                          ))
                        ) : (
                          <li className="leading-relaxed">
                            {alert.recommendedAction}
                          </li>
                        )}
                      </ul>
                    </div>

                    {/* Target Audiences & Location Links */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 font-mono text-[11px]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-slate-500">DISPATCH RECIPIENTS:</span>
                        {alert.audiences.map((aud) => (
                          <span
                            key={aud}
                            className="px-1.5 py-0.5 bg-slate-900 border border-slate-700 text-slate-300"
                          >
                            {aud}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (matchedRoad) {
                              onSelectMapTarget({ type: 'ROAD', id: matchedRoad.id });
                            } else {
                              const foundCell = cells.find((c) =>
                                alert.location.includes(c.localityName)
                              );
                              if (foundCell) {
                                onSelectMapTarget({ type: 'CELL', id: foundCell.id });
                              }
                            }
                          }}
                          className="text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                        >
                          Inspect Location on Map →
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Provenance Strip */}
                  <ProvenanceStrip
                    provenance={alert}
                    expiry={alert.expiry}
                    compact
                  />

                  {/* Lifecycle State Transition Action Controls */}
                  <div className="mt-3 pt-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                    <div className="text-[11px] text-slate-400">
                      Lifecycle Transition:
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {alert.lifecycleState === 'PENDING REVIEW' && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              onTransitionAlertLifecycle(alert.id, 'PUBLISHED')
                            }
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold cursor-pointer transition"
                          >
                            ✓ Confirm & Publish ({activeRole})
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onTransitionAlertLifecycle(alert.id, 'REJECTED')
                            }
                            className="px-2.5 py-1 bg-rose-950 hover:bg-rose-900 border border-rose-700 text-rose-300 cursor-pointer transition"
                          >
                            Reject
                          </button>
                        </>
                      )}

                      {alert.lifecycleState === 'DRAFT' && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              onTransitionAlertLifecycle(alert.id, 'PENDING REVIEW')
                            }
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-slate-950 font-semibold cursor-pointer transition"
                          >
                            Submit for Review
                          </button>
                          {!alert.requiresHumanConfirmation && (
                            <button
                              type="button"
                              onClick={() =>
                                onTransitionAlertLifecycle(alert.id, 'PUBLISHED')
                              }
                              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-semibold cursor-pointer transition"
                            >
                              Publish Directly
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              onTransitionAlertLifecycle(alert.id, 'CANCELLED')
                            }
                            className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 cursor-pointer transition"
                          >
                            Discard
                          </button>
                        </>
                      )}

                      {(alert.lifecycleState === 'PUBLISHED' ||
                        alert.lifecycleState === 'UPDATED') && (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              onTransitionAlertLifecycle(alert.id, 'UPDATED')
                            }
                            className="px-2 py-1 bg-cyan-950 hover:bg-cyan-900 border border-cyan-700 text-cyan-300 cursor-pointer transition"
                          >
                            ↻ Broadcast Update
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onTransitionAlertLifecycle(alert.id, 'EXPIRED')
                            }
                            className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-400 cursor-pointer transition"
                          >
                            Mark Expired
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onTransitionAlertLifecycle(alert.id, 'CANCELLED')
                            }
                            className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-400 cursor-pointer transition"
                          >
                            Cancel Alert
                          </button>
                        </>
                      )}

                      {(alert.lifecycleState === 'REJECTED' ||
                        alert.lifecycleState === 'CANCELLED' ||
                        alert.lifecycleState === 'EXPIRED') && (
                        <button
                          type="button"
                          onClick={() =>
                            onTransitionAlertLifecycle(alert.id, 'DRAFT')
                          }
                          className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 cursor-pointer transition"
                        >
                          Clone to Draft
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right Col: Chronological Command Audit Trail & Guidelines */}
        <div className="overflow-y-auto p-4 space-y-4 bg-[#050811]">
          {/* EOC Human Confirmation Mandate Card */}
          <div className="bg-[#090F1C] border border-cyan-900/60 p-3.5 space-y-2">
            <h4 className="font-mono text-xs font-bold text-cyan-400 uppercase tracking-wide flex items-center gap-1.5">
              <span>🛡</span> EOC Dispatch Protocol
            </h4>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              Pursuant to NDMA and Indore Municipal Corporation disaster SOPs, any alert
              escalated to <strong className="text-amber-300">ORANGE</strong> or{' '}
              <strong className="text-rose-400">RED</strong> requires active human
              confirmation before dispatching automated SMS/PA alerts to citizens or field
              corridor closures.
            </p>
            <div className="font-mono text-[11px] text-slate-400 space-y-1 border-t border-slate-800/80 pt-2">
              <div className="flex items-center justify-between">
                <span>Active Role Desk:</span>
                <span className="text-slate-200 font-semibold">{activeRole}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Control Mode:</span>
                <span className="text-emerald-400 font-semibold">
                  HUMAN-IN-THE-LOOP (HITL)
                </span>
              </div>
            </div>
          </div>

          {/* Activity Feed Audit Log */}
          <div className="space-y-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5">
              <h4 className="font-mono text-xs font-semibold text-slate-300 uppercase tracking-wide">
                Live Command Log
              </h4>
              <span className="font-mono text-[10px] text-slate-500">
                {activityFeed.length} EVENTS
              </span>
            </div>

            <div className="space-y-2">
              {activityFeed.slice(0, 15).map((act) => (
                <div
                  key={act.id}
                  className="bg-[#070B14] border border-slate-800/80 p-2.5 font-mono text-[11px] space-y-1"
                >
                  <div className="flex items-center justify-between text-slate-400 text-[10px]">
                    <span className="text-slate-500">{act.timestamp}</span>
                    <span
                      className={`font-semibold ${
                        act.severity === 'CRITICAL'
                          ? 'text-rose-400'
                          : act.severity === 'WARNING'
                          ? 'text-amber-400'
                          : act.severity === 'SUCCESS'
                          ? 'text-emerald-400'
                          : 'text-cyan-400'
                      }`}
                    >
                      {act.eventTypeLabel || act.category}
                    </span>
                  </div>
                  <div className="text-slate-200 font-sans font-medium text-xs">
                    {act.message}
                  </div>
                  {act.detail && (
                    <div className="text-slate-400 text-[10.5px] leading-snug">
                      {act.detail}
                    </div>
                  )}
                  {act.relatedTarget && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => onSelectMapTarget(act.relatedTarget!)}
                        className="text-cyan-400 hover:underline text-[10px] cursor-pointer"
                      >
                        Target: {act.relatedTarget.type} · {act.relatedTarget.id} →
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
