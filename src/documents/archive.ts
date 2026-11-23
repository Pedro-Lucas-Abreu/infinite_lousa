import { Unzip, UnzipInflate, zipSync } from "fflate";
import type { SceneSnapshot } from "../core/scene";
import { type Affine, type BoardObject, type Brush, type Point, type ShapeKind, type StrokePoint, isPageObject } from "../core/types";

const MAX_ARCHIVE = 128 * 1024 * 1024;
const MAX_TOTAL = 192 * 1024 * 1024;
const MAX_ASSET = 64 * 1024 * 1024;
const MAX_SCENE = 64 * 1024 * 1024;
const MAX_MANIFEST = 512 * 1024;
const MAX_FILES = 1024;
const MAX_OBJECTS = 100_000;
const MAX_POINTS = 2_000_000;
const CHUNK_SIZE = 16 * 1024;
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const mimePattern = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/;
const hexColorPattern = /^#[\da-f]{6}$/i;
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

export interface BoardAsset {
  readonly id: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface PortableBoard {
  readonly scene: SceneSnapshot;
  readonly assets: readonly BoardAsset[];
}

interface AssetEntry {
  id: string;
  path: string;
  mime: string;
  size: number;
}

interface ZipEntry {
  compression: number;
  packedSize: number;
  size: number;
  crc: number;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value;
});

function crcUpdate(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}

function entryLimit(name: string): number {
  if (name === "manifest.json") return MAX_MANIFEST;
  if (name === "scene.json") return MAX_SCENE;
  const assetId = name.startsWith("assets/") && name.slice(7);
  if (assetId && idPattern.test(assetId)) return MAX_ASSET;
  throw new Error("Unexpected or unsafe board archive path.");
}

