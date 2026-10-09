#import "TableShellEntry.h"
#import "TablePanels-Swift.h"

NSViewController *TableShellCreate(NSView *rootView, NSView *inspectorView)
{
  return [TableShell createWithRootView:rootView inspectorView:inspectorView];
}

NSToolbar *TableShellToolbar(void)
{
  return [TableToolbar.shared make];
}

void TableShellFocusContent(void)
{
  [TableShell focusContent];
}
