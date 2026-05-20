import { AgentEvent } from './events';

export class EventQueue {
  private events: AgentEvent[] = [];
  private resolvers: Array<(e: IteratorResult<AgentEvent>) => void> = [];
  private done = false;

  push(event: AgentEvent) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: event, done: false });
    } else {
      this.events.push(event);
    }
  }

  end() {
    this.done = true;
    while (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<AgentEvent> {
    while (true) {
      if (this.events.length > 0) {
        yield this.events.shift()!;
      } else if (this.done) {
        return;
      } else {
        const result = await new Promise<IteratorResult<AgentEvent>>((resolve) => {
          this.resolvers.push(resolve);
        });
        if (result.done) return;
        yield result.value;
      }
    }
  }
}
