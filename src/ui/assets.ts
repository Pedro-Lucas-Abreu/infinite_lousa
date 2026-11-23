import type { PageObject, Point } from '../core/types'
import type { BoardAsset } from '../documents/archive'

function asBlob(asset: BoardAsset): Blob {
  return new Blob([asset.bytes as Uint8Array<ArrayBuffer>], { type: asset.mime })
}

export async function importImage(file: Blob, center: Point, zIndex: number) {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.size > 64 * 1024 * 1024) {
    throw new Error('Unsupported or oversized image.')
  }

  const bitmap = await createImageBitmap(file)
  try {
    let source = file
    if (source.type !== 'image/png' && source.type !== 'image/jpeg') {
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Could not decode the image.')
      context.drawImage(bitmap, 0, 0)
      source = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not encode the image.')), 'image/png')
      })
    }
    if (source.size > 64 * 1024 * 1024) throw new Error('The decoded image is too large.')

    const scale = Math.min(1, 680 / bitmap.width, 530 / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    const asset: BoardAsset = { id: crypto.randomUUID(), mime: source.type, bytes: new Uint8Array(await source.arrayBuffer()) }
    const image: PageObject = {
      id: crypto.randomUUID(), type: 'image', transform: [1, 0, 0, 1, center.x - width / 2, center.y - height / 2],
      zIndex, locked: false, props: { width, height, assetId: asset.id },
    }
    return { asset, image }
  } finally {
    bitmap.close()
  }
}

export class ImagePreviews {
  private readonly images = new Map<string, ImageBitmap | null>()
  private disposed = false

  constructor(private readonly onRedraw: () => void, private readonly onError: () => void) {}

  get(asset: BoardAsset): CanvasImageSource | undefined {
    if (!this.images.has(asset.id)) {
      this.images.set(asset.id, null)
      void createImageBitmap(asBlob(asset)).then((bitmap) => {
        if (this.disposed) { bitmap.close(); return }
        this.images.set(asset.id, bitmap)
        this.onRedraw()
      }).catch(() => { if (!this.disposed) this.onError() })
    }
    return this.images.get(asset.id) ?? undefined
  }

  dispose() {
    this.disposed = true
    for (const bitmap of this.images.values()) bitmap?.close()
    this.images.clear()
  }
}
