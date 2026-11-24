/** Where a platform has no swipe between months: the month on its own, and what's under it where it is. */
import type { FollowsMonthProps, MonthPagerProps } from "../controlSlots";

export function MonthPager({ month, renderMonth }: MonthPagerProps) {
  return <>{renderMonth(month)}</>;
}

export function FollowsMonth({ children }: FollowsMonthProps) {
  return <>{children}</>;
}
