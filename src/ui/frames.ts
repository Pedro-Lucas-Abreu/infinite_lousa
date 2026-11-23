import type { Bounds, Camera, FrameObject, PageObject, Viewport } from '../core/types'

export function fitCamera(bounds: Bounds, viewport: Viewport, margin = 24): Camera {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    zoom: Math.min(
      Math.max(1, viewport.width - 2 * margin) / Math.max(1, bounds.maxX - bounds.minX),
      Math.max(1, viewport.height - 2 * margin) / Math.max(1, bounds.maxY - bounds.minY),
    ),
  }
}

export function framesForPages(pages: readonly PageObject[], order: number): FrameObject[] {
  return pages.map((page, index) => ({
    id: crypto.randomUUID(), type: 'frame', transform: page.transform,
    zIndex: page.zIndex, locked: false, parentId: page.id,
    props: { width: page.props.width, height: page.props.height, name: `Página ${index + 1}`, order: order + index },
  }))
}
