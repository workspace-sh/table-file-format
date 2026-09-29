// The system Open panel, for choosing a .table folder to open.
//
// chooseFolder(title) resolves with the chosen folder's path, or null when
// the panel is cancelled. A .table is a folder, so the panel picks folders
// only. Choosing it through the panel is what grants a sandboxed app access
// to it (com.apple.security.files.user-selected.read-write).

#import <AppKit/AppKit.h>
#import <React/RCTBridgeModule.h>

@interface TablePanels : NSObject <RCTBridgeModule>
@end

@implementation TablePanels

RCT_EXPORT_MODULE();

// Panels are AppKit, so they run on the main thread.
- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

RCT_EXPORT_METHOD(chooseFolder:(NSString *)title
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseDirectories = YES;
  panel.canChooseFiles = NO;
  panel.allowsMultipleSelection = NO;
  panel.canCreateDirectories = YES;
  panel.message = title;
  panel.prompt = @"Open";
  [panel beginWithCompletionHandler:^(NSModalResponse result) {
    if (result == NSModalResponseOK && panel.URL != nil) {
      resolve(panel.URL.path);
    } else {
      resolve([NSNull null]);
    }
  }];
}

@end
