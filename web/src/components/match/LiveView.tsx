import { LiveFeedItem } from '../../lib/live';
import { Snapshot } from '../../lib/types';
import { Badge, Card, cx, Empty, Stat } from '../ui';

export function BallChip({ s, big }: { s: string; big?: boolean }) {
  const tone = s.includes('W') ? 'bg-ball text-white' : s === '6' || s.startsWith('6') ? 'bg-violet-600 text-white' : s === '4' ? 'bg-sky-600 text-white' : /wd|nb|b|lb|P/.test(s) ? 'bg-amber-100 text-amber-800' : s === '0' ? 'bg-slate-200 text-slate-600' : 'bg-pitch-100 text-pitch-800';
  return <span className={cx('inline-flex items-center justify-center rounded-full font-bold tabular', big ? 'h-9 min-w-9 px-2 text-sm' : 'h-7 min-w-7 px-1.5 text-xs', tone)}>{s === '|' ? '⏭' : s}</span>;
}

export function LiveView({ snap, feed }: { snap: Snapshot | null | undefined; feed?: LiveFeedItem[] }) {
  if (!snap) return <Empty title="No live data yet" />;
  const c = snap.current;
  const battingName = c ? (c.battingTeamId === snap.match.teamA.id ? snap.match.teamA.name : snap.match.teamB.name) : '';
  return (
    <div className="space-y-4">
      {snap.match.isPaused && <div className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">⏸ Play suspended{snap.match.pauseReason ? `: ${snap.match.pauseReason}` : ''}</div>}
      {!c ? (
        <Empty title="Match not started yet">{snap.match.tossText}</Empty>
      ) : (
        <>
          <div className="rounded-2xl bg-gradient-to-br from-pitch-800 to-pitch-600 p-5 text-white shadow">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-sm text-white/70">
                  {c.isSuperOver ? 'Super over · ' : ''}
                  {battingName} · Innings {c.inningsNumber}
                </div>
                <div className="text-5xl font-extrabold tabular">{c.score}</div>
                <div className="text-white/80 tabular">
                  ({c.overs}/{c.maxOvers} ov) · CRR {c.runRate}
                  {c.projectedScore ? ` · Projected ${c.projectedScore}` : ''}
                </div>
              </div>
              {c.target && (
                <div className="rounded-xl bg-white/10 px-4 py-2 text-right">
                  <div className="text-xs uppercase text-white/60">Target {c.target}</div>
                  <div className="font-bold">{c.equation ?? 'Chase complete'}</div>
                  {c.requiredRunRate !== null && <div className="text-sm text-white/75">RRR {c.requiredRunRate}</div>}
                </div>
              )}
            </div>
            {!!c.thisOver.length && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs uppercase text-white/60">This over</span>
                {c.thisOver.map((s, i) => (
                  <BallChip key={i} s={s} />
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Batting">
              {[c.striker, c.nonStriker].map((b, i) =>
                b ? (
                  <div key={b.id} className="flex items-center justify-between border-b border-slate-100 py-2 last:border-0">
                    <span className="font-semibold">
                      {b.name}
                      {i === 0 && <span className="ml-1 text-ball">*</span>}
                    </span>
                    <span className="tabular text-sm">
                      <b className="text-base">{b.runs}</b> ({b.balls}) · 4s {b.fours} · 6s {b.sixes} · SR {b.strikeRate}
                    </span>
                  </div>
                ) : (
                  <div key={i} className="py-2 text-sm text-amber-700">
                    Waiting for new batter…
                  </div>
                ),
              )}
              {c.partnership && (
                <div className="mt-2 text-xs text-slate-500">
                  Partnership {c.partnership.runs} ({c.partnership.balls})
                </div>
              )}
            </Card>
            <Card title="Bowling">
              {c.bowler ? (
                <div className="flex items-center justify-between">
                  <span className="font-semibold">
                    {c.bowler.name} {!c.bowler.isCurrent && <Badge>last over</Badge>}
                  </span>
                  <span className="tabular text-sm">
                    {c.bowler.overs}-{c.bowler.maidens}-{c.bowler.runs}-<b>{c.bowler.wickets}</b> · Econ {c.bowler.economy}
                  </span>
                </div>
              ) : (
                <div className="text-sm text-amber-700">Waiting for bowler…</div>
              )}
              {c.lastWicket && (
                <div className="mt-3 text-xs text-slate-500">
                  Last wicket: {c.lastWicket.player} {c.lastWicket.runs}({c.lastWicket.balls}) at {c.lastWicket.score} ({c.lastWicket.over})
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Extras" value={c.extras.total} sub={`wd ${c.extras.wides} nb ${c.extras.noBalls} b ${c.extras.byes} lb ${c.extras.legByes}`} />
            {snap.innings.map((i) => (
              <Stat key={i.id} label={`${i.isSuperOver ? 'SO ' : ''}Inns ${i.number}`} value={i.score} sub={`${i.overs} ov · RR ${i.runRate}`} />
            ))}
          </div>

          {!!c.recentOvers?.length && (
            <Card title="Recent overs">
              <div className="space-y-2">
                {[...c.recentOvers].reverse().map((o: { over: number; runs: number; wickets: number; balls: string[] }) => (
                  <div key={o.over} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-16 font-semibold text-slate-500">Over {o.over}</span>
                    {o.balls.map((s, i) => (
                      <BallChip key={i} s={s} />
                    ))}
                    <span className="ml-auto text-slate-500">
                      {o.runs} runs{o.wickets ? `, ${o.wickets} wkt` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
      {!!feed?.length && (
        <Card title="Highlights">
          <ul className="space-y-1 text-sm">
            {feed.map((f) => (
              <li key={f.id} className="animate-pop">
                <Badge tone={f.event === 'wicket' ? 'red' : f.event === 'six' ? 'purple' : f.event === 'boundary' ? 'blue' : 'green'}>{f.event.replace(':', ' ')}</Badge> {f.text}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
