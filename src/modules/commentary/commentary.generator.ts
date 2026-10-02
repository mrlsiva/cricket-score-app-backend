import { CommentaryType } from '@prisma/client';
import { createHash } from 'crypto';
import { EngineBall, OverSummary } from '../scoring/engine/scoring-engine';

export interface GeneratedCommentary {
  type: CommentaryType;
  text: string;
}

export interface BallContext {
  ball: EngineBall;
  label: string;
  names: Record<string, string>;
  batsmanRuns: number;
  batsmanBalls: number;
  batsmanRunsBefore: number;
  partnershipRuns: number;
  partnershipRunsBefore: number;
  partnershipNames?: [string, string];
  teamScore: string;
}

/** Deterministic variant picker so regenerated commentary for the same ball is stable. */
const pick = <T>(seed: string, options: T[]): T => options[createHash('md5').update(seed).digest()[0] % options.length];

const DOT = [
  'no run. Solid defence back down the pitch.',
  'no run. Beaten outside off stump!',
  'no run. Straight to the fielder.',
  'no run. Well left outside off.',
  'no run. Good length, played watchfully.',
];
const SINGLE = ['1 run. Pushed into the gap for a quick single.', '1 run. Worked off the pads.', '1 run. Dabbed to third man.', '1 run. Tapped and run.'];
const TWO = ['2 runs. Driven into the deep, they come back for the second.', '2 runs. Good running between the wickets.', '2 runs. Clipped through mid-wicket.'];
const THREE = ['3 runs. Superb running, three taken.', '3 runs. The fielder cuts it off just inside the rope.'];
const FOUR = [
  'FOUR! Cracking drive through the covers.',
  'FOUR! Pulled away powerfully to the boundary.',
  'FOUR! Cut hard, no chance for the fielder.',
  'FOUR! Glanced fine, races away.',
  'FOUR! Lofted over mid-off, one bounce into the fence.',
];
const SIX = [
  "SIX! That's gone all the way into the stands!",
  'SIX! Massive hit over long-on!',
  'SIX! Picked up and deposited over mid-wicket!',
  'SIX! Clean strike, out of the ground!',
];

function dismissalText(b: EngineBall, n: (id?: string | null) => string): string {
  const fielder = n(b.fielderId);
  switch (b.wicketType) {
    case 'BOWLED':
      return pick(b.id, ['Clean bowled! The stumps are shattered!', 'Bowled him! Through the gate!', 'Timber! Knocked over!']);
    case 'CAUGHT':
      return b.fielderId && b.fielderId === b.bowlerId ? `Caught and bowled! ${n(b.bowlerId)} takes a sharp return catch!` : `Caught by ${fielder}! ${pick(b.id, ['Safe hands.', 'Brilliant catch!', 'Straight down the throat.'])}`;
    case 'LBW':
      return 'LBW! Trapped plumb in front!';
    case 'RUN_OUT':
      return `Run out${b.fielderId ? ` by ${fielder}` : ''}! Terrible mix-up.`;
    case 'STUMPED':
      return `Stumped${b.fielderId ? ` by ${fielder}` : ''}! Lightning quick work behind the stumps.`;
    case 'HIT_WICKET':
      return 'Hit wicket! Dislodged the bails while playing the shot.';
    case 'RETIRED_HURT':
      return 'retires hurt.';
    case 'TIMED_OUT':
      return 'is timed out!';
    default:
      return 'OUT!';
  }
}

