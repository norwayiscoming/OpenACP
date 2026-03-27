export interface ITextBuffer {
  append(text: string): void;
  flush(): Promise<void>;
  destroy(): void;
}

export interface ISendQueue<T = unknown> {
  enqueue<R>(fn: () => Promise<R>): Promise<R>;
}
