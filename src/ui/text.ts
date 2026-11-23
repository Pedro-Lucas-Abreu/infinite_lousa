import { TEXT_LINE_HEIGHT } from '../canvas/drawings'

export function textBoxDimensions(text: string, fontSize: number, measureLine: (line: string) => number) {
  const lines = text.split('\n')
  return {
    width: Math.max(1, ...lines.map(measureLine)),
    height: fontSize * TEXT_LINE_HEIGHT * lines.length,
  }
}
