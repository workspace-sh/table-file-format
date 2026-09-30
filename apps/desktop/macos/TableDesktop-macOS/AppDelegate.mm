#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

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
