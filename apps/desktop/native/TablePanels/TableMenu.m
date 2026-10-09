// The app's own items in the menu bar. The storyboard's menus are the
// system's template; items the app acts on are added from JS, and choosing
// one (or pressing its key equivalent, wherever focus is) sends a "menu"
// event with the item's id.
//
// setItem(id, menu, title, key, modifiers, before, checked, enabled): add
// the item to the top-level menu titled `menu` (made, before Window, if
// there's none), before the item titled `before` (or last), or update it
// if it's there already. modifiers: "command", "shift", "option",
// "control". `checked` shows it ticked; `enabled` false greys it.
// copyText(text): put text on the clipboard.
// Quitting: the app delegate's applicationShouldTerminate posts
// TableDesktopShouldTerminate; while JS listens, this sends it a "quit"
// event and the app waits (NSTerminateLater) until replyToQuit(yes) quits
// or replyToQuit(no) stays. setUnsaved(yes) turns off sudden and automatic
// termination while edits are left to write (Info.plist allows both), so
// macOS asks before ending the app.
// Development only: postKey(characters, keyCode, modifiers) brings the app
// forward (a typed key implies it's frontmost) and posts a key press to its
// own event queue, so it goes where a typed one would; postClick(x, y)
// posts a click there too, at a point measured from the content's top
// left as React measures, so it lands on whatever is under it; titles(menu)
// resolves with a menu's item titles; setWindowWidth(width) resizes the
// main window, as dragging its edge would; pressAlertButton(title) clicks
// the button titled so in a sheet shown on a window (an alert), resolving
// whether there was one.

#import <AppKit/AppKit.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import "TablePanels-Swift.h"

@interface TableMenu : RCTEventEmitter <RCTBridgeModule>
@end

@implementation TableMenu {
  NSMutableDictionary<NSString *, NSMenuItem *> *_items;
  NSMutableSet<NSString *> *_disabled;
  BOOL _observed;
  BOOL _unsaved;
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
  return @[ @"menu", @"quit", @"search" ];
}

- (void)startObserving
{
  _observed = YES;
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(shouldTerminate:)
                                               name:@"TableDesktopShouldTerminate"
                                             object:nil];
  // The toolbar's buttons and its search field (TableToolbar.swift).
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(toolbarCommand:) name:@"TableDesktopCommand" object:nil];
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(toolbarSearch:) name:@"TableDesktopSearch" object:nil];
}

- (void)stopObserving
{
  _observed = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"TableDesktopShouldTerminate" object:nil];
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"TableDesktopCommand" object:nil];
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"TableDesktopSearch" object:nil];
}

- (void)toolbarCommand:(NSNotification *)notification
{
  if (!_observed) return;
  [self sendEventWithName:@"menu" body:@{ @"id" : notification.userInfo[@"id"] ?: @"" }];
}

- (void)toolbarSearch:(NSNotification *)notification
{
  if (!_observed) return;
  [self sendEventWithName:@"search" body:@{ @"text" : notification.userInfo[@"text"] ?: @"" }];
}

- (void)shouldTerminate:(NSNotification *)notification
{
  if (!_observed) return;
  ((NSMutableDictionary *)notification.userInfo)[@"handled"] = @YES;
  [self sendEventWithName:@"quit" body:@{}];
}

static NSButton *buttonTitled(NSView *view, NSString *title)
{
  if ([view isKindOfClass:NSButton.class] && [((NSButton *)view).title isEqualToString:title]) return (NSButton *)view;
  for (NSView *sub in view.subviews) {
    NSButton *found = buttonTitled(sub, title);
    if (found != nil) return found;
  }
  return nil;
}

RCT_EXPORT_METHOD(pressAlertButton:(NSString *)title
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  for (NSWindow *window in NSApp.windows) {
    NSWindow *sheet = window.attachedSheet;
    NSButton *button = sheet ? buttonTitled(sheet.contentView, title) : nil;
    if (button != nil) {
      [button performClick:nil];
      resolve(@YES);
      return;
    }
  }
  resolve(@NO);
}

