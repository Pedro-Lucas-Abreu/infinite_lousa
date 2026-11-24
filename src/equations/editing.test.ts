import assert from "node:assert/strict";
import { it } from "node:test";
import { editLatex } from "./editing";

function atCursor(marked: string, key: string): string | undefined {
  const caret = marked.indexOf("|");
  assert.notEqual(caret, -1);
  const edit = editLatex(marked.slice(0, caret) + marked.slice(caret + 1), caret, caret, key);
  if (!edit) return undefined;
  assert.equal(edit.start, edit.end);
  return edit.value.slice(0, edit.start) + "|" + edit.value.slice(edit.end);
}

it("pairs typed scripts and braces at the caret", () => {
  assert.equal(atCursor("x|", "^"), "x^{|}");
  assert.equal(atCursor("x|", "_"), "x_{|}");
  assert.equal(atCursor("x^{2}|", "_"), "x^{2}_{|}");
  assert.equal(atCursor("\\sqrt|", "{"), "\\sqrt{|}");
  assert.equal(atCursor("x^{2|}", "}"), "x^{2}|");
  assert.equal(atCursor("x^{2}|", "}"), undefined);
  assert.equal(atCursor("\\|", "{"), undefined);
  assert.equal(atCursor("\\|", "_"), undefined);
});

it("leaves script keys on selected text to the browser and can wrap it in braces", () => {
  assert.equal(editLatex("x123", 1, 4, "^"), undefined);
  assert.equal(editLatex("x_123", 2, 4, "_"), undefined);
  assert.deepEqual(editLatex("xab", 1, 3, "{"), { value: "x{ab}", start: 2, end: 4 });
});

it("expands plain tokens only with Tab and leaves existing LaTeX commands alone", () => {
  assert.equal(atCursor("frac|", " "), undefined);
  assert.equal(atCursor("2 + frac|", "Tab"), "2 + \\frac{|}{}");
  assert.equal(atCursor("sqrt|", "Tab"), "\\sqrt{|}");
  assert.equal(atCursor("nroot|", "Tab"), "\\sqrt[|]{}");
  assert.equal(atCursor("sum|", "Tab"), "\\sum_{|}^{}");
  assert.equal(atCursor("omega|", "Tab"), "\\omega |");
  assert.equal(atCursor("sin| x", "Tab"), "\\sin |x");
  assert.equal(atCursor("\\frac|", "Tab"), undefined);
  assert.equal(atCursor("αfrac|", "Tab"), undefined);
  assert.equal(atCursor("sqrt|other", "Tab"), undefined);
  assert.equal(atCursor("sum4|", "Tab"), undefined);
  assert.equal(atCursor("x^{frac|}", "Tab"), "x^{\\frac{|}{}}");
});

it("expands the additional symbols only as isolated words followed by Tab", () => {
  const expected = {
    leq: "\\leq", geq: "\\geq", neq: "\\neq", approx: "\\approx", equiv: "\\equiv",
    pm: "\\pm", mp: "\\mp", cdot: "\\cdot", times: "\\times", div: "\\div",
    to: "\\to", infty: "\\infty", deg: "^\\circ", angle: "\\angle", phi: "\\phi",
    epsilon: "\\epsilon", rho: "\\rho", tau: "\\tau",
  };
  for (const [word, code] of Object.entries(expected)) {
    assert.equal(atCursor(`x + ${word}|`, "Tab"), `x + ${code} |`, word);
    assert.equal(atCursor(`${word}|`, " "), undefined, word);
    assert.equal(atCursor(`\\${word}|`, "Tab"), undefined, word);
    assert.equal(atCursor(`pre${word}|`, "Tab"), undefined, word);
    assert.equal(atCursor(`${word}|po`, "Tab"), undefined, word);
  }
  assert.equal(atCursor("topo|", "Tab"), undefined);
});

it("moves through the matching groups of a fraction, indexed root or sum", () => {
  assert.equal(atCursor("\\frac{a|}{b}", "Tab"), "\\frac{a}{|b}");
  assert.equal(atCursor("\\frac{a}{b|}{outside}", "Tab"), "\\frac{a}{b}|{outside}");
  assert.equal(atCursor("\\sqrt[3|]{x}", "Tab"), "\\sqrt[3]{|x}");
  assert.equal(atCursor("\\sqrt[3]{x|}", "Tab"), "\\sqrt[3]{x}|");
  assert.equal(atCursor("\\sum_{n=1|}^{4}", "Tab"), "\\sum_{n=1}^{|4}");
  assert.equal(atCursor("\\int_{0}^{1|}", "Tab"), "\\int_{0}^{1}|");
  assert.equal(atCursor("x^{|}", "Tab"), "x^{}|");
  assert.equal(atCursor("\\frac{a|+{b}}{c}", "Tab"), "\\frac{a+{b}}{|c}");
  assert.equal(atCursor("x\\{y|\\}", "Tab"), undefined);
});

it("replaces completed operators with delimited LaTeX control words", () => {
  assert.equal(atCursor("x<|y", "="), "x\\leq |y");
  assert.equal(atCursor("x>| y", "="), "x\\geq |y");
  assert.equal(atCursor("x!|", "="), "x\\neq |");
  assert.equal(atCursor("x+|", "-"), "x\\pm |");
  assert.equal(atCursor("x-|", ">"), "x\\to |");
  assert.equal(atCursor("x\\<|", "="), undefined);
  assert.equal(atCursor("(x|)", "("), undefined);
});

it("recognizes raw inf on the final keystroke and shields existing words or commands", () => {
  // A raw token is expanded immediately when 'f' completes it. Existing text at either boundary prevents a rewrite.
  assert.equal(atCursor("n + in|", "f"), "n + \\infty |");
  assert.equal(atCursor("in| x", "f"), "\\infty |x");
  assert.equal(atCursor("\\in|", "f"), undefined);
  assert.equal(atCursor("coin|", "f"), undefined);
  assert.equal(atCursor("in|inity", "f"), undefined);
  assert.equal(atCursor("αin|", "f"), undefined);
});

it("can continue typing infty after inf has temporarily converted", () => {
  const replacement = editLatex("x=in + 1", 4, 4, "f");
  assert.ok(replacement);
  assert.equal(replacement.value, "x=\\infty + 1");
  const continued = editLatex(replacement.value, replacement.start, replacement.end, "t", replacement);
  assert.deepEqual(continued, { value: "x=inft + 1", start: 6, end: 6 });
  assert.equal(atCursor("x=infty| + 1", "Tab"), "x=\\infty |+ 1");

  assert.equal(editLatex(replacement.value, replacement.start, replacement.end, "t"), undefined);
  assert.equal(editLatex(replacement.value, replacement.start - 1, replacement.end - 1, "t", replacement), undefined);
  assert.equal(editLatex(replacement.value + "2", replacement.start, replacement.end, "t", replacement), undefined);
  const expanded = editLatex("infty", 5, 5, "Tab");
  assert.ok(expanded);
  assert.equal(editLatex(expanded.value, expanded.start, expanded.end, "t", expanded), undefined);
});
