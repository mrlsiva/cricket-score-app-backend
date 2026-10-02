import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { label } from '../../lib/format';
import { Any } from '../../lib/types';
import { Card, Empty, ErrorBox, Loading, Table } from '../ui';

export function ScorecardView({ matchId }: { matchId: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['scorecard', matchId], queryFn: () => api.get<Any>(`/matches/${matchId}/scorecard`) });
  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data.innings.length) return <Empty title="No innings played yet" />;
  return (
    <div className="space-y-5">
      {data.innings.map((inn: Any) => (
        <Card
          key={inn.id}
          padded={false}
          title={
            <span>
              {inn.isSuperOver && 'Super over · '}
              {inn.battingTeam.name}{' '}
              <span className="tabular text-pitch-700">
                {inn.total.runs}/{inn.total.wickets}
              </span>{' '}
              <span className="text-sm font-normal text-slate-500">
                ({inn.total.overs} ov, RR {inn.total.runRate}){inn.target ? ` · target ${inn.target}` : ''}
              </span>
            </span>
          }
        >
          <div className="p-3">
            <Table head={['Batter', 'R', 'B', '4s', '6s', 'SR']}>
              {inn.batting.map((b: Any) => (
                <tr key={b.playerId}>
                  <td className="px-2 py-2">
                    <Link to={`/players/${b.playerId}`} className="font-semibold hover:underline">
                      {b.name}
                    </Link>
                    <div className="text-xs text-slate-500">{b.dismissal}</div>
                  </td>
                  <td className="px-2 text-right font-bold">{b.runs}</td>
                  <td className="px-2 text-right">{b.balls}</td>
                  <td className="px-2 text-right">{b.fours}</td>
                  <td className="px-2 text-right">{b.sixes}</td>
                  <td className="px-2 text-right">{b.strikeRate}</td>
                </tr>
              ))}
              <tr className="bg-slate-50">
                <td className="px-2 py-2 text-sm">
                  Extras <span className="text-xs text-slate-500">(wd {inn.extras.wides}, nb {inn.extras.noBalls}, b {inn.extras.byes}, lb {inn.extras.legByes}, p {inn.extras.penalty})</span>
                </td>
                <td className="px-2 text-right font-bold">{inn.extras.total}</td>
                <td colSpan={4} />
              </tr>
            </Table>
            {!!inn.didNotBat.length && <p className="mt-2 px-2 text-xs text-slate-500">Did not bat: {inn.didNotBat.map((p: Any) => p.name).join(', ')}</p>}
            {!!inn.fallOfWickets.length && (
              <p className="mt-2 px-2 text-xs text-slate-500">
                <b>Fall of wickets:</b> {inn.fallOfWickets.map((f: Any) => `${f.score}-${f.wicketNumber} (${f.name}, ${f.overLabel})`).join(', ')}
              </p>
            )}
            <div className="mt-4">
              <Table head={['Bowler', 'O', 'M', 'R', 'W', 'Econ', 'Wd', 'Nb', '0s']}>
                {inn.bowling.map((b: Any) => (
                  <tr key={b.playerId}>
                    <td className="px-2 py-2 font-semibold">
                      <Link to={`/players/${b.playerId}`} className="hover:underline">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-2 text-right">{b.overs}</td>
                    <td className="px-2 text-right">{b.maidens}</td>
                    <td className="px-2 text-right">{b.runs}</td>
                    <td className="px-2 text-right font-bold">{b.wickets}</td>
                    <td className="px-2 text-right">{b.economy}</td>
                    <td className="px-2 text-right">{b.wides}</td>
                    <td className="px-2 text-right">{b.noBalls}</td>
                    <td className="px-2 text-right">{b.dots}</td>
                  </tr>
                ))}
              </Table>
            </div>
            {!!inn.partnerships.length && (
              <div className="mt-4">
                <div className="mb-1 px-2 text-xs font-semibold uppercase text-slate-500">Partnerships</div>
                <div className="space-y-1 px-2">
                  {inn.partnerships.map((p: Any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="w-40 truncate">
                        {p.batter1.name} & {p.batter2.name}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                        <div className="h-full bg-pitch-500" style={{ width: `${Math.min(100, (p.runs / Math.max(1, ...inn.partnerships.map((x: Any) => x.runs))) * 100)}%` }} />
                      </div>
                      <span className="w-16 text-right font-semibold tabular">
                        {p.runs} ({p.balls})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      ))}
      {!!data.awards?.length && (
        <Card title="Awards">
          <div className="grid gap-2 sm:grid-cols-2">
            {data.awards.map((a: Any) => (
              <div key={a.id} className="rounded-xl bg-yellow-50 px-3 py-2 text-sm">
                <div className="text-xs font-semibold uppercase text-yellow-800">{label(a.type)}</div>
                {a.player?.name}
                {a.secondPlayer ? ` & ${a.secondPlayer.name}` : ''} <span className="text-slate-500">{a.value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
