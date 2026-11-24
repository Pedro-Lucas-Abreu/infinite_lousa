const arity = new Map<string, number>([
  ["M", 2], ["Z", 0], ["L", 2], ["H", 1], ["V", 1], ["C", 6], ["S", 4],
  ["Q", 4], ["T", 2], ["A", 7],
]);
const number = /[+-]?(?:[0-9]*\.[0-9]+|[0-9]+)(?:[eE][+-]?[0-9]+)?/y;
const whitespace = /[\t\n\f\r ]/;

// Validate one SVG 2 path, including compact coordinates and repeated arguments.
export function hasValidSvgPathData(path: string): boolean {
  let offset = 0;
  let command: string | undefined;
  let hasMove = false;
  const skipWhitespace = () => {
    while (offset < path.length && whitespace.test(path[offset])) offset++;
  };

  skipWhitespace();
  while (offset < path.length) {
    const letter = path[offset];
    const next = letter.toUpperCase();
    const explicit = arity.has(next) && (letter === next || letter === next.toLowerCase());
    if (explicit) {
      if (!hasMove && next !== "M") return false;
      command = next;
      offset++;
    }
    if (command === undefined) return false;
    if (command === "Z") {
      command = undefined;
      skipWhitespace();
      continue;
    }

    const count = arity.get(command)!;
    for (let index = 0; index < count; index++) {
      const previousEnd = offset;
      skipWhitespace();
      if (path[offset] === "," && (index !== 0 || !explicit)) {
        offset++;
        skipWhitespace();
      }
      if (command === "A" && (index === 3 || index === 4)) {
        // The rotation must be separated from the first flag; the two flags can be adjacent.
        if ((index === 3 && offset === previousEnd) || (path[offset] !== "0" && path[offset] !== "1")) return false;
        offset++;
      } else {
        number.lastIndex = offset;
        const token = number.exec(path);
        if (!token || !Number.isFinite(Number(token[0]))) return false;
        offset = number.lastIndex;
      }
    }
    if (command === "M") {
      hasMove = true;
      command = "L";
    }
    skipWhitespace();
  }
  return hasMove;
}
