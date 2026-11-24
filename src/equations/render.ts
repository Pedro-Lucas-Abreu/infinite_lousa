import type { EquationPath } from "../core/types";

export interface RenderedEquation {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly EquationPath[];
}

export async function renderEquation(latex: string, fontSize: number): Promise<RenderedEquation> {
  const expression = latex.trim().normalize("NFC");
  if (!expression) throw new Error("Digite uma expressão em LaTeX.");
  if (expression.length > 16_384) throw new Error("A expressão é longa demais.");
  if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error("O tamanho da equação é inválido.");
  const { typesetEquation } = await import("./mathjax");
  return typesetEquation(expression, fontSize);
}
