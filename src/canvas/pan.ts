export function shouldStartPan(button: number, ctrlHeld: boolean, spaceHeld: boolean, handTool: boolean): boolean {
  return button === 2 || (button === 0 && (ctrlHeld || spaceHeld || handTool))
}
