/**
 * Default (web, Android): the palette as written in each file's
 * css.create, so nothing changes. iOS has `systemColors.ios.ts`, which
 * swaps the interface's colours for the system's; macOS
 * `systemColors.macos.ts`, which swaps its lines.
 */
export function adoptSystemColors(_styles: object): void {}
