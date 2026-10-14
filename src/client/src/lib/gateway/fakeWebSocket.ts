import type { GatewaySocket } from "./gatewayClient";

/** Test double: tests drive the server side through open()/serverSend()/serverClose(). */
export class FakeWebSocket implements GatewaySocket {
  static instances: FakeWebSocket[] = [];
  onopen: GatewaySocket["onopen"] = null;
  onmessage: GatewaySocket["onmessage"] = null;
  onclose: GatewaySocket["onclose"] = null;
  onerror: GatewaySocket["onerror"] = null;
  sent: Array<Record<string, any>> = [];
  closed = false;
  private waiters: Array<{ index: number; resolve: (frame: Record<string, any>) => void }> = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }

  send(data: string): void {
    const frame = JSON.parse(data);
    this.sent.push(frame);
    const index = this.sent.length - 1;
    for (const waiter of this.waiters.filter((item) => item.index === index)) waiter.resolve(frame);
    this.waiters = this.waiters.filter((item) => item.index !== index);
  }

  /** Resolves with the frame the client sends at `index` the moment it sends it (tests await this instead of guessing a delay). */
  frame(index: number): Promise<Record<string, any>> {
    const existing = this.sent[index];
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => this.waiters.push({ index, resolve }));
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.({});
  }

  serverSend(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  serverClose(): void {
    this.onclose?.({ code: 1006 });
  }
}
