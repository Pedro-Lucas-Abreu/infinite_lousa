export const latexExpansions = {
  frac: "\\frac{}{}",
  sqrt: "\\sqrt{}",
  nroot: "\\sqrt[]{}",
  sum: "\\sum_{}^{}",
  int: "\\int_{}^{}",
  lim: "\\lim_{}",
  log: "\\log",
  ln: "\\ln",
  sin: "\\sin",
  cos: "\\cos",
  tan: "\\tan",
  pi: "\\pi",
  alpha: "\\alpha",
  beta: "\\beta",
  gamma: "\\gamma",
  delta: "\\delta",
  theta: "\\theta",
  lambda: "\\lambda",
  mu: "\\mu",
  sigma: "\\sigma",
  omega: "\\omega",
} as const;

export const latexReplacements = {
  "<=": "\\leq",
  ">=": "\\geq",
  "!=": "\\neq",
  "+-": "\\pm",
  "->": "\\to",
  inf: "\\infty",
} as const;

export interface LatexEdit {
  value: string;
  start: number;
  end: number;
}

const wordAtEnd = /[\p{L}\p{M}\p{N}_]$/u;
const wordAtStart = /^[\p{L}\p{M}\p{N}_]/u;
const symbolEntries = Object.entries(latexReplacements);

function isEscaped(value: string, offset: number): boolean {
  let backslashes = 0;
  while (offset > 0 && value[--offset] === "\\") backslashes++;
  return backslashes % 2 === 1;
}

function isBareToken(value: string, from: number, to: number): boolean {
  return value[from - 1] !== "\\" &&
    !wordAtEnd.test(value.slice(0, from)) &&
    !wordAtStart.test(value.slice(to));
}

function move(value: string, offset: number): LatexEdit {
  return { value, start: offset, end: offset };
}

function insertControlWord(value: string, from: number, to: number, word: string): LatexEdit {
  const after = value.slice(to);
  const separator = /^[\t\n\r ]/.test(after) ? "" : " ";
  return move(value.slice(0, from) + word + separator + after, from + word.length + 1);
}

function insertTemplate(value: string, start: number, end: number, template: string, selected = ""): LatexEdit {
  const slot = /\{\}|\[\]/.exec(template);
  if (!slot) return insertControlWord(value, start, end, template);

  const inside = slot.index + 1;
  const insertion = template.slice(0, inside) + selected + template.slice(inside);
  return {
    value: value.slice(0, start) + insertion + value.slice(end),
    start: start + inside,
    end: start + inside + selected.length,
  };
}

interface Group {
  opening: "{" | "[";
  from: number;
}

function nextPlaceholder(value: string, start: number, end: number): number | undefined {
  const stack: Group[] = [];
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== "{" && char !== "[" && char !== "}" && char !== "]") continue;
    if (isEscaped(value, i)) continue;
    if (char === "{" || char === "[") {
      stack.push({ opening: char, from: i });
      continue;
    }
    const group = stack.at(-1);
    if (!group || (char === "}" ? "{" : "[") !== group.opening) continue;
    stack.pop();
    if (group.from >= start || i < end) continue;

    const before = value.slice(0, group.from).trimEnd();
    const after = value.slice(i + 1);
    const argument = /^\s*\{/.exec(after);
    if (argument && (group.opening === "[" ? /\\sqrt$/.test(before) : /\\frac$/.test(before))) {
      return i + 1 + argument[0].length;
    }
    const script = /^\s*([_^])\s*\{/.exec(after);
    const earlierScript = before.at(-1);
    if (script && (earlierScript === "_" || earlierScript === "^") && earlierScript !== script[1]) {
      return i + 1 + script[0].length;
    }
    return i + 1;
  }
  return undefined;
}

export function editLatex(value: string, start: number, end: number, key: string): LatexEdit | undefined {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > value.length) {
    return undefined;
  }
  if (key === "Tab") {
    if (start === end) {
      const bare = /[a-z]+$/.exec(value.slice(0, start));
      if (bare && Object.hasOwn(latexExpansions, bare[0]) && isBareToken(value, bare.index, start)) {
        const template = latexExpansions[bare[0] as keyof typeof latexExpansions];
        return insertTemplate(value, bare.index, start, template);
      }
    }
    const next = nextPlaceholder(value, start, end);
    return next === undefined ? undefined : move(value, next);
  }
  if (isEscaped(value, start)) return undefined;

  if (key === "{") return insertTemplate(value, start, end, "{}", value.slice(start, end));
  if (start !== end) return undefined;

  if (key === "}" && value[start] === "}") return move(value, start + 1);
  if (key === "^" || key === "_") return insertTemplate(value, start, end, key + "{}");

  for (const [sequence, replacement] of symbolEntries) {
    if (sequence.at(-1) !== key) continue;
    const from = start - sequence.length + 1;
    if (from < 0 || value.slice(from, start) !== sequence.slice(0, -1)) continue;
    if (sequence === "inf" ? !isBareToken(value, from, start) : isEscaped(value, from)) continue;
    return insertControlWord(value, from, start, replacement);
  }
  return undefined;
}
