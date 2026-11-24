import type { PlotObject } from '../core/types'

export function alignPlotAxes(object: PlotObject): PlotObject {
  const [a, b, c, d, e, f] = object.transform
  const horizontal = Math.hypot(a, b)
  const vertical = Math.hypot(c, d)
  const scale = Math.sqrt(horizontal) * Math.sqrt(vertical)
  const orientation = a * d < b * c ? -1 : 1
  const x = a / horizontal * scale
  const y = b / horizontal * scale
  return {
    ...object,
    transform: [x, y, -y * orientation, x * orientation, e, f],
    props: {
      ...object.props,
      width: object.props.width * (horizontal / scale),
      height: object.props.height * (vertical / scale),
    },
  }
}
