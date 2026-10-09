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
  /// What was chosen from the pop-up menu on screen (popUp).
  NSString *_popUpChoice;
  /// Development only: the last pop-up menu's titles, and a choice to make from the next one.
  NSArray<NSString *> *_popUpTitles;
  NSString *_armedTitle;
  NSTimeInterval _armedDelay;
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
  return @[ @"menu", @"quit", @"search", @"contextMenu" ];
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
  // A right-click (or Control-click) in the content (TableShell.swift).
  [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(contextClick:) name:@"TableDesktopContextMenu" object:nil];
}

- (void)stopObserving
{
  _observed = NO;
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"TableDesktopShouldTerminate" object:nil];
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"TableDesktopCommand" object:nil];
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"TableDesktopSearch" object:nil];
  [[NSNotificationCenter defaultCenter] removeObserver:self name:@"TableDesktopContextMenu" object:nil];
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

- (void)contextClick:(NSNotification *)notification
{
  if (!_observed) return;
  [self sendEventWithName:@"contextMenu" body:@{ @"target" : notification.userInfo[@"target"] ?: @"" }];
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

/// Show the system's menu of `items` and resolve with the id of the one
/// chosen, or null when it's dismissed. Each item: { id, title, checked,
/// disabled, symbol (an SF Symbol's name) } or { separator: true }.
/// `at` is a point in the content, measured as React measures, where the
/// ticked item (else the menu's top) goes: what a pop-up button does.
/// Without it the menu opens where the click that asked for it landed
/// (else at the pointer), as a context menu does.
RCT_EXPORT_METHOD(popUp:(NSArray<NSDictionary *> *)items
                  at:(nullable NSDictionary *)at
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  NSMenu *menu = [[NSMenu alloc] initWithTitle:@""];
  menu.autoenablesItems = NO;
  NSMenuItem *ticked = nil;
  for (NSDictionary *item in items) {
    if ([item[@"separator"] boolValue]) {
      [menu addItem:NSMenuItem.separatorItem];
      continue;
    }
    NSMenuItem *menuItem = [[NSMenuItem alloc] initWithTitle:item[@"title"] ?: @"" action:@selector(popUpChose:) keyEquivalent:@""];
    menuItem.target = self;
    menuItem.representedObject = item[@"id"];
    menuItem.enabled = ![item[@"disabled"] boolValue];
    if ([item[@"checked"] boolValue]) {
      menuItem.state = NSControlStateValueOn;
      ticked = menuItem;
    }
    if ([item[@"symbol"] isKindOfClass:NSString.class]) {
      menuItem.image = [NSImage imageWithSystemSymbolName:item[@"symbol"] accessibilityDescription:nil];
    }
    [menu addItem:menuItem];
  }
  NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow ?: NSApp.windows.firstObject;
  NSView *view = window.contentView;
  NSValue *clicked = TableShell.recentClick;
  NSPoint point = [view convertPoint:clicked != nil ? clicked.pointValue : window.mouseLocationOutsideOfEventStream fromView:nil];
  NSView *root = TableShell.rootView;
  if (at != nil && root != nil) {
    view = root;
    double y = [at[@"y"] doubleValue];
    point = NSMakePoint([at[@"x"] doubleValue], root.isFlipped ? y : root.bounds.size.height - y);
  }
  _popUpChoice = nil;
  NSMutableArray<NSString *> *titles = [NSMutableArray new];
  for (NSMenuItem *item in menu.itemArray) {
    [titles addObject:item.isSeparatorItem ? @"-" : [NSString stringWithFormat:@"%@%@%@", item.state == NSControlStateValueOn ? @"✓ " : @"", item.title, item.image != nil ? @" (symbol)" : @""]];
  }
  _popUpTitles = titles;
  if (_armedTitle != nil) {
    // A timer in the common modes: nothing sent to the main queue runs while a menu is open.
    NSString *title = _armedTitle;
    _armedTitle = nil;
    NSTimer *timer = [NSTimer timerWithTimeInterval:_armedDelay repeats:NO block:^(NSTimer *fired) {
      NSInteger index = [menu indexOfItemWithTitle:title];
      if (index >= 0) self->_popUpChoice = [menu itemAtIndex:index].representedObject;
      [menu cancelTrackingWithoutAnimation];
    }];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
  }
  // Returns when the menu closes, the chosen item's action already sent.
  [menu popUpMenuPositioningItem:ticked atLocation:point inView:view];
  resolve(_popUpChoice ?: [NSNull null]);
}

- (void)popUpChose:(NSMenuItem *)item
{
  _popUpChoice = item.representedObject;
}

/// Development only: the titles of the last pop-up menu shown (a ticked one and one with a symbol are marked).
RCT_EXPORT_METHOD(popUpTitles:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  resolve(_popUpTitles ?: @[]);
}

/// Development only: choose from the next pop-up menu by title, `seconds`
/// after it opens, as a click on the item would; an empty title dismisses
/// it. Set before the menu opens: nothing can be asked of the app while
/// one is open.
RCT_EXPORT_METHOD(popUpChoose:(NSString *)title after:(nonnull NSNumber *)seconds)
{
  _armedTitle = title;
  _armedDelay = seconds.doubleValue;
}

/// Development only: a right-click at a point in the content, as postClick's left one.
RCT_EXPORT_METHOD(postRightClick:(nonnull NSNumber *)x y:(nonnull NSNumber *)y)
{
  [NSApp activateIgnoringOtherApps:YES];
  NSWindow *window = NSApp.mainWindow ?: NSApp.windows.firstObject;
  NSView *root = TableShell.rootView ?: window.contentView;
  NSPoint inRoot = NSMakePoint(x.doubleValue, root.isFlipped ? y.doubleValue : root.bounds.size.height - y.doubleValue);
  NSPoint at = [root convertPoint:inRoot toView:nil];
  for (NSNumber *type in @[@(NSEventTypeRightMouseDown), @(NSEventTypeRightMouseUp)]) {
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

/// What has the keyboard: development only. Resolves with the first
/// responder's class, and for a text view whether it can be edited and how
/// much text it holds.
RCT_EXPORT_METHOD(firstResponder:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  NSWindow *window = NSApp.mainWindow ?: NSApp.windows.firstObject;
  NSResponder *first = window.firstResponder;
  NSMutableDictionary *said = [@{ @"class" : NSStringFromClass(first.class) ?: @"none", @"key" : @(window.isKeyWindow) } mutableCopy];
  if ([first isKindOfClass:NSTextView.class]) {
    NSTextView *text = (NSTextView *)first;
    said[@"editable"] = @(text.isEditable);
    said[@"length"] = @(text.string.length);
    said[@"fieldEditor"] = @(text.isFieldEditor);
  }
  resolve(said);
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
