import { exports } from 'cloudflare:workers';
import type { ClientMsg, ServerMsg } from '../../shared/protocol';

let counter = 0;
export function newDev(): string {
  counter++;
  return `dev-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 시험용 클라이언트: 받은 메시지를 모아 두고, 조건에 맞는 메시지가 올 때까지 기다린다 */
export class TestClient {
  readonly inbox: ServerMsg[] = [];
  closed: { code: number; reason: string } | null = null;
  private waiters: Array<() => void> = [];
  private taken = new Set<number>();

  private constructor(readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      this.inbox.push(JSON.parse(String(e.data)) as ServerMsg);
      this.wake();
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code, reason: e.reason };
      this.wake();
    });
  }

  /** 연결만 한다(join은 따로) */
  static async connect(query: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const res = await exports.default.fetch(`http://presence.test/ws?${query}`, {
      headers: { Upgrade: 'websocket', ...headers },
    });
    if (!res.webSocket) throw new Error(`no websocket: ${res.status} ${await res.text()}`);
    res.webSocket.accept();
    return new TestClient(res.webSocket);
  }

  /** 연결하고 join까지 보낸 뒤 welcome을 기다린다 */
  static async join(
    space: string,
    room: number,
    opts: { dev?: string; x?: number; z?: number; r?: number; headers?: Record<string, string> } = {},
  ): Promise<TestClient & { welcome: Extract<ServerMsg, { t: 'welcome' }> }> {
    const c = await TestClient.connect(`space=${space}&room=${room}`, opts.headers);
    c.send({ t: 'join', space, room, dev: opts.dev ?? newDev(), x: opts.x, z: opts.z, r: opts.r });
    const welcome = await c.next('welcome');
    return Object.assign(c, { welcome });
  }

  send(msg: ClientMsg | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  private wake(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  /** 아직 꺼내지 않은 메시지 중 조건에 맞는 첫 번째를 꺼낸다(맞지 않는 것들은 그대로 남는다) */
  async next<T extends ServerMsg['t']>(
    type: T,
    pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<Extract<ServerMsg, { t: T }>> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = 0; i < this.inbox.length; i++) {
        const m = this.inbox[i]!;
        if (this.taken.has(i) || m.t !== type || !pred(m as Extract<ServerMsg, { t: T }>)) continue;
        this.taken.add(i);
        return m as Extract<ServerMsg, { t: T }>;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout waiting for '${type}'; got ${JSON.stringify(this.inbox.slice(-5))}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  /** 앞으로 ms 동안 조건에 맞는 메시지가 오지 않아야 한다. 왔으면 그 메시지를 돌려준다 */
  async none<T extends ServerMsg['t']>(
    type: T,
    ms = 300,
    pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMsg, { t: T }> | null> {
    try {
      return await this.next(type, pred, ms);
    } catch {
      return null;
    }
  }

  async closedWithin(ms = 3000): Promise<{ code: number; reason: string }> {
    const deadline = Date.now() + ms;
    while (!this.closed) {
      if (Date.now() > deadline) throw new Error('not closed');
      await sleep(10);
    }
    return this.closed;
  }

  close(): void {
    try {
      this.ws.close(1000, 'test-done');
    } catch {
      // 이미 닫혔다
    }
  }
}

/** 다음 1초 창이 막 시작될 때까지 기다린다(속도 제한 시험에서 창이 중간에 바뀌지 않게) */
export async function waitForFreshSecond(): Promise<void> {
  const into = Date.now() % 1000;
  if (into > 50) await sleep(1000 - into + 5);
}
