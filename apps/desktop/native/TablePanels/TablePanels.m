// The system's Open and Save panels.
//
// chooseFolder(title): a folder (a .table is one).
// chooseFile(title, extensions): a file with one of those extensions.
// choosePath(title, suggestedName): where to save a new file.
// Each resolves with the chosen path, or null when the panel is cancelled.
// Choosing through a panel is what grants a sandboxed app access to it
// (com.apple.security.files.user-selected.read-write).

#import <AppKit/AppKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
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

RCT_EXPORT_METHOD(chooseFile:(NSString *)title
                  extensions:(NSArray<NSString *> *)extensions
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSOpenPanel *panel = [NSOpenPanel openPanel];
  panel.canChooseDirectories = NO;
  panel.canChooseFiles = YES;
  panel.allowsMultipleSelection = NO;
  panel.message = title;
  panel.prompt = @"Open";
  NSMutableArray<UTType *> *types = [NSMutableArray new];
  for (NSString *extension in extensions) {
    UTType *type = [UTType typeWithFilenameExtension:extension];
    if (type != nil) [types addObject:type];
  }
  if (types.count > 0) panel.allowedContentTypes = types;
  [panel beginWithCompletionHandler:^(NSModalResponse result) {
    resolve(result == NSModalResponseOK && panel.URL != nil ? panel.URL.path : [NSNull null]);
  }];
}

RCT_EXPORT_METHOD(choosePath:(NSString *)title
                  suggestedName:(NSString *)suggestedName
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSSavePanel *panel = [NSSavePanel savePanel];
  panel.canCreateDirectories = YES;
  panel.message = title;
  panel.nameFieldStringValue = suggestedName;
  [panel beginWithCompletionHandler:^(NSModalResponse result) {
    resolve(result == NSModalResponseOK && panel.URL != nil ? panel.URL.path : [NSNull null]);
  }];
}

@end
