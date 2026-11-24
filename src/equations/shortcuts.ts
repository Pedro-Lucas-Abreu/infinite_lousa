interface LatexShortcut {
  readonly code: string;
  readonly name: string;
  readonly preview: string;
}

export const latexExpansionDetails = {
  frac: { code: "\\frac{}{}", name: "Fração", preview: "½" },
  sqrt: { code: "\\sqrt{}", name: "Raiz quadrada", preview: "√x" },
  nroot: { code: "\\sqrt[]{}", name: "Raiz n-ésima", preview: "ⁿ√x" },
  sum: { code: "\\sum_{}^{}", name: "Somatório", preview: "∑" },
  int: { code: "\\int_{}^{}", name: "Integral", preview: "∫" },
  lim: { code: "\\lim_{}", name: "Limite", preview: "lim" },
  log: { code: "\\log", name: "Logaritmo", preview: "log" },
  ln: { code: "\\ln", name: "Logaritmo natural", preview: "ln" },
  sin: { code: "\\sin", name: "Seno", preview: "sin" },
  cos: { code: "\\cos", name: "Cosseno", preview: "cos" },
  tan: { code: "\\tan", name: "Tangente", preview: "tan" },
  pi: { code: "\\pi", name: "Pi", preview: "π" },
  alpha: { code: "\\alpha", name: "Alfa", preview: "α" },
  beta: { code: "\\beta", name: "Beta", preview: "β" },
  gamma: { code: "\\gamma", name: "Gama", preview: "γ" },
  delta: { code: "\\delta", name: "Delta", preview: "δ" },
  theta: { code: "\\theta", name: "Teta", preview: "θ" },
  lambda: { code: "\\lambda", name: "Lambda", preview: "λ" },
  mu: { code: "\\mu", name: "Mi", preview: "μ" },
  sigma: { code: "\\sigma", name: "Sigma", preview: "σ" },
  omega: { code: "\\omega", name: "Ômega", preview: "ω" },
  leq: { code: "\\leq", name: "Menor ou igual", preview: "≤" },
  geq: { code: "\\geq", name: "Maior ou igual", preview: "≥" },
  neq: { code: "\\neq", name: "Diferente", preview: "≠" },
  approx: { code: "\\approx", name: "Aproximadamente igual", preview: "≈" },
  equiv: { code: "\\equiv", name: "Equivalente", preview: "≡" },
  pm: { code: "\\pm", name: "Mais ou menos", preview: "±" },
  mp: { code: "\\mp", name: "Menos ou mais", preview: "∓" },
  cdot: { code: "\\cdot", name: "Ponto de multiplicação", preview: "⋅" },
  times: { code: "\\times", name: "Multiplicação", preview: "×" },
  div: { code: "\\div", name: "Divisão", preview: "÷" },
  to: { code: "\\to", name: "Seta para a direita", preview: "→" },
  infty: { code: "\\infty", name: "Infinito", preview: "∞" },
  deg: { code: "^\\circ", name: "Grau", preview: "°" },
  angle: { code: "\\angle", name: "Ângulo", preview: "∠" },
  phi: { code: "\\phi", name: "Fi", preview: "ϕ" },
  epsilon: { code: "\\epsilon", name: "Épsilon", preview: "ϵ" },
  rho: { code: "\\rho", name: "Rô", preview: "ρ" },
  tau: { code: "\\tau", name: "Tau", preview: "τ" },
} as const satisfies Readonly<Record<string, LatexShortcut>>;

export const latexReplacementDetails = {
  "<=": latexExpansionDetails.leq,
  ">=": latexExpansionDetails.geq,
  "!=": latexExpansionDetails.neq,
  "+-": latexExpansionDetails.pm,
  "->": latexExpansionDetails.to,
  inf: latexExpansionDetails.infty,
} as const satisfies Readonly<Record<string, LatexShortcut>>;
