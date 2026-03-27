export function nodeToWebWritable(nodeStream: NodeJS.WritableStream): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        const ok = nodeStream.write(chunk);
        if (ok) { resolve(); return; }
        (nodeStream as any).once("drain", resolve);
        (nodeStream as any).once("error", reject);
      });
    },
    close() {
      (nodeStream as any).end();
    },
    abort(reason) {
      (nodeStream as any).destroy(reason instanceof Error ? reason : new Error(String(reason)));
    },
  });
}

export function nodeToWebReadable(nodeStream: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      (nodeStream as any).destroy();
    },
  });
}
