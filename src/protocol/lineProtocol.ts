import { Frame } from './frames';

export class LineProtocol {
  private static FRAME_PREFIX = 'FRAME:';
  private static FRAME_SUFFIX = 'END_OF_FRAME';

  static serialize(frame: Frame): string {
    return `${this.FRAME_PREFIX} ${JSON.stringify(frame)}\n${this.FRAME_SUFFIX}`;
  }

  static parse(line: string): Frame | null {
    if (line.startsWith(this.FRAME_PREFIX)) {
      try {
        const jsonPart = line.substring(this.FRAME_PREFIX.length).trim();
        return JSON.parse(jsonPart) as Frame;
      } catch (e) {
        console.error('[LineProtocol] Failed to parse frame:', e);
      }
    }
    return null;
  }
}