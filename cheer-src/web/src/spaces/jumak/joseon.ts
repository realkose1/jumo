// 조선풍 그리기 도구: 누런 한지 바탕과 광곽(테두리), 주홍 낙관, 명조 글꼴, 옛 시진과 옛 말투 시계.
// 주막 TV(tv.ts)와 중계 화면(broadcast.ts)이 같이 쓴다.

/** 명조(바탕) 계열: 붓글씨 느낌의 세리프. 기기에 없으면 다음 것으로 */
export const SERIF = '"Nanum Myeongjo", "Noto Serif KR", "Noto Serif CJK KR", AppleMyungjo, "Apple SD Gothic Neo", Batang, serif';

/** 한지와 먹, 주홍 */
export const PAPER = {
  light: '#e4d0a4',
  dark: '#c9ad79',
  ink: '#21170e',
  soft: '#4f3f2c',
  dim: '#7d6748',
  red: '#a8251c',
  redInk: '#f7ead0',
} as const;

/** 한지 결: 한 번 그려 두고 바탕마다 겹친다 */
let paperGrain: HTMLCanvasElement | null = null;
function grain(): HTMLCanvasElement | null {
  if (paperGrain || typeof document === 'undefined') return paperGrain;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  if (!g) return null;
  let s = 7;
  const r = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    // 짧은 닥나무 섬유
    const x = r() * 256;
    const y = r() * 256;
    const a = r() * Math.PI;
    const len = 4 + r() * 14;
    g.strokeStyle = `rgba(${r() < 0.5 ? '255,250,235' : '120,90,50'},${0.05 + r() * 0.08})`;
    g.lineWidth = 0.6 + r() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  paperGrain = c;
  return c;
}

/** 누런 한지 바탕과 이중 테두리(광곽). 가장자리는 오래된 종이처럼 조금 어둡다 */
export function drawPaper(ctx: CanvasRenderingContext2D, w = 1024, h = 576): void {
  const bg = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, w * 0.7);
  bg.addColorStop(0, PAPER.light);
  bg.addColorStop(1, PAPER.dark);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const gr = grain();
  if (gr) {
    const pat = ctx.createPattern(gr, 'repeat');
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, w, h);
    }
  }
  // 광곽: 바깥 굵은 선 + 안쪽 가는 선
  ctx.strokeStyle = 'rgba(40,24,10,0.75)';
  ctx.lineWidth = 5;
  ctx.strokeRect(9, 9, w - 18, h - 18);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(17, 17, w - 34, h - 34);
}

/** 주홍 낙관(도장): 네모 안에 글자. 두 글자는 위아래로, 네 글자는 오른쪽 줄부터 두 줄로 */
export function drawSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, size: number): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.06);
  ctx.fillStyle = 'rgba(168,37,28,0.92)';
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.strokeStyle = 'rgba(247,234,208,0.85)';
  ctx.lineWidth = Math.max(1.5, size * 0.04);
  ctx.strokeRect(-size / 2 + size * 0.09, -size / 2 + size * 0.09, size * 0.82, size * 0.82);
  ctx.fillStyle = '#f7ead0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const chars = [...text];
  if (chars.length <= 1) {
    ctx.font = `900 ${size * 0.62}px ${SERIF}`;
    ctx.fillText(text, 0, size * 0.03);
  } else {
    const cols = chars.length > 2 ? 2 : 1;
    const rows = Math.ceil(chars.length / cols);
    const fs = (size * 0.74) / Math.max(rows, cols);
    ctx.font = `900 ${fs}px ${SERIF}`;
    chars.forEach((ch, i) => {
      const col = cols === 1 ? 0 : 1 - Math.floor(i / rows);
      const row = i % rows;
      const x = cols === 1 ? 0 : (col - 0.5) * fs * 1.05;
      const y = (row - (rows - 1) / 2) * fs * 1.05;
      ctx.fillText(ch, x, y + fs * 0.04);
    });
  }
  ctx.restore();
}

const SIJIN = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
/** 시각 -> 옛 시진 이름. 23~1시가 자시, 1~3시가 축시 … 21~23시가 해시 */
export function sijin(hour: number): string {
  return `${SIJIN[Math.floor(((hour + 1) % 24) / 2)]}시`;
}

/** 경기 시계를 옛 말투로: "34'" -> "34분", "HT" -> "쉬는 참", "22:00 시작" -> "해시 22:00 개전", "종료" -> "파장 · 경기 끝" */
export function oldClock(state: 'pre' | 'live' | 'final', clock: string): string {
  const c = clock.trim();
  if (state === 'final') return '파장 · 경기 끝';
  if (state === 'pre') {
    const m = /(\d{1,2}):(\d{2})/.exec(c);
    if (m) return `${sijin(Number(m[1]))} ${m[1]!.padStart(2, '0')}:${m[2]} 개전`;
    return c ? c.replace('시작', '개전') : '곧 개전';
  }
  if (/^HT$/i.test(c)) return '쉬는 참';
  const min = /^(\d+)(\+\d+)?'$/.exec(c);
  if (min) return `${min[1]}${min[2] ?? ''}분`;
  return c || '겨루는 중';
}