RCT_EXPORT_METHOD(setUnsaved:(BOOL)unsaved)
{
  if (unsaved == _unsaved) return;
  _unsaved = unsaved;
  NSProcessInfo *process = NSProcessInfo.processInfo;
  if (unsaved) {
    [process disableSuddenTermination];
    [process disableAutomaticTermination:@"Edits not yet written"];
  } else {
    [process enableSuddenTermination];
    [process enableAutomaticTermination:@"Edits not yet written"];
  }
}

RCT_EXPORT_METHOD(replyToQuit:(BOOL)quit)
{
  [NSApp replyToApplicationShouldTerminate:quit];
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

// The top-level menu titled `title`, made before Window when there's none.
static NSMenu *topLevelMenuMade(NSString *title)
{
  NSMenu *menu = topLevelMenu(title);
  if (menu != nil) return menu;
  menu = [[NSMenu alloc] initWithTitle:title];
  NSMenuItem *top = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
  top.submenu = menu;
  NSInteger window = [NSApp.mainMenu indexOfItemWithTitle:@"Window"];
  [NSApp.mainMenu insertItem:top atIndex:(window < 0 ? NSApp.mainMenu.numberOfItems : window)];
  return menu;
}

RCT_EXPORT_METHOD(setItem:(NSString *)itemId
                  menu:(NSString *)menuTitle
                  title:(NSString *)title
                  key:(NSString *)key
                  modifiers:(NSArray<NSString *> *)modifiers
                  before:(NSString *)before
                  checked:(BOOL)checked
                  enabled:(BOOL)enabled)
{
  if (_items == nil) _items = [NSMutableDictionary new];
  if (_disabled == nil) _disabled = [NSMutableSet new];
  if (enabled) [_disabled removeObject:itemId];
  else [_disabled addObject:itemId];
  // The toolbar's buttons are on and off as their menu items are.
  TableToolbar.disabled = _disabled;
  NSMenuItem *item = _items[itemId];
  if (item == nil) {
    NSMenu *menu = topLevelMenuMade(menuTitle);
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
  item.state = checked ? NSControlStateValueOn : NSControlStateValueOff;
}

// AppKit enables an item whose target answers its action; this says which don't, for now.
- (BOOL)validateMenuItem:(NSMenuItem *)item
{
  return ![_disabled containsObject:item.representedObject];
}

RCT_EXPORT_METHOD(copyText:(NSString *)text)
{
  [NSPasteboard.generalPasteboard clearContents];
  [NSPasteboard.generalPasteboard setString:text forType:NSPasteboardTypeString];
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

RCT_EXPORT_METHOD(postClick:(nonnull NSNumber *)x y:(nonnull NSNumber *)y)
{
  [NSApp activateIgnoringOtherApps:YES];
  NSWindow *window = NSApp.mainWindow ?: NSApp.windows.firstObject;
  // The point is in the React view, which measures down from its top left.
  NSView *root = TableShell.rootView ?: window.contentView;
  NSPoint inRoot = NSMakePoint(x.doubleValue, root.isFlipped ? y.doubleValue : root.bounds.size.height - y.doubleValue);
  NSPoint at = [root convertPoint:inRoot toView:nil];
  for (NSNumber *type in @[@(NSEventTypeLeftMouseDown), @(NSEventTypeLeftMouseUp)]) {
    NSEvent *event = [NSEvent mouseEventWithType:(NSEventType)type.unsignedIntegerValue
                                        location:at
                                   modifierFlags:0
                                       timestamp:NSProcessInfo.processInfo.systemUptime
                                    windowNumber:window.windowNumber
                                         context:nil
                                     eventNumber:0
                                      clickCount:1
                                        pressure:1];
    [NSApp postEvent:event atStart:NO];
  }
}

/// A toolbar button's label and hint, by its command's id.
RCT_EXPORT_METHOD(setToolbarLabel:(NSString *)commandId label:(NSString *)label)
{
  [TableToolbar.shared setLabel:label for:commandId];
}

/// Which side of the sidebar the toolbar's switch shows: tables, or files.
RCT_EXPORT_METHOD(setFilesMode:(BOOL)files)
{
  [TableToolbar.shared setFilesMode:files];
}

/// The search field's text, when the app changes it.
RCT_EXPORT_METHOD(setSearchText:(NSString *)text)
{
  [TableToolbar.shared setSearch:text];
}

/// Put the cursor in the toolbar's search field.
RCT_EXPORT_METHOD(focusSearch)
{
  [TableToolbar.shared focusSearch];
}

/// Text typed in the toolbar's search field: development only, as postKey is.
RCT_EXPORT_METHOD(postSearch:(NSString *)text)
{
  [TableToolbar.shared setSearch:text];
  [[NSNotificationCenter defaultCenter] postNotificationName:@"TableDesktopSearch" object:nil userInfo:@{ @"text" : text }];
}

/// A toolbar button pressed, by its command's id: development only, as postKey is.
RCT_EXPORT_METHOD(postCommand:(NSString *)commandId)
{
  [[NSNotificationCenter defaultCenter] postNotificationName:@"TableDesktopCommand" object:nil userInfo:@{ @"id" : commandId }];
}

static void adoptScrollViews(NSView *view, NSView *root, NSMutableArray<NSString *> *found)
{
  if ([view isKindOfClass:NSScrollView.class]) {
    NSScrollView *scroll = (NSScrollView *)view;
    NSRect inRoot = [scroll convertRect:scroll.bounds toView:root];
    // The one that starts at the pane's top and fills it: the view's own scroll, not a table's sideways one.
    if (NSMinY(inRoot) <= 1 && NSHeight(inRoot) > NSHeight(root.bounds) * 0.6) {
      scroll.automaticallyAdjustsContentInsets = YES;
      [found addObject:[NSString stringWithFormat:@"%@ %@ insets top %.0f", scroll.class, NSStringFromRect(inRoot), scroll.contentInsets.top]];
    }
  }
  for (NSView *sub in view.subviews) adoptScrollViews(sub, root, found);
}

/// Let the system inset the view's scroll under the toolbar itself, which is
/// what it softens content behind a toolbar for: React Native's scroll view
/// turns that off. Resolves with what it found, for a script to read.
RCT_EXPORT_METHOD(adoptToolbarInsets:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSMutableArray<NSString *> *found = [NSMutableArray new];
  NSView *root = TableShell.rootView;
  if (root != nil) adoptScrollViews(root, root, found);
  resolve(found);
}

/// How far the toolbar comes down over the content, in points: what's under it starts this far down.
RCT_EXPORT_METHOD(topInset:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSWindow *window = NSApp.mainWindow ?: NSApp.windows.firstObject;
  resolve(@(window == nil ? 0 : NSHeight(window.frame) - NSMaxY(window.contentLayoutRect)));
}

/// The window's title and the line under it: the view on screen, and where it lives.
RCT_EXPORT_METHOD(setWindowTitle:(NSString *)title subtitle:(NSString *)subtitle)
{
  NSWindow *window = NSApp.mainWindow ?: NSApp.windows.firstObject;
  window.title = title;
  window.subtitle = subtitle;
}

RCT_EXPORT_METHOD(setWindowWidth:(nonnull NSNumber *)width)
{
  NSWindow *window = NSApp.mainWindow ?: NSApp.windows.firstObject;
  NSRect frame = window.frame;
  frame.size.width = width.doubleValue;
  [window setFrame:frame display:YES animate:NO];
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
    BOOL off = item.target == self && [_disabled containsObject:item.representedObject];
    NSString *tick = [NSString stringWithFormat:@"%@%@%@%@",
                                                off ? @"(off) " : @"",
                                                item.state == NSControlStateValueOn ? @"✓ " : @"",
                                                item.isHidden ? @"(hidden) " : @"",
                                                item.isAlternate ? @"(alternate) " : @""];
    [out addObject:item.isSeparatorItem ? @"—" : [[tick stringByAppendingString:item.title] stringByAppendingString:key]];
  }
  resolve(out);
}

@end
