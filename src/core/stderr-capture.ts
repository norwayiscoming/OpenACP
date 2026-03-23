export class StderrCapture {
  private lines: string[] = []

  constructor(private maxLines: number = 50) {}

  append(chunk: string): void {
    this.lines.push(...chunk.split('\n').filter(Boolean))
    if (this.lines.length > this.maxLines) {
      this.lines = this.lines.slice(-this.maxLines)
    }
  }

  getLastLines(): string {
    return this.lines.join('\n')
  }
}
