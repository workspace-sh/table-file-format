/** Where a platform has no swipe between months: the month on its own. */
import type { ReactNode } from "react";

export interface MonthPagerProps {
  /** The month shown, as a `monthPosition`. */
  month: number;
  /** The first and last months it can reach. */
  first: number;
  last: number;
  /** How tall a month's weeks are. */
  heightOf: (month: number) => number;
  renderMonth: (month: number) => ReactNode;
  /** A swipe came to rest on another month. */
  onMonth: (month: number) => void;
}

export function MonthPager({ month, renderMonth }: MonthPagerProps) {
  return <>{renderMonth(month)}</>;
}
