/** Where a platform has no swipe between months: the month on its own. */
import type { MonthPagerProps } from "../controlSlots";

export function MonthPager({ month, renderMonth }: MonthPagerProps) {
  return <>{renderMonth(month)}</>;
}
