/**
 * Default (web, Android): the palette as written in each file's
 * css.create, so nothing changes. iOS has `systemColors.ios.ts`, which
 * swaps the interface's colours for the system's; macOS
 * `systemColors.macos.ts`, which swaps its lines.
 */
export function adoptSystemColors(_styles: object): void {}

/** The platform colour (by the name PlatformColor takes) that plays `role` here: none on the web or Android. */
export function systemColorName(_role: string): string | undefined {
  return undefined;
}