function readDirectory(bytes: Uint8Array) {
  if (bytes.length > MAX_ARCHIVE) throw new Error("Board archive exceeds its compressed size limit.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  const searchLimit = Math.max(0, end - 65_535);
  while (end >= searchLimit && (
    view.getUint32(end, true) !== 0x06054b50 ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )) end--;
  if (end < searchLimit) throw new Error("ZIP directory is missing or truncated.");

  const fileCount = view.getUint16(end + 10, true);
  const directoryStart = view.getUint32(end + 16, true);
  if (fileCount < 2 || fileCount > MAX_FILES || view.getUint32(end + 4, true) !== 0 ||
      view.getUint16(end + 8, true) !== fileCount ||
      directoryStart + view.getUint32(end + 12, true) !== end) {
    throw new Error("Invalid or unsupported ZIP directory.");
  }

  const entries = new Map<string, ZipEntry>();
  let total = 0;
  let offset = directoryStart;
  for (let index = 0; index < fileCount; index++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid ZIP entry header.");
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const packedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameEnd = offset + 46 + view.getUint16(offset + 28, true);
    const next = nameEnd + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    if (next > end || local + 30 + packedSize > directoryStart ||
        (flags & 1) || (compression !== 0 && compression !== 8) ||
        view.getUint16(offset + 34, true) !== 0) {
      throw new Error("ZIP entry is invalid or uses an unsupported method.");
    }
    const name = decoder.decode(bytes.subarray(offset + 46, nameEnd));
    if (entries.has(name) || size > entryLimit(name) || (total += size) > MAX_TOTAL) {
      throw new Error("Duplicate ZIP entry or board size limit exceeded.");
    }
    const localFlags = view.getUint16(local + 6, true);
    const localNameEnd = local + 30 + view.getUint16(local + 26, true);
    const payloadStart = localNameEnd + view.getUint16(local + 28, true);
    if (view.getUint32(local, true) !== 0x04034b50 || localFlags !== flags ||
        view.getUint16(local + 8, true) !== compression || payloadStart + packedSize > directoryStart ||
        decoder.decode(bytes.subarray(local + 30, localNameEnd)) !== name ||
        (!(flags & 8) && (view.getUint32(local + 14, true) !== crc ||
          view.getUint32(local + 18, true) !== packedSize || view.getUint32(local + 22, true) !== size))) {
      throw new Error("ZIP entry and its local header disagree.");
    }
    entries.set(name, { compression, packedSize, size, crc });
    offset = next;
  }
  if (offset !== end) throw new Error("Unexpected data in ZIP directory.");
  return { directoryStart, entries };
}

function unpack(bytes: Uint8Array): Map<string, Uint8Array> {
  const { directoryStart, entries } = readDirectory(bytes);
  const files = new Map<string, Uint8Array>();
  const seen = new Set<string>();
  const unzip = new Unzip((file) => {
    const entry = entries.get(file.name);
    if (!entry || seen.has(file.name) || file.compression !== entry.compression ||
        (file.size !== undefined && file.size !== entry.packedSize) ||
        (file.originalSize !== undefined && file.originalSize !== entry.size)) {
      throw new Error("ZIP payload and directory disagree.");
    }
    seen.add(file.name);
    const result = new Uint8Array(entry.size);
    let written = 0;
    let crc = 0xffffffff;

    file.ondata = (error, chunk, final) => {
      if (error) throw error;
      if (written + chunk.length > result.length) throw new Error("ZIP entry exceeded its declared size.");
      result.set(chunk, written);
      written += chunk.length;
      crc = crcUpdate(crc, chunk);
      if (final) {
        if (written !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) {
          throw new Error("ZIP entry is incomplete or corrupt.");
        }
        files.set(file.name, result);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let start = 0; start < directoryStart; start += CHUNK_SIZE) {
    const end = Math.min(directoryStart, start + CHUNK_SIZE);
    unzip.push(bytes.subarray(start, end), end === directoryStart);
  }
  if (files.size !== entries.size) throw new Error("Missing or incomplete ZIP payload.");
  return files;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && idPattern.test(value);
}

function isPoint(value: unknown): value is Point {
  return isRecord(value) && finite(value.x) && finite(value.y);
}

function isStrokePoint(value: unknown): value is StrokePoint {
  if (!isPoint(value)) return false;
  return !("pressure" in value) || value.pressure === undefined ||
    (finite(value.pressure) && value.pressure >= 0 && value.pressure <= 1);
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && hexColorPattern.test(value);
}

function isShapeKind(value: unknown): value is ShapeKind {
  return value === "line" || value === "arrow" || value === "rectangle" ||
    value === "ellipse" || value === "polygon";
}

function isBrush(value: unknown): value is Brush {
  return isRecord(value) && isColor(value.color) &&
    finite(value.size) && value.size >= 1e-20 && value.size <= 1e20 &&
    finite(value.stabilizer) && value.stabilizer >= 0 && value.stabilizer <= 100 &&
    (value.opacity === undefined || (finite(value.opacity) && value.opacity >= 0 && value.opacity <= 1)) &&
    typeof value.simulatePressure === "boolean";
}

function isAffine(value: unknown): value is Affine {
  if (!Array.isArray(value) || value.length !== 6 || !value.every(finite)) return false;
  const [a, b, c, d] = value;
  const determinant = a * d - b * c;
  return finite(determinant) && determinant !== 0;
}

function validateScene(scene: unknown): SceneSnapshot {
  if (!isRecord(scene) || scene.version !== 1 || !Array.isArray(scene.objects) ||
      scene.objects.length > MAX_OBJECTS) {
    throw new Error("Invalid or unsupported board scene.");
  }
  const ids = new Set<string>();
  let pointCount = 0;
  const objects = scene.objects.map((object): BoardObject => {
    if (!isRecord(object) || !isId(object.id) || ids.has(object.id) ||
        typeof object.locked !== "boolean" || !finite(object.zIndex) || !isAffine(object.transform)) {
      throw new Error("Invalid or unsupported scene object.");
    }
    const { props } = object;
    if (!isRecord(props)) throw new Error("Invalid scene object properties.");
    if (object.parentId !== undefined && !isId(object.parentId)) {
      throw new Error("Invalid attachment parent.");
    }
    ids.add(object.id);
    const base = {
      id: object.id,
      locked: object.locked,
      transform: object.transform,
      zIndex: object.zIndex,
    };
    const attachment = object.parentId === undefined ? {} : { parentId: object.parentId };
    if (object.type === "stroke") {
      if (props.version !== 1 || !isBrush(props.brush) ||
          !Array.isArray(props.points) || props.points.length === 0 ||
          (pointCount += props.points.length) > MAX_POINTS || !props.points.every(isStrokePoint)) {
        throw new Error("Invalid stroke geometry or point count limit exceeded.");
      }
      return {
        ...base, ...attachment, type: "stroke",
        props: { version: 1, points: props.points, brush: props.brush },
      };
    }

    if (object.type === "shape") {
      const { kind, points, color, size } = props;
      if (!isShapeKind(kind) || !Array.isArray(points) ||
          points.length < (kind === "polygon" ? 3 : 2) ||
          (pointCount += points.length) > MAX_POINTS || !points.every(isPoint) ||
          !isColor(color) || !finite(size) || size <= 0) {
        throw new Error("Invalid shape geometry or style.");
      }
      return { ...base, ...attachment, type: "shape", props: { kind, points, color, size } };
    }

    const { width, height } = props;
    if (!finite(width) || width <= 0 || !finite(height) || height <= 0) {
      throw new Error("Invalid rectangular object geometry.");
    }
    if (object.type === "frame") {
      if (typeof props.name !== "string" || !finite(props.order)) throw new Error("Invalid frame.");
      return { ...base, ...attachment, type: "frame", props: { width, height, name: props.name, order: props.order } };
    }
    if (object.type === "text") {
      const { text, color, fontSize } = props;
      if (typeof text !== "string" || !isColor(color) || !finite(fontSize) || fontSize <= 0) {
        throw new Error("Invalid text object.");
      }
      return { ...base, ...attachment, type: "text", props: { text, width, height, color, fontSize } };
    }
    if (object.type === "image" || object.type === "pdfPage") {
      if (!isId(props.assetId) || object.parentId !== undefined ||
          (props.pageIndex !== undefined && (!finite(props.pageIndex) ||
            !Number.isSafeInteger(props.pageIndex) || props.pageIndex < 0))) {
        throw new Error("Invalid page asset reference.");
      }
      const pageIndex = props.pageIndex === undefined ? {} : { pageIndex: props.pageIndex };
      return {
        ...base, type: object.type,
        props: { width, height, assetId: props.assetId, ...pageIndex },
      };
    }
    throw new Error("Invalid or unsupported scene object.");
  });
  return { version: 1, objects };
}

function validateReferences(scene: SceneSnapshot, assets: readonly AssetEntry[]): void {
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const pages = new Set(scene.objects.filter(isPageObject).map(({ id }) => id));
  for (const object of scene.objects) {
    if (isPageObject(object)) {
      const mime = assetById.get(object.props.assetId)?.mime;
      if (object.type === "pdfPage" ? mime !== "application/pdf" : !mime?.startsWith("image/")) {
        throw new Error("Missing or incompatible page asset.");
      }
    } else if (object.parentId && !pages.has(object.parentId)) {
      throw new Error("Missing attachment parent.");
    }
  }
}

function validateAssets(value: unknown): AssetEntry[] {
  if (!Array.isArray(value) || value.length + 2 > MAX_FILES) throw new Error("Invalid board asset list.");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isRecord(entry) || !isId(entry.id) || ids.has(entry.id) || entry.path !== "assets/" + entry.id ||
        typeof entry.mime !== "string" || entry.mime.length > 127 || !mimePattern.test(entry.mime) ||
        !finite(entry.size) || !Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_ASSET) {
      throw new Error("Invalid board asset.");
    }
    ids.add(entry.id);
    return { id: entry.id, path: entry.path, mime: entry.mime, size: entry.size };
  });
}

function readJson(files: Map<string, Uint8Array>, name: string): unknown {
  const entry = files.get(name);
  if (!entry) throw new Error("Missing required board file.");
  return JSON.parse(decoder.decode(entry)) as unknown;
}

export function writeArchive(board: PortableBoard): Uint8Array {
  const scene = validateScene(board.scene);
  const assets = validateAssets(board.assets.map(({ id, mime, bytes }) => ({
    id, path: "assets/" + id, mime, size: bytes.length,
  })));
  validateReferences(scene, assets);
  const manifest = { format: "board", version: 1, scenePath: "scene.json", assets };
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const sceneBytes = encoder.encode(JSON.stringify(scene));
  const files: Record<string, Uint8Array> = { "manifest.json": manifestBytes, "scene.json": sceneBytes };
  let total = manifestBytes.length + sceneBytes.length;
  for (const { id, bytes } of board.assets) {
    files["assets/" + id] = bytes;
    total += bytes.length;
  }
  if (manifestBytes.length > MAX_MANIFEST || sceneBytes.length > MAX_SCENE || total > MAX_TOTAL) {
    throw new Error("Board exceeds its uncompressed size limit.");
  }
  const result = zipSync(files, { level: 3 });
  if (result.length > MAX_ARCHIVE) throw new Error("Board exceeds its compressed size limit.");
  return result;
}

export function readArchive(bytes: Uint8Array): PortableBoard {
  const files = unpack(bytes);
  const manifest = readJson(files, "manifest.json");
  if (!isRecord(manifest) || manifest.format !== "board" || manifest.version !== 1 ||
      manifest.scenePath !== "scene.json") {
    throw new Error("Invalid or unsupported board manifest.");
  }
  const entries = validateAssets(manifest.assets);
  if (files.size !== entries.length + 2) throw new Error("Board contains unlisted assets.");
  const scene = validateScene(readJson(files, manifest.scenePath));
  validateReferences(scene, entries);
  const assets = entries.map(({ id, path, mime, size }) => {
    const bytes = files.get(path);
    if (!bytes || bytes.length !== size) throw new Error("Missing or incomplete board asset.");
    return { id, mime, bytes };
  });
  return { scene, assets };
}
