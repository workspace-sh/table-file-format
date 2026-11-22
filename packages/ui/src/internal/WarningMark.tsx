/** That a file doesn't meet its schema, as a mark beside its name. Where there are no symbols, a character. */
import { html } from "react-strict-dom";

export function WarningMark() {
  return <html.span aria-hidden>⚠︎</html.span>;
}