/** Commentary for a single ball (+ milestone / partnership lines). */
export function commentaryForBall(ctx: BallContext): GeneratedCommentary[] {
  const b = ctx.ball;
  const n = (id?: string | null) => (id ? (ctx.names[id] ?? 'Unknown') : 'Unknown');
  const head = `${n(b.bowlerId)} to ${n(b.batsmanId)}, `;
  const out: GeneratedCommentary[] = [];

  if (b.kind === 'PENALTY') return [{ type: 'BALL', text: `${b.extraRuns} penalty runs awarded to the batting side. ${ctx.teamScore}` }];
  if (b.kind === 'OVER_END') return [];
  if (b.kind === 'DISMISSAL') {
    const victim = n(b.dismissedPlayerId ?? b.batsmanId);
    return [{ type: b.wicketType === 'RETIRED_HURT' ? 'BALL' : 'WICKET', text: `${victim} ${dismissalText(b, n)} ${ctx.teamScore}` }];
  }

  let text: string;
  let type: CommentaryType = 'BALL';
  if (b.extraType === 'WIDE') {
    const extra = b.extraRuns - 1;
    text = `${head}wide${extra > 0 ? `, ${extra} more run${extra > 1 ? 's' : ''}` : ''}. ${pick(b.id, ['Strays down the leg side.', 'Too wide outside off.', 'Over the head, signalled wide.'])}`;
  } else if (b.extraType === 'NO_BALL') {
    text = `${head}NO BALL! ${b.runsOffBat ? `${b.runsOffBat} off the bat. ` : ''}${pick(b.id, ['Overstepped.', 'Front foot no-ball.', 'Above waist height.'])}`;
    if (b.runsOffBat === 6) type = 'SIX';
    else if (b.runsOffBat === 4 && b.isBoundary) type = 'BOUNDARY';
  } else if (b.extraType === 'BYE' || b.extraType === 'LEG_BYE') {
    const kind = b.extraType === 'BYE' ? 'bye' : 'leg bye';
    text = `${head}${b.extraRuns} ${kind}${b.extraRuns > 1 ? 's' : ''}.${b.isBoundary ? ' Races away to the boundary.' : ''}`;
  } else if (b.runsOffBat === 6) {
    type = 'SIX';
    text = head + pick(b.id, SIX);
  } else if (b.runsOffBat === 4 && b.isBoundary) {
    type = 'BOUNDARY';
    text = head + pick(b.id, FOUR);
  } else {
    const table = [DOT, SINGLE, TWO, THREE][b.runsOffBat];
    text = head + (table ? pick(b.id, table) : `${b.runsOffBat} runs.`);
  }

  if (b.isWicket) {
    type = 'WICKET';
    const victim = n(b.dismissedPlayerId ?? b.batsmanId);
    text = `${head}OUT! ${dismissalText(b, n)} ${victim} ${ctx.batsmanRuns}(${ctx.batsmanBalls}). ${ctx.teamScore}`;
  }
  out.push({ type, text });

  // milestones
  for (const m of [50, 100, 150, 200]) {
    if (ctx.batsmanRunsBefore < m && ctx.batsmanRuns >= m) {
      out.push({
        type: 'MILESTONE',
        text: `${m === 50 ? 'FIFTY' : m === 100 ? 'HUNDRED' : m} for ${n(b.batsmanId)}! ${ctx.batsmanRuns} off ${ctx.batsmanBalls} balls. What an innings!`,
      });
    }
  }
  for (const m of [50, 100, 150]) {
    if (ctx.partnershipRunsBefore < m && ctx.partnershipRuns >= m && ctx.partnershipNames) {
      out.push({ type: 'PARTNERSHIP', text: `${m}-run partnership up between ${ctx.partnershipNames[0]} and ${ctx.partnershipNames[1]}.` });
    }
  }
  return out;
}

export function overSummaryText(o: OverSummary, names: Record<string, string>, teamName: string, bowlerFigures: string) {
  const bowler = o.bowlerIds.map((id) => names[id] ?? 'Unknown').join(' / ');
  return (
    `End of over ${o.overNumber + 1}: ${o.runs} run${o.runs === 1 ? '' : 's'}${o.wickets ? `, ${o.wickets} wicket${o.wickets > 1 ? 's' : ''}` : ''}` +
    ` (${o.balls.join(' ')})${o.isMaiden ? ' - MAIDEN!' : ''}. ${teamName} ${o.cumulativeRuns}/${o.cumulativeWickets}. ${bowler} ${bowlerFigures}.`
  );
}
