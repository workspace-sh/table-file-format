/**
 * iOS default: touch and hold a row for its actions in the system's
 * context menu (SwiftUI's, from @expo/ui), the row lifting out as the
 * preview, a destructive action in red. The row itself is React Native,
 * hosted inside the menu's trigger, so its cells still take taps.
 */
import type { ComponentProps, ReactElement } from "react";
import { Button, ContextMenu, Host, RNHostView } from "@expo/ui/swift-ui";
import type { RowActionsProps } from "../controlSlots";

export function RowActions({ actions, children }: RowActionsProps): ReactElement {
  if (actions.length === 0) return children;
  return (
    <Host matchContents>
      <ContextMenu>
        <ContextMenu.Items>
          {actions.map((action) => (
            <Button
              key={action.id}
              label={action.label}
              systemImage={action.symbol?.sf as ComponentProps<typeof Button>["systemImage"]}
              role={action.destructive ? "destructive" : "default"}
              onPress={action.onSelect}
            />
          ))}
        </ContextMenu.Items>
        <ContextMenu.Trigger>
          <RNHostView matchContents>{children}</RNHostView>
        </ContextMenu.Trigger>
      </ContextMenu>
    </Host>
  );
}

RowActions.gesture = "Touch and hold a row";
