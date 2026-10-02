import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { BRANDING } from '../../config/configuration';
import { MatchStateService } from '../scoring/match-state.service';

type Scorecard = Awaited<ReturnType<MatchStateService['scorecard']>>;
type InningsCard = Scorecard['innings'][number];

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const FONT = "DejaVu Sans, Segoe UI, Arial, Helvetica, sans-serif";
const AWARD_LABEL: Record<string, string> = {
  MAN_OF_THE_MATCH: 'Player of the Match',
  BEST_BATSMAN: 'Best Batsman',
  BEST_BOWLER: 'Best Bowler',
  BEST_FIELDER: 'Best Fielder',
  MOST_SIXES: 'Most Sixes',
  MOST_FOURS: 'Most Fours',
  HIGHEST_PARTNERSHIP: 'Highest Partnership',
};

@Injectable()
export class ExportsService {
  constructor(private readonly state: MatchStateService) {}

  fileBase(card: Scorecard) {
    return `${card.match.teamA.name}-vs-${card.match.teamB.name}`.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  }

  // ─────────────── PDF ───────────────

  private pdf(title: string, draw: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true,
        info: { Title: title, Author: 'Sling Groups', Creator: BRANDING, Producer: BRANDING, Subject: 'Cricket scorecard' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      draw(doc);
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        const y = doc.page.height - 30;
        doc.page.margins.bottom = 0;
        doc.fontSize(8).fillColor('#666').text(`${BRANDING}  •  Page ${i + 1} of ${range.count}`, 40, y, { width: doc.page.width - 80, align: 'center', lineBreak: false });
      }
      doc.end();
    });
  }

  private ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
    if (doc.y + needed > doc.page.height - 60) doc.addPage();
  }

  private header(doc: PDFKit.PDFDocument, card: Scorecard, subtitle: string) {
    const m = card.match;
    const title = `${m.teamA.name} vs ${m.teamB.name}`;
    doc.fillColor('#0b3d2e').fontSize(18).font('Helvetica-Bold').text(title, { align: 'center' });
    doc.moveDown(0.2).fontSize(10).font('Helvetica').fillColor('#333');
    const meta = [m.tournament?.name, m.name !== title ? m.name : null, m.ground, m.scheduledAt ? new Date(m.scheduledAt).toDateString() : null, `${m.overs} overs`].filter(Boolean).join('  |  ');
    doc.text(meta, { align: 'center' });
    if (m.tossText) doc.text(m.tossText, { align: 'center' });
    if (m.resultText) doc.moveDown(0.3).font('Helvetica-Bold').fillColor('#b00020').fontSize(12).text(m.resultText, { align: 'center' });
    doc.moveDown(0.3).font('Helvetica').fontSize(9).fillColor('#777').text(subtitle, { align: 'center' });
    doc.moveDown(0.8);
  }

  private row(doc: PDFKit.PDFDocument, cols: { text: string; x: number; w: number; align?: 'left' | 'right' }[], opts: { bold?: boolean; fill?: string } = {}) {
    this.ensureSpace(doc, 16);
    const y = doc.y;
    if (opts.fill) doc.rect(40, y - 2, doc.page.width - 80, 15).fill(opts.fill);
    doc.fillColor('#111').font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    for (const c of cols) doc.text(c.text, c.x, y, { width: c.w, align: c.align ?? 'left', lineBreak: false, ellipsis: true });
    doc.x = 40;
    doc.y = y + 15;
  }

  private inningsPdf(doc: PDFKit.PDFDocument, inn: InningsCard) {
    this.ensureSpace(doc, 80);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0b3d2e');
    doc.text(`${inn.isSuperOver ? 'Super Over - ' : ''}${inn.battingTeam.name}  ${inn.total.runs}/${inn.total.wickets} (${inn.total.overs} ov, RR ${inn.total.runRate})`, 40);
    doc.moveDown(0.3);
    const bat = [
      { x: 40, w: 130 },
      { x: 172, w: 190 },
      { x: 365, w: 35, align: 'right' as const },
      { x: 402, w: 35, align: 'right' as const },
      { x: 439, w: 30, align: 'right' as const },
      { x: 471, w: 30, align: 'right' as const },
      { x: 503, w: 50, align: 'right' as const },
    ];
    this.row(doc, ['Batter', '', 'R', 'B', '4s', '6s', 'SR'].map((t, i) => ({ ...bat[i], text: t })), { bold: true, fill: '#e8f3ee' });
    for (const b of inn.batting) {
      this.row(doc, [b.name, b.dismissal, String(b.runs), String(b.balls), String(b.fours), String(b.sixes), b.strikeRate.toFixed(2)].map((t, i) => ({ ...bat[i], text: t })));
    }
    const e = inn.extras;
    this.row(doc, [{ ...bat[0], text: 'Extras' }, { ...bat[1], text: `(wd ${e.wides}, nb ${e.noBalls}, b ${e.byes}, lb ${e.legByes}, p ${e.penalty})` }, { ...bat[2], text: String(e.total) }]);
    this.row(doc, [{ ...bat[0], text: 'Total' }, { ...bat[1], text: `${inn.total.wickets} wkts, ${inn.total.overs} ov` }, { ...bat[2], text: String(inn.total.runs) }], { bold: true });
    if (inn.didNotBat.length) {
      doc.font('Helvetica').fontSize(8.5).fillColor('#444').text(`Did not bat: ${inn.didNotBat.map((p) => p.name).join(', ')}`, 40, doc.y + 2, { width: doc.page.width - 80 });
    }
    if (inn.fallOfWickets.length) {
      doc.moveDown(0.3).fontSize(8.5).text(`Fall of wickets: ${inn.fallOfWickets.map((f) => `${f.score}-${f.wicketNumber} (${f.name}, ${f.overLabel})`).join(', ')}`, 40, doc.y, { width: doc.page.width - 80 });
    }
    doc.moveDown(0.6);
    const bowl = [
      { x: 40, w: 200 },
      { x: 250, w: 45, align: 'right' as const },
      { x: 300, w: 35, align: 'right' as const },
      { x: 340, w: 40, align: 'right' as const },
      { x: 385, w: 35, align: 'right' as const },
      { x: 425, w: 50, align: 'right' as const },
      { x: 480, w: 35, align: 'right' as const },
      { x: 518, w: 35, align: 'right' as const },
    ];
    this.row(doc, ['Bowler', 'O', 'M', 'R', 'W', 'Econ', 'Wd', 'Nb'].map((t, i) => ({ ...bowl[i], text: t })), { bold: true, fill: '#e8f3ee' });
    for (const b of inn.bowling) {
      this.row(doc, [b.name, b.overs, String(b.maidens), String(b.runs), String(b.wickets), b.economy.toFixed(2), String(b.wides), String(b.noBalls)].map((t, i) => ({ ...bowl[i], text: t })));
    }
    doc.moveDown(1);
  }

  private awardsPdf(doc: PDFKit.PDFDocument, card: Scorecard) {
    if (!card.awards.length) return;
    this.ensureSpace(doc, 40 + card.awards.length * 14);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#0b3d2e').text('Awards', 40);
    doc.moveDown(0.3);
    for (const a of card.awards) {
      const who = a.secondPlayer ? `${a.player?.name} & ${a.secondPlayer.name}` : (a.player?.name ?? '-');
      this.row(doc, [
        { x: 40, w: 160, text: AWARD_LABEL[a.type] ?? a.type },
        { x: 205, w: 200, text: who },
        { x: 410, w: 145, text: a.value ?? '', align: 'right' },
      ]);
    }
  }

  async scorecardPdf(matchId: string) {
    const card = await this.state.scorecard(matchId);
    const buf = await this.pdf(`Scorecard - ${card.match.teamA.name} vs ${card.match.teamB.name}`, (doc) => {
      this.header(doc, card, 'Full Scorecard');
      card.innings.forEach((inn) => this.inningsPdf(doc, inn));
      this.awardsPdf(doc, card);
    });
    return { buffer: buf, filename: `${this.fileBase(card)}-scorecard.pdf` };
  }

  async summaryPdf(matchId: string) {
    const card = await this.state.scorecard(matchId);
    const buf = await this.pdf(`Match Summary - ${card.match.teamA.name} vs ${card.match.teamB.name}`, (doc) => {
      this.header(doc, card, 'Match Summary');
      for (const inn of card.innings) {
        this.ensureSpace(doc, 120);
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#0b3d2e').text(`${inn.isSuperOver ? 'Super Over - ' : ''}${inn.battingTeam.name}  ${inn.total.runs}/${inn.total.wickets} (${inn.total.overs})`, 40);
        doc.moveDown(0.2);
        const bats = [...inn.batting].sort((a, b) => b.runs - a.runs).slice(0, 3);
        const bowls = [...inn.bowling].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs).slice(0, 3);
        for (let i = 0; i < Math.max(bats.length, bowls.length); i++) {
          const b = bats[i];
          const w = bowls[i];
          this.row(doc, [
            { x: 40, w: 170, text: b ? b.name : '' },
            { x: 210, w: 60, text: b ? `${b.runs}${b.isOut ? '' : '*'} (${b.balls})` : '', align: 'right' },
            { x: 300, w: 170, text: w ? w.name : '' },
            { x: 470, w: 85, text: w ? `${w.wickets}/${w.runs} (${w.overs})` : '', align: 'right' },
          ]);
        }
        doc.moveDown(0.8);
      }
      this.awardsPdf(doc, card);
    });
    return { buffer: buf, filename: `${this.fileBase(card)}-summary.pdf` };
  }

  // ─────────────── images (SVG → PNG) ───────────────

  private svgFooter(width: number, y: number) {
    return `<text x="${width / 2}" y="${y}" font-family="${FONT}" font-size="22" fill="#9fd3bd" text-anchor="middle">${esc(BRANDING)}</text>`;
  }

  /** Tall scorecard image with batting & bowling tables for every innings. */
  async scorecardPng(matchId: string) {
    const card = await this.state.scorecard(matchId);
    const W = 1080;
    let y = 0;
    const parts: string[] = [];
    const text = (x: number, yy: number, s: unknown, size = 24, opts: { bold?: boolean; fill?: string; anchor?: 'start' | 'end' | 'middle' } = {}) =>
      `<text x="${x}" y="${yy}" font-family="${FONT}" font-size="${size}" ${opts.bold ? 'font-weight="bold"' : ''} fill="${opts.fill ?? '#1b1b1b'}" text-anchor="${opts.anchor ?? 'start'}">${esc(s)}</text>`;

    y = 70;
    parts.push(text(W / 2, y, `${card.match.teamA.name} vs ${card.match.teamB.name}`, 40, { bold: true, fill: '#fff', anchor: 'middle' }));
    y += 42;
    parts.push(text(W / 2, y, [card.match.tournament?.name, card.match.ground].filter(Boolean).join(' • ') || 'Match Scorecard', 24, { fill: '#cde7db', anchor: 'middle' }));
    if (card.match.resultText) {
      y += 42;
      parts.push(text(W / 2, y, card.match.resultText, 28, { bold: true, fill: '#ffd54f', anchor: 'middle' }));
    }
    const headerH = y + 30;
    y = headerH + 50;

    for (const inn of card.innings) {
      parts.push(`<rect x="30" y="${y - 36}" width="${W - 60}" height="52" rx="10" fill="#0b3d2e"/>`);
      parts.push(text(50, y, `${inn.isSuperOver ? 'Super Over • ' : ''}${trunc(inn.battingTeam.name, 28)}`, 28, { bold: true, fill: '#fff' }));
      parts.push(text(W - 50, y, `${inn.total.runs}/${inn.total.wickets} (${inn.total.overs})`, 28, { bold: true, fill: '#fff', anchor: 'end' }));
      y += 50;
      parts.push(text(50, y, 'Batter', 20, { bold: true, fill: '#555' }));
      ['R', 'B', '4s', '6s', 'SR'].forEach((h, i) => parts.push(text(700 + i * 75, y, h, 20, { bold: true, fill: '#555', anchor: 'end' })));
      y += 36;
      for (const b of inn.batting) {
        parts.push(text(50, y, trunc(b.name, 24), 24, { bold: !b.isOut }));
        parts.push(text(50, y + 24, trunc(b.dismissal, 42), 18, { fill: '#777' }));
        [b.runs, b.balls, b.fours, b.sixes, b.strikeRate.toFixed(1)].forEach((v, i) => parts.push(text(700 + i * 75, y, v, 24, { bold: i === 0, anchor: 'end' })));
        y += 58;
      }
      parts.push(text(50, y, `Extras ${inn.extras.total}  (wd ${inn.extras.wides}, nb ${inn.extras.noBalls}, b ${inn.extras.byes}, lb ${inn.extras.legByes})`, 20, { fill: '#555' }));
      y += 44;
      parts.push(text(50, y, 'Bowler', 20, { bold: true, fill: '#555' }));
      ['O', 'M', 'R', 'W', 'Econ'].forEach((h, i) => parts.push(text(700 + i * 75, y, h, 20, { bold: true, fill: '#555', anchor: 'end' })));
      y += 36;
      for (const b of inn.bowling) {
        parts.push(text(50, y, trunc(b.name, 26), 24));
        [b.overs, b.maidens, b.runs, b.wickets, b.economy.toFixed(1)].forEach((v, i) => parts.push(text(700 + i * 75, y, v, 24, { bold: i === 3, anchor: 'end' })));
        y += 40;
      }
      y += 50;
    }
    const mom = card.awards.find((a) => a.type === 'MAN_OF_THE_MATCH');
    if (mom?.player) {
      parts.push(text(W / 2, y, `Player of the Match: ${mom.player.name}`, 28, { bold: true, fill: '#0b3d2e', anchor: 'middle' }));
      y += 50;
    }
    const H = y + 60;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect width="100%" height="100%" fill="#f7faf8"/>` +
      `<rect width="100%" height="${headerH}" fill="#0b3d2e"/>` +
      parts.join('') +
      `<rect y="${H - 50}" width="100%" height="50" fill="#0b3d2e"/>` +
      this.svgFooter(W, H - 17) +
      `</svg>`;
    return { buffer: await sharp(Buffer.from(svg)).png().toBuffer(), filename: `${this.fileBase(card)}-scorecard.png` };
  }

  /** Square 1080×1080 share card optimised for WhatsApp / social. */
  async sharePng(matchId: string) {
    const card = await this.state.scorecard(matchId);
    const S = 1080;
    const main = card.innings.filter((i) => !i.isSuperOver);
    const mom = card.awards.find((a) => a.type === 'MAN_OF_THE_MATCH');
    const t = (x: number, y: number, s: unknown, size: number, fill = '#fff', bold = false, anchor = 'middle') =>
      `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" ${bold ? 'font-weight="bold"' : ''}>${esc(s)}</text>`;
    const rows = main
      .map((inn, i) => {
        const y = 420 + i * 170;
        const topBat = [...inn.batting].sort((a, b) => b.runs - a.runs)[0];
        const topBowl = [...card.innings.find((x) => x.number === inn.number)!.bowling].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0];
        return (
          `<rect x="60" y="${y - 70}" width="${S - 120}" height="150" rx="24" fill="#ffffff" fill-opacity="0.08"/>` +
          t(100, y - 10, trunc(inn.battingTeam.name, 22), 44, '#fff', true, 'start') +
          t(S - 100, y - 10, `${inn.total.runs}/${inn.total.wickets}`, 60, '#ffd54f', true, 'end') +
          t(S - 100, y + 40, `${inn.total.overs} ov`, 28, '#cde7db', false, 'end') +
          t(100, y + 40, [topBat && `${trunc(topBat.name, 16)} ${topBat.runs}(${topBat.balls})`, topBowl && `${trunc(topBowl.name, 14)} ${topBowl.wickets}/${topBowl.runs}`].filter(Boolean).join('  •  '), 26, '#cde7db', false, 'start')
        );
      })
      .join('');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b3d2e"/><stop offset="1" stop-color="#14614a"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      t(S / 2, 120, card.match.tournament?.name ?? 'MATCH RESULT', 34, '#9fd3bd', true) +
      t(S / 2, 200, `${trunc(card.match.teamA.name, 20)} vs ${trunc(card.match.teamB.name, 20)}`, 52, '#fff', true) +
      t(S / 2, 262, card.match.ground ?? '', 28, '#cde7db') +
      rows +
      t(S / 2, 800, card.match.resultText ?? 'Match in progress', 44, '#ffd54f', true) +
      (mom?.player ? t(S / 2, 880, `Player of the Match: ${trunc(mom.player.name, 24)}`, 34, '#fff') : '') +
      this.svgFooter(S, S - 40) +
      `</svg>`;
    return { buffer: await sharp(Buffer.from(svg)).png().toBuffer(), filename: `${this.fileBase(card)}-share.png` };
  }
}
