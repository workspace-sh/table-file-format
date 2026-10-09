#import "TableShellEntry.h"
#import "TablePanels-Swift.h"

NSViewController *TableShellCreate(NSView *rootView)
{
  return [TableShell createWithRootView:rootView];
}

NSToolbar *TableShellToolbar(void)
{
  return [TableToolbar.shared make];
}
