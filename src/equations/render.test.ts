import assert from "node:assert/strict";
import test from "node:test";
import { hasValidSvgPathData } from "../core/svgPath";
import { renderEquation } from "./render";

const samples = [
  String.raw`\frac{x+1}{y-2}`,
  String.raw`\sqrt[3]{a+b}`,
  String.raw`x_i^2 + a_{n+1}`,
  String.raw`\alpha+\beta=\gamma`,
  String.raw`\left[\frac{1}{x}\right]`,
  String.raw`\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}`,
  String.raw`\sum_{n=1}^{\infty}\frac1{n^2}`,
  String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`,
  String.raw`\text{Função e equação} \quad f(x)=x^2`,
  String.raw`\begin{cases}x^2,& x>0\\0,& x\le 0\end{cases}`,
  String.raw`\mathbb{R} \subseteq \mathcal{A}`,
  String.raw`\vec{v} \times \overbrace{x+y+z}^{n}`,
];

test("produces portable vector geometry for classroom LaTeX", async () => {
  for (const latex of samples) {
    const { width, height, paths } = await renderEquation(latex, 32);
    assert.ok(width > 0 && height > 0, latex);
    assert.ok(paths.length > 1, latex);
    assert.ok(paths.every(({ d, transform }) => hasValidSvgPathData(d) && transform.every(Number.isFinite)), latex);
  }
});

test("scales equation paths with the font and recovers after invalid LaTeX", async () => {
  await assert.rejects(renderEquation(String.raw`\frac{x}{`, 28), /LaTeX inválido/);
  await assert.rejects(renderEquation(" ", 28), /Digite uma expressão/);
  const normal = await renderEquation(samples[0], 20);
  const large = await renderEquation(samples[0], 40);
  assert.equal(large.width, 2 * normal.width);
  assert.equal(large.height, 2 * normal.height);
  assert.deepEqual(large.paths.map(({ d }) => d), normal.paths.map(({ d }) => d));
  assert.deepEqual(large.paths.map(({ transform }) => transform), normal.paths.map(({ transform }) => transform.map((coordinate) => coordinate * 2)));
});
