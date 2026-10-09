// The window's layout, for AppDelegate: TableShell.swift, reached from
// Objective-C++ without it needing the pod's Swift header.

#import <AppKit/AppKit.h>

NS_ASSUME_NONNULL_BEGIN

#ifdef __cplusplus
extern "C" {
#endif

/// The split view controller for the window: a sidebar, and the React view.
NSViewController *TableShellCreate(NSView *rootView);

/// Give the keyboard to the content, as the window opens.
void TableShellFocusContent(void);

/// The window's toolbar: the sidebar's button, Back and Forward, the view's actions, search.
NSToolbar *TableShellToolbar(void);

#ifdef __cplusplus
}
#endif

NS_ASSUME_NONNULL_END
