// The app's own items in the menu bar. The storyboard's menus are the
// system's template; items the app acts on are added from JS, and choosing
// one (or pressing its key equivalent, wherever focus is) sends a "menu"
// event with the item's id.
//
// setItem(id, menu, title, key, modifiers, before): add the item to the
// top-level menu titled `menu`, before the item titled `before` (or last),
// or update it if it's there already. modifiers: "command", "shift",
// "option", "control".
// Development only: postKey(characters, keyCode, modifiers) brings the app
// forward (a typed key implies it's frontmost) and posts a key press to its
// own event queue, so it goes where a typed one would; titles(menu)
// resolves with a menu's item titles.

#import <AppKit/AppKit.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface TableMenu : RCTEventEmitter <RCTBridgeModule>
@end

@implementation TableMenu {
  NSMutableDictionary<NSString *, NSMenuItem *> *_items;
  BOOL _observed;
}

RCT_EXPORT_MODULE();

- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"menu" ];
}

- (void)startObserving
{
  _observed = YES;
}

- (void)stopObserving
{
  _observed = NO;
}

static NSEventModifierFlags flagsFor(NSArray<NSString *> *modifiers)
{
  NSEventModifierFlags flags = 0;
  for (NSString *m in modifiers) {
    if ([m isEqualToString:@"command"]) flags |= NSEventModifierFlagCommand;
    else if ([m isEqualToString:@"shift"]) flags |= NSEventModifierFlagShift;
    else if ([m isEqualToString:@"option"]) flags |= NSEventModifierFlagOption;
    else if ([m isEqualToString:@"control"]) flags |= NSEventModifierFlagControl;
  }
  return flags;
}

static NSMenu *topLevelMenu(NSString *title)
{
  for (NSMenuItem *item in NSApp.mainMenu.itemArray) {
    if ([item.submenu.title isEqualToString:title] || [item.title isEqualToString:title]) return item.submenu;
  }
  return nil;
}

RCT_EXPORT_METHOD(setItem:(NSString *)itemId
                  menu:(NSString *)menuTitle
                  title:(NSString *)title
                  key:(NSString *)key
                  modifiers:(NSArray<NSString *> *)modifiers
                  before:(NSString *)before)
{
  if (_items == nil) _items = [NSMutableDictionary new];
  NSMenuItem *item = _items[itemId];
  if (item == nil) {
    NSMenu *menu = topLevelMenu(menuTitle);
    if (menu == nil) return;
    item = [[NSMenuItem alloc] initWithTitle:title action:@selector(chosen:) keyEquivalent:key];
    item.target = self;
    item.representedObject = itemId;
    NSInteger at = before.length > 0 ? [menu indexOfItemWithTitle:before] : -1;
    [menu insertItem:item atIndex:(at < 0 ? menu.numberOfItems : at)];
    _items[itemId] = item;
  }
  item.title = title;
  item.keyEquivalent = key;
  item.keyEquivalentModifierMask = flagsFor(modifiers);
}

- (void)chosen:(NSMenuItem *)item
{
  if (_observed) [self sendEventWithName:@"menu" body:@{ @"id" : item.representedObject }];
}

RCT_EXPORT_METHOD(postKey:(NSString *)characters
                  keyCode:(nonnull NSNumber *)keyCode
                  modifiers:(NSArray<NSString *> *)modifiers)
{
  [NSApp activateIgnoringOtherApps:YES];
  NSEvent *event = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                    location:NSZeroPoint
                               modifierFlags:flagsFor(modifiers)
                                   timestamp:NSProcessInfo.processInfo.systemUptime
                                windowNumber:NSApp.mainWindow.windowNumber
                                     context:nil
                                  characters:characters
                 charactersIgnoringModifiers:characters
                                   isARepeat:NO
                                     keyCode:(unsigned short)keyCode.unsignedShortValue];
  [NSApp postEvent:event atStart:NO];
}

RCT_EXPORT_METHOD(titles:(NSString *)menuTitle
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSMutableArray<NSString *> *out = [NSMutableArray new];
  for (NSMenuItem *item in topLevelMenu(menuTitle).itemArray) {
    NSString *key = item.keyEquivalent.length > 0
      ? [NSString stringWithFormat:@" [%@%@]", (item.keyEquivalentModifierMask & NSEventModifierFlagCommand) ? @"⌘" : @"", item.keyEquivalent]
      : @"";
    [out addObject:item.isSeparatorItem ? @"—" : [item.title stringByAppendingString:key]];
  }
  resolve(out);
}

@end
