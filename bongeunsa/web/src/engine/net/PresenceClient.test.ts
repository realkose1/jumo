import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE, type ServerMsg, type WelcomeMsg } from '@shared/protocol';
import { PresenceClient, type PresenceClientOptions, type PresenceStatus, type SocketLike, type VisibilityLike } from './PresenceClient';

class FakeSocket implements SocketLike {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  closedWith: number | null = null;

  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code = 1000): void {
    this.closedWith = code;
    this.readyState = 3;
  }
  // 시험에서 서버 역할
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(msg: ServerMsg | 'pong'): void {
    this.onmessage?.({ data: msg === 'pong' ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  json(): Array<Record<string, unknown>> {
    return this.sent.filter((s) => s.startsWith('{')).map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

const welcome = (over: Partial<WelcomeMsg> = {}): WelcomeMsg => ({
  t: 'welcome',
  id: 7,
  name: { ko: '조용한 구름' },
  space: 'test-room',
  room: 3,
  capacity: 50,
  peers: [],
  seats: {},
  now: 1_000_000,
  limits: { moveHz: 10, stateHz: 2, actCooldownMs: 1000 },
  ...over,
});

function fakeVisibility(): VisibilityLike & { hidden: boolean; show(): void } {
  let handler: (() => void) | null = null;
  const v = {
    hidden: false,
    isHidden: () => v.hidden,
    onVisible(fn: () => void) {
      handler = fn;
      return () => {
        handler = null;
      };
    },
    show() {
      v.hidden = false;
      handler?.();
    },
  };
  return v;
}

function make(over: Partial<PresenceClientOptions> = {}) {
  const visibility = fakeVisibility();
  const client = new PresenceClient({
    url: 'ws://localhost:8797/',
    spaceId: 'test-room',
    deviceId: 'dev-1234567890',
    createSocket: (u) => new FakeSocket(u),
    visibility,
    random: () => 1, // 기다리는 시간을 상한으로
    ...over,
  });
  const statuses: PresenceStatus[] = [];
  client.on('status', (e) => statuses.push(e.status));
  return { client, visibility, statuses };
}

const last = () => FakeSocket.all[FakeSocket.all.length - 1]!;

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe('연결과 join', () => {
  it('주소에 공간과 방을 담아 연결하고, 열리면 join을 보낸다', () => {
    const { client, statuses } = make({ room: 3, getSpawn: () => ({ x: 1, z: 2, r: 0.5 }) });
    client.start();
    expect(last().url).toBe('ws://localhost:8797/ws?space=test-room&room=3');
    expect(statuses).toEqual(['connecting']);
    last().open();
    expect(last().json()[0]).toEqual({ t: 'join', space: 'test-room', dev: 'dev-1234567890', room: 3, x: 1, z: 2, r: 0.5 });
  });

  it('방을 정하지 않으면 room 없이 연결하고, welcome의 방을 기억한다', () => {
    const { client } = make();
    client.start();
    expect(last().url).toBe('ws://localhost:8797/ws?space=test-room');
    last().open();
    expect(last().json()[0]).not.toHaveProperty('room');
    last().receive(welcome({ room: 5 }));
    expect(client.currentRoom).toBe(5);
    expect(client.status).toBe('online');
    expect(client.myId).toBe(7);
    expect(client.myName).toEqual({ ko: '조용한 구름' });
  });

  it('http 주소도 ws로 바꿔 쓴다', () => {
    const { client } = make({ url: 'https://presence.example.com' });
    client.start();
    expect(last().url.startsWith('wss://presence.example.com/ws?')).toBe(true);
  });

  it('기기 식별값 모양이 틀리면 연결하지 않고 혼자 모드', () => {
    const { client, statuses } = make({ deviceId: 'x' });
    client.start();
    expect(FakeSocket.all).toHaveLength(0);
    expect(statuses).toEqual(['offline']);
  });

  it('받은 메시지를 종류별로 알려준다 (모르는 것과 깨진 것은 무시)', () => {
    const { client } = make();
    const got: string[] = [];
    client.on('peer-join', (m) => got.push(`join:${m.peer.id}`));
    client.on('peer-leave', (m) => got.push(`leave:${m.id}`));
    client.start();
    last().open();
    last().receive(welcome());
    last().receive({ t: 'peer-join', peer: { id: 9, name: { ko: '하나' }, x: 0, z: 0, r: 0 } });
    last().onmessage?.({ data: '{깨진 json' });
    last().onmessage?.({ data: JSON.stringify({ t: 'mystery' }) });
    last().onmessage?.({ data: new ArrayBuffer(2) });
    last().receive({ t: 'peer-leave', id: 9 });
    expect(got).toEqual(['join:9', 'leave:9']);
  });

  it('모양이 틀린 welcome이면 연결을 접고 다시 시도한다', () => {
    const { client } = make();
    client.start();
    last().open();
    last().onmessage?.({ data: JSON.stringify({ t: 'welcome', id: 'x' }) });
    expect(client.status).not.toBe('online');
    expect(last().closedWith).toBe(4000);
  });
});

describe('보내기', () => {
  it('온라인이 아니면 보내지 않는다 (쌓아 두지 않는다)', () => {
    const { client } = make();
    expect(client.sendAct('hop-small')).toBe(false);
    client.start();
    last().open();
    expect(client.sendMove(1, 1, 0)).toBe(false); // welcome 전
    last().receive(welcome());
    expect(client.sendMove(1, 1, 0)).toBe(true);
    expect(client.sendSit('a1')).toBe(true);
    expect(client.sendStand()).toBe(true);
    expect(client.sendAct('hop-greet')).toBe(true);
    expect(client.sendAct('hop-greet', 4)).toBe(true);
    expect(client.sendState('lamp', 1)).toBe(true);
    const sent = last().json().slice(1);
    expect(sent).toEqual([
      { t: 'move', x: 1, z: 1, r: 0 },
      { t: 'sit', seat: 'a1' },
      { t: 'stand' },
      { t: 'act', act: 'hop-greet' },
      { t: 'act', act: 'hop-greet', to: 4 },
      { t: 'state', key: 'lamp', val: 1 },
    ]);
  });
});

describe('재접속', () => {
  it('끊기면 기다렸다가 같은 방으로 다시 연결하고, 간격은 점점 늘어난다', () => {
    const { client, statuses } = make();
    client.start();
    last().open();
    last().receive(welcome({ room: 4 }));
    last().drop();
    expect(statuses.at(-1)).toBe('reconnecting');

    vi.advanceTimersByTime(999);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
    expect(last().url).toContain('room=4');

    // 이번엔 열리지도 못하고 또 끊긴다: 2초 뒤
    last().drop();
    vi.advanceTimersByTime(1999);
    expect(FakeSocket.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(3);

    // 그다음은 4초
    last().drop();
    vi.advanceTimersByTime(3999);
    expect(FakeSocket.all).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(4);
  });

  it('간격은 30초를 넘지 않는다', () => {
    const { client } = make();
    client.start();
    for (let i = 0; i < 12; i++) {
      last().drop();
      vi.advanceTimersByTime(30_000);
    }
    const before = FakeSocket.all.length;
    last().drop();
    vi.advanceTimersByTime(29_999);
    expect(FakeSocket.all).toHaveLength(before);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(before + 1);
  });

  it('처음부터 못 붙으면 offline(혼자 모드)이고, 포기하지 않는다', () => {
    const { client, statuses } = make();
    client.start();
    last().drop();
    expect(statuses).toEqual(['connecting', 'offline']);
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.all.length).toBeGreaterThan(2);
  });

  it('다시 붙으면 옛 연결의 늦은 메시지는 무시한다', () => {
    const { client } = make();
    const joins: number[] = [];
    client.on('peer-join', (m) => joins.push(m.peer.id));
    client.start();
    const old = last();
    old.open();
    old.receive(welcome());
    old.drop();
    vi.advanceTimersByTime(1000);
    const fresh = last();
    fresh.open();
    fresh.receive(welcome({ id: 8 }));
    old.receive({ t: 'peer-join', peer: { id: 99, name: { ko: '옛' }, x: 0, z: 0, r: 0 } });
    expect(joins).toEqual([]);
    expect(client.myId).toBe(8);
  });

  it('탭이 숨겨져 있으면 서두르지 않고, 다시 보이면 곧바로 붙는다', () => {
    const { client, visibility } = make();
    client.start();
    last().open();
    last().receive(welcome());
    visibility.hidden = true;
    last().drop();
    vi.advanceTimersByTime(29_000);
    expect(FakeSocket.all).toHaveLength(1);
    visibility.show();
    vi.advanceTimersByTime(299);
    expect(FakeSocket.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('안정적으로 10초 넘게 붙어 있었으면 간격을 처음부터 센다', () => {
    const { client } = make();
    client.start();
    last().drop();
    vi.advanceTimersByTime(1000); // 1번째 재시도
    last().drop();
    vi.advanceTimersByTime(2000); // 2번째 재시도 (다음은 4초)
    last().open();
    last().receive(welcome());
    vi.advanceTimersByTime(10_001);
    last().drop();
    const n = FakeSocket.all.length;
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(n + 1);
  });

  it('붙자마자 반복해서 끊기는 연결은 간격이 계속 늘어난다 (몰아치지 않는다)', () => {
    const { client } = make();
    client.start();
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      last().open();
      last().receive(welcome());
      last().drop(1011); // 서버 오류로 닫힘(4003~4005는 다시 시도하지 않으므로 여기서 쓰지 않는다)
      const before = FakeSocket.all.length;
      let waited = 0;
      while (FakeSocket.all.length === before && waited < 300_000) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      delays.push(waited);
    }
    expect(delays[3]!).toBeGreaterThan(delays[0]!);
  });
});

describe('다시 시도하지 않는 경우', () => {
  it('정원 초과: room-full을 알리고 멈춘다', () => {
    const { client, statuses } = make();
    let rec: number | null | undefined;
    client.on('room-full', (m) => (rec = m.rec));
    client.start();
    last().open();
    last().receive({ t: 'room-full', rec: 2 });
    last().drop(CLOSE.roomFull);
    vi.advanceTimersByTime(120_000);
    expect(rec).toBe(2);
    expect(statuses.at(-1)).toBe('full');
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('같은 기기가 다른 탭으로 들어와 밀려나면 다시 붙지 않는다', () => {
    const { client, statuses } = make();
    client.start();
    last().open();
    last().receive(welcome());
    last().drop(CLOSE.replaced);
    vi.advanceTimersByTime(120_000);
    expect(statuses.at(-1)).toBe('replaced');
    expect(FakeSocket.all).toHaveLength(1);
  });

  it('stop하면 멈추고 더는 연결하지 않는다', () => {
    const { client } = make();
    client.start();
    last().open();
    last().receive(welcome());
    client.stop();
    expect(last().closedWith).toBe(1000);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(client.status).toBe('idle');
  });
});

describe('방 옮기기', () => {
  it('setRoom은 바로 새 방으로 다시 연결한다', () => {
    const { client } = make({ room: 9 });
    client.start();
    last().drop();
    client.setRoom(null);
    expect(FakeSocket.all).toHaveLength(2);
    expect(last().url).not.toContain('room=');
  });
});

describe('연결 유지와 시간 보정', () => {
  it('25초마다 글자 ping을 보낸다 (JSON이 아닌 글자)', () => {
    const { client } = make();
    client.start();
    last().open();
    last().receive(welcome());
    vi.advanceTimersByTime(25_000);
    expect(last().sent).toContain('ping');
    last().receive('pong');
  });

  it('아무 소식이 75초 넘게 없으면 끊어진 것으로 보고 다시 붙인다', () => {
    const { client, statuses } = make();
    client.start();
    last().open();
    last().receive(welcome());
    const first = last();
    vi.advanceTimersByTime(100_000); // 25초마다 살피니 100초째에 알아챈다
    expect(first.closedWith).toBe(4000);
    expect(statuses).toContain('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all.length).toBeGreaterThan(1);
  });

  it('welcome으로 먼저 맞추고, ping으로 잰 값 중 왕복이 가장 짧은 것을 쓴다', () => {
    const { client } = make();
    const times: Array<{ offsetMs: number; rttMs: number; provisional: boolean }> = [];
    client.on('time', (t) => times.push(t));
    client.start();
    last().open();
    // 서버 시계는 기기보다 5000ms 앞서 있다
    last().receive(welcome({ now: 1_000_000 + 5000 }));
    expect(times[0]).toMatchObject({ offsetMs: 5000, provisional: true });

    const answerPing = (delayMs: number, serverAhead: number) => {
      const ping = last().json().filter((m) => m.t === 'ping').at(-1)!;
      const sentAt = Date.now();
      vi.setSystemTime(sentAt + delayMs);
      last().receive({ t: 'pong', c: ping.c as number, now: sentAt + delayMs / 2 + serverAhead });
    };
    vi.advanceTimersByTime(300);
    answerPing(200, 5000); // 왕복 200
    vi.advanceTimersByTime(600);
    answerPing(40, 5000); // 왕복 40: 이 값이 쓰인다
    vi.advanceTimersByTime(900);
    answerPing(300, 5100); // 왕복이 길어 무시
    const best = client.getTimeSample()!;
    expect(best.rttMs).toBe(40);
    expect(best.offsetMs).toBeCloseTo(5000, 5);
    expect(times.at(-1)).toMatchObject({ rttMs: 40, provisional: false });
  });

  it('남의 ping 답(보낸 적 없는 c)은 시간 보정에 쓰지 않는다', () => {
    const { client } = make();
    client.start();
    last().open();
    last().receive(welcome());
    last().receive({ t: 'pong', c: 123, now: 999 });
    expect(client.getTimeSample()?.rttMs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('서버가 들이지 않음 (다시 시도하지 않는다)', () => {
  for (const [label, code] of [
    ['같은 IP 연결 초과', CLOSE.tooManyFromIp],
    ['잘못된 join', CLOSE.badJoin],
    ['너무 잦은 메시지', CLOSE.abuse],
  ] as const) {
    it(`${label}(${code})면 denied로 멈추고 다시 연결하지 않는다`, () => {
      const { client, statuses, visibility } = make();
      client.start();
      last().open();
      if (code === CLOSE.abuse) last().receive(welcome());
      last().drop(code);
      expect(client.status).toBe('denied');
      expect(client.deniedCode).toBe(code);
      expect(statuses.at(-1)).toBe('denied');
      vi.advanceTimersByTime(120_000);
      visibility.show();
      client.setRoom(2);
      vi.advanceTimersByTime(120_000);
      expect(FakeSocket.all).toHaveLength(1);
    });
  }

  it('다른 닫힘(1006)은 그대로 다시 시도하고, stop 뒤 다시 start하면 처음부터', () => {
    const { client } = make();
    client.start();
    last().open();
    last().drop(1006);
    expect(client.status).toBe('offline');
    expect(client.deniedCode).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(FakeSocket.all).toHaveLength(2);

    last().open();
    last().drop(CLOSE.tooManyFromIp);
    expect(client.status).toBe('denied');
    client.stop();
    expect(client.deniedCode).toBeNull();
    client.start();
    expect(client.status).toBe('connecting');
  });
});
