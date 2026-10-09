#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>
#import <TablePanels/TableShellEntry.h>

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"TableDesktop";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  
  return [super applicationDidFinishLaunching:notification];
}

/// The window, as a Mac app's: a split view with a real sidebar and the
/// React view beside it (TableShell), under one toolbar that shares the
/// title bar's row. The content is full size, so the sidebar runs the
/// window's height and the toolbar floats over it, as the system draws them.
- (void)loadReactNativeWindow:(NSDictionary *)launchOptions
{
  RCTPlatformView *rootView = [self.rootViewFactory viewWithModuleName:self.moduleName
                                                     initialProperties:self.initialProps
                                                         launchOptions:launchOptions];

  // The React view paints no background of its own (its default is white):
  // the pane behind it paints the content's (TableShell), under the toolbar too.
  if ([rootView respondsToSelector:@selector(setBackgroundColor:)]) {
    [rootView setValue:NSColor.clearColor forKey:@"backgroundColor"];
  }

  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1280, 760)
                                            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskResizable | NSWindowStyleMaskClosable |
                                                      NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskFullSizeContentView
                                              backing:NSBackingStoreBuffered
                                                defer:NO];
  self.window.title = @".table";
  self.window.autorecalculatesKeyViewLoop = YES;
  self.window.contentViewController = TableShellCreate(rootView);

  self.window.toolbar = TableShellToolbar();
  self.window.toolbarStyle = NSWindowToolbarStyleUnified;
  // No line under the toolbar. The title bar stays the system's own (not
  // transparent): a transparent one opts the window out of the system's
  // scroll-edge effect, so content passes sharp behind the title.
  // TODO(#383): the soft effect behind the toolbar; see TableShell.swift.
  self.window.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;

  [self.window makeKeyAndOrderFront:self];
  if (![self.window setFrameUsingName:@"TableDesktopMainWindow"]) {
    [self.window setContentSize:NSMakeSize(1280, 760)];
    [self.window center];
  }
  [self.window setFrameAutosaveName:@"TableDesktopMainWindow"];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// Quitting (⌘Q, or closing the last window) waits for the app to write
/// what's left of its edits: TableMenu tells JS, which writes and replies
/// through TableMenu.replyToQuit. With no JS listening, it quits at once.
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender
{
  NSMutableDictionary *asked = [NSMutableDictionary dictionaryWithObject:@NO forKey:@"handled"];
  [[NSNotificationCenter defaultCenter] postNotificationName:@"TableDesktopShouldTerminate" object:nil userInfo:asked];
  return [asked[@"handled"] boolValue] ? NSTerminateLater : NSTerminateNow;
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
