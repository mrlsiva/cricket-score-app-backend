import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { Any } from '../../lib/types';
import { Card, Empty, Loading } from '../ui';

const COLORS = ['#14614a', '#b00020', '#7c3aed', '#0284c7'];

/** Worm (cumulative runs) and Manhattan (runs per over) charts drawn with plain SVG. */
export function GraphsView({ matchId, teamName }: { matchId: string; teamName: (id: string) => string }) {
  const { data, isLoading } = useQuery({ queryKey: ['graphs', matchId], queryFn: () => api.get<Any[]>(`/matches/${matchId}/graphs`) });
  if (isLoading) return <Loading />;
  const inns = (data ?? []).filter((i) => !i.isSuperOver && i.manhattan.length);
  if (!inns.length) return <Empty title="Graphs appear once overs are bowled" />;

  const W = 640;
  const H = 260;
  const P = 36;
  const maxOver = Math.max(...inns.map((i) => i.worm.at(-1).over), 1);
  const maxRuns = Math.max(...inns.map((i) => i.worm.at(-1).runs), 10);
  const x = (o: number) => P + (o / maxOver) * (W - P * 2);
  const y = (r: number) => H - P - (r / maxRuns) * (H - P * 2);
  const maxOverRuns = Math.max(...inns.flatMap((i) => i.manhattan.map((m: Any) => m.runs)), 6);
  const overs = Math.max(...inns.map((i) => i.manhattan.length));
  const bw = (W - P * 2) / overs / inns.length;

  const legend = (
    <div className="mt-2 flex flex-wrap gap-4 text-xs">
      {inns.map((inn, k) => (
        <span key={k} className="flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[k] }} />
          {teamName(inn.battingTeamId)}
        </span>
      ))}
    </div>
  );
  const axes = (yMax: number) => (
    <>
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="#cbd5e1" />
      <line x1={P} y1={P} x2={P} y2={H - P} stroke="#cbd5e1" />
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={P - 6} y={H - P - f * (H - P * 2) + 4} fontSize="10" textAnchor="end" fill="#64748b">
          {Math.round(yMax * f)}
        </text>
      ))}
    </>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Worm">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {axes(maxRuns)}
          {inns.map((inn, k) => (
            <g key={k}>
              <polyline fill="none" stroke={COLORS[k]} strokeWidth="2.5" points={inn.worm.map((p: Any) => `${x(p.over)},${y(p.runs)}`).join(' ')} />
              {inn.fallOfWickets.map((f: Any, j: number) => {
                const [o, b] = f.overLabel.split('.').map(Number);
                return <circle key={j} cx={x(o + b / 6)} cy={y(f.score)} r="4" fill={COLORS[k]} stroke="white" strokeWidth="1.5" />;
              })}
            </g>
          ))}
          <text x={W / 2} y={H - 6} fontSize="11" textAnchor="middle" fill="#64748b">
            Overs
          </text>
        </svg>
        {legend}
      </Card>
      <Card title="Manhattan">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          {axes(maxOverRuns)}
          {inns.map((inn, k) =>
            inn.manhattan.map((m: Any) => {
              const h = (m.runs / maxOverRuns) * (H - P * 2);
              const bx = P + (m.over - 1) * bw * inns.length + k * bw + 1;
              return (
                <g key={`${k}-${m.over}`}>
                  <rect x={bx} y={H - P - h} width={Math.max(2, bw - 2)} height={h} fill={COLORS[k]} rx="2" />
                  {m.wickets > 0 && (
                    <text x={bx + bw / 2} y={H - P - h - 4} fontSize="10" textAnchor="middle" fill="#b00020" fontWeight="bold">
                      {'W'.repeat(Math.min(m.wickets, 3))}
                    </text>
                  )}
                </g>
              );
            }),
          )}
        </svg>
        {legend}
      </Card>
    </div>
  );
}
