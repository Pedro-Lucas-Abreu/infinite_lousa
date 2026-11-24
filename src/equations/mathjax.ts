import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import type { Affine, EquationPath } from "../core/types";
import type { RenderedEquation } from "./render";

const STIX_RANGES = "@mathjax/mathjax-stix2-font/js/svg/dynamic/";
const loadRange: Readonly<Record<string, () => Promise<unknown>>> = {
  "calligraphic.js": () => import("@mathjax/mathjax-stix2-font/js/svg/dynamic/calligraphic.js"),
  "double-struck.js": () => import("@mathjax/mathjax-stix2-font/js/svg/dynamic/double-struck.js"),
  "latin.js": () => import("@mathjax/mathjax-stix2-font/js/svg/dynamic/latin.js"),
};

mathjax.asyncLoad = (name: string) => {
  const range = name.slice(STIX_RANGES.length);
  if (name.startsWith(STIX_RANGES) && Object.hasOwn(loadRange, range)) return loadRange[range]();
  return Promise.reject(new Error(`No local vector glyph range for ${name}.`));
};

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const tex = new TeX({
  packages: ["base", "ams"],
  maxBuffer: 16_384,
  maxMacros: 1_000,
  formatError(_jax: unknown, error: Error) {
    throw new Error(`LaTeX inválido. ${error.message}`);
  },
});
const output = new SVG({ fontCache: "none", blacker: 0 });
const mathDocument = mathjax.document("", { InputJax: tex, OutputJax: output });
let pending: Promise<unknown> = Promise.resolve();

const identity: Affine = [1, 0, 0, 1, 0, 0];
const coordinates = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

function multiply(parent: Affine, child: Affine): Affine {
  const [a, b, c, d, e, f] = parent;
  const [g, h, i, j, k, l] = child;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function attribute(element: LiteElement, name: string): string {
  return adaptor.getAttribute(element, name) ?? "";
}

function svgTransform(value: string): Affine {
  let result = identity;
  for (const [, action, parameters] of value.matchAll(/([A-Za-z]+)\(([^)]*)\)/g)) {
    const numbers = [...parameters.matchAll(coordinates)].map(([number]) => Number(number));
    const [x, y] = numbers;
    if (action === "translate") result = multiply(result, [1, 0, 0, 1, x, y ?? 0]);
    else if (action === "scale") result = multiply(result, [x, 0, 0, y ?? x, 0, 0]);
    else if (action === "matrix" && numbers.length === 6) result = multiply(result, numbers as unknown as Affine);
    else throw new Error("A equação usa uma transformação vetorial sem suporte.");
  }
  return result;
}

function vectorPaths(element: LiteElement, inherited: Affine, paths: EquationPath[]): void {
  const transform = multiply(inherited, svgTransform(attribute(element, "transform")));
  if (element.kind === "path") {
    const d = attribute(element, "d");
    if (d) paths.push({ d, transform });
    return;
  }
  if (element.kind === "rect") {
    const [x, y, width, height] = ["x", "y", "width", "height"].map((name) => Number(attribute(element, name)));
    if (width > 0 && height > 0) {
      paths.push({ d: `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`, transform });
    }
    return;
  }
  if (element.kind !== "g" && element.kind !== "svg") {
    throw new Error("A equação contém um símbolo sem desenho vetorial disponível.");
  }
  for (const child of adaptor.childNodes(element)) {
    if (child instanceof LiteElement) vectorPaths(child, transform, paths);
  }
}

async function typeset(expression: string, fontSize: number): Promise<RenderedEquation> {
  tex.reset();
  const result = await mathDocument.convertPromise(expression, { display: true });
  const svg = adaptor.childNodes(result).find((node) => node instanceof LiteElement && node.kind === "svg");
  if (!(svg instanceof LiteElement)) throw new Error("Não foi possível desenhar a equação.");
  const [x, y, width, height] = attribute(svg, "viewBox").trim().split(/\s+/).map(Number);
  const scale = fontSize / 1_000;
  const margin = fontSize * 0.05;
  const paths: EquationPath[] = [];
  vectorPaths(svg, [scale, 0, 0, scale, margin - x * scale, margin - y * scale], paths);
  if (!paths.length || !Number.isFinite(width * scale) || !Number.isFinite(height * scale) || width <= 0 || height <= 0) {
    throw new Error("A expressão não contém uma equação visível.");
  }
  if (paths.length > 2_048 || paths.reduce((total, path) => total + path.d.length, 0) > 2_000_000) {
    throw new Error("A equação tem detalhes demais para salvar na lousa.");
  }
  return { width: width * scale + 2 * margin, height: height * scale + 2 * margin, paths };
}

export function typesetEquation(expression: string, fontSize: number): Promise<RenderedEquation> {
  const result = pending.then(() => typeset(expression, fontSize));
  pending = result.catch(() => {});
  return result;
}
