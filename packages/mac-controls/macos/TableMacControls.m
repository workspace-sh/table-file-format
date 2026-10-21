// The Mac's own controls for the .table library's views (src/index.tsx):
// a choice and a row's actions in the system's pop-up menu, a date in the
// system's date picker (TableDatePicker.swift), and a right-click (or
// Control-click) on a row asking for its menu.
//
// What React measures is in the coordinates of the React surface it is
// drawn in, and an app can have several (a window's content, an inspector,
// a sheet). So each is placed in the surface under the click that opened
// it, else the key window's first.

#import <AppKit/AppKit.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

#import "TableMacControls-Swift.h"

@interface TableMacControls : RCTEventEmitter
@end

/// Where the last click in a window landed (window coordinates), which window, and when.
static NSPoint lastClick;
static __weak NSWindow *lastClickWindow;
static NSTimeInterval lastClickTime;
static id clicks;
static id contextMenus;

/// Whether `view` is a React surface's own view.
static BOOL IsReactRoot(NSView *view)
{
  NSString *name = NSStringFromClass(view.class);
  return [name hasPrefix:@"RCTSurfaceHosting"] || [name isEqualToString:@"RCTRootView"];
}

/// The React surface in `window` under `point` (window coordinates): the innermost one there.
static NSView *ReactRootAt(NSWindow *window, NSPoint point)
{
  __block NSView *found = nil;
  __block void (^walk)(NSView *) = ^(NSView *view) {
    if (IsReactRoot(view) && NSPointInRect([view convertPoint:point fromView:nil], view.bounds)) found = view;
    for (NSView *child in view.subviews) walk(child);
  };
  walk(window.contentView.superview ?: window.contentView);
  walk = nil;
  return found;
}

/// The view React marked with `nativeID` `anchor` in `window`, for what opens pointing at it: its
/// place comes from AppKit, so it's right however the views around it have scrolled (an embed in
/// a document is inside its native scroll view, which React's measurements don't count).
static NSView *AnchorIn(NSWindow *window, NSString *anchor)
{
  if (anchor.length == 0 || window == nil) return nil;
  SEL nativeId = NSSelectorFromString(@"nativeId");
  __block NSView *found = nil;
  __block void (^walk)(NSView *) = ^(NSView *view) {
    if (found != nil) return;
    if ([view respondsToSelector:nativeId] && [[view valueForKey:@"nativeId"] isEqual:anchor]) {
      found = view;
      return;
    }
    for (NSView *child in view.subviews) walk(child);
  };
  walk(window.contentView);
  walk = nil;
  return found;
}

/// The first React surface in `window`, for a control opened from the keyboard.
static NSView *FirstReactRoot(NSWindow *window)
{
  __block NSView *found = nil;
  __block void (^walk)(NSView *) = ^(NSView *view) {
    if (found != nil) return;
    if (IsReactRoot(view)) {
      found = view;
      return;
    }
    for (NSView *child in view.subviews) walk(child);
  };
  walk(window.contentView);
  walk = nil;
  return found;
}

/// The window what's opening is for: the key one; else the main one; else the one clicked last;
/// else the first on screen (the app needn't be in front for a menu or a picker to open).
static NSWindow *CurrentWindow(void)
{
  NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow ?: lastClickWindow;
  if (window != nil) return window;
  for (NSWindow *candidate in NSApp.windows) {
    if (candidate.isVisible && candidate.contentView != nil) return candidate;
  }
  return nil;
}

/// Whether the last click was in `window` a moment ago: a menu opening now is for it. Otherwise it
/// was asked for from the keyboard, and the pointer may be anywhere.
static BOOL RecentClickIn(NSWindow *window)
{
  return lastClickWindow != nil && lastClickWindow == window && NSProcessInfo.processInfo.systemUptime - lastClickTime < 1;
}

/// The surface what's opening belongs to: under a click a moment ago; else the one holding the
/// keyboard; else under the last click in the key window; else its first.
static NSView *CurrentReactRoot(void)
{
  NSWindow *window = CurrentWindow();
  if (window == nil) return nil;
  if (RecentClickIn(window)) {
    NSView *root = ReactRootAt(window, lastClick);
    if (root != nil) return root;
  }
  if ([window.firstResponder isKindOfClass:NSView.class]) {
    for (NSView *view = (NSView *)window.firstResponder; view != nil; view = view.superview) {
      if (IsReactRoot(view)) return view;
    }
  }
  if (lastClickWindow == window) {
    NSView *root = ReactRootAt(window, lastClick);
    if (root != nil) return root;
  }
  return FirstReactRoot(window);
}

@implementation TableMacControls {
  NSString *_popUpChoice;
  NSArray<NSString *> *_popUpTitles;
  NSString *_armedTitle;
  NSTimeInterval _armedDelay;
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

- (instancetype)init
{
  if ((self = [super init])) {
    // Where each click lands, for where a menu or a picker opening from it belongs.
    if (clicks == nil) {
      clicks = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown
                                                     handler:^NSEvent *(NSEvent *event) {
        if (event.window != nil) {
          lastClick = event.locationInWindow;
          lastClickWindow = event.window;
          lastClickTime = event.timestamp;
        }
        return event;
      }];
    }
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ @"contextMenu", @"settingsForm", @"choiceToggled" ];
}

- (void)startObserving
{
  _observed = YES;
  // What's done in the inspector's settings form (TableInspector.swift), for src/settings.tsx.
  __weak TableMacControls *weakForm = self;
  [TableInspector listen:^(NSDictionary *event) {
    TableMacControls *controls = weakForm;
    if (controls != nil && controls->_observed) [controls sendEventWithName:@"settingsForm" body:event];
  }];
  if (contextMenus != nil) return;
  __weak TableMacControls *weakSelf = self;
  // A right-click (or Control-click) in a React surface asks for the menu of
  // what's under the pointer: the nearest view up from the one clicked that
  // React marked as having one (an `id` starting "menu-", src/index.tsx).
  contextMenus = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskRightMouseDown | NSEventMaskLeftMouseDown
                                                       handler:^NSEvent *(NSEvent *event) {
    TableMacControls *controls = weakSelf;
    if (controls == nil || !controls->_observed) return event;
    if (event.type != NSEventTypeRightMouseDown && !(event.modifierFlags & NSEventModifierFlagControl)) return event;
    NSWindow *window = event.window;
    NSView *root = window != nil ? ReactRootAt(window, event.locationInWindow) : nil;
    if (root == nil) return event;
    NSString *target = @"";
    SEL nativeId = NSSelectorFromString(@"nativeId");
    NSView *view = [window.contentView.superview ?: window.contentView hitTest:[(window.contentView.superview ?: window.contentView) convertPoint:event.locationInWindow fromView:nil]];
    while (view != nil && view != root.superview) {
      if ([view respondsToSelector:nativeId]) {
        id value = [view valueForKey:@"nativeId"];
        if ([value isKindOfClass:NSString.class] && [(NSString *)value hasPrefix:@"menu-"]) {
          target = value;
          break;
        }
      }
      view = view.superview;
    }
    [controls sendEventWithName:@"contextMenu" body:@{ @"target" : target }];
    // A Control-click is not also a click; and a right-click that has a menu
    // goes no further (in a development build React Native would show its
    // own menu for it as well).
    return event.type == NSEventTypeLeftMouseDown || target.length > 0 ? nil : event;
  }];
}

- (void)stopObserving
{
  _observed = NO;
}

/// Show the system's menu of `items` and resolve with the id of the one
/// chosen, or null when it's dismissed. Each item: { id, title, checked,
/// disabled, symbol (an SF Symbol's name) } or { separator: true }.
/// `at` is a point in the React surface, measured as React measures, where
/// the ticked item (else the menu's top) goes: what a pop-up button does.
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
  NSWindow *window = CurrentWindow();
  NSView *view = window.contentView;
  NSPoint point = [view convertPoint:RecentClickIn(window) ? lastClick : window.mouseLocationOutsideOfEventStream fromView:nil];
  NSView *root = CurrentReactRoot();
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

/// The system's date picker in a popover pointing at the view React marked
/// with `nativeID` `anchor`, else at `rect` (a cell, as React measures: x,
/// y, width, height in its surface). `kind` is "date",
/// "time" or "datetime"; `date` is milliseconds since 1970, or null for
/// none yet. Resolves with the date chosen, or null when nothing changed.
RCT_EXPORT_METHOD(pickDate:(NSString *)kind
                  date:(nullable NSNumber *)date
                  rect:(NSDictionary *)rect
                  anchor:(nullable NSString *)anchor
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  // The cell's own view, when it's marked: pointing at it needs no measuring.
  NSView *anchored = AnchorIn(CurrentWindow(), anchor);
  if (anchored != nil) {
    [TableDatePicker.shared showWithKind:kind date:date rect:anchored.bounds in:anchored done:^(NSNumber *chosen) {
      resolve(chosen ?: [NSNull null]);
    }];
    return;
  }
  NSView *root = CurrentReactRoot();
  if (root == nil) {
    resolve([NSNull null]);
    return;
  }
  double height = [rect[@"height"] doubleValue];
  double y = [rect[@"y"] doubleValue];
  NSRect at = NSMakeRect([rect[@"x"] doubleValue], root.isFlipped ? y : root.bounds.size.height - y - height, [rect[@"width"] doubleValue], height);
  [TableDatePicker.shared showWithKind:kind date:date rect:at in:root done:^(NSNumber *chosen) {
    resolve(chosen ?: [NSNull null]);
  }];
}

/// Development only: whether the date picker is showing; setting its date
/// as a click in it would; and closing it as a click outside would.
RCT_EXPORT_METHOD(datePickerShown:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
{
  resolve(@(TableDatePicker.shared.isShown));
}
RCT_EXPORT_METHOD(datePickerSet:(nonnull NSNumber *)date)
{
  [TableDatePicker.shared setWithDate:date];
}
RCT_EXPORT_METHOD(datePickerClose)
{
  [TableDatePicker.shared close];
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

/// The inspector's settings form (TableInspector.swift), as JSON; "" for none.
RCT_EXPORT_METHOD(setSettingsForm:(NSString *)json)
{
  [TableInspector setForm:json];
}

/// Open or close the inspector.
RCT_EXPORT_METHOD(setInspectorShown:(BOOL)shown)
{
  [TableInspector setShown:shown];
}

/// Several choices (`options`: { value, label, color }) in a popover pointing at
/// the view React marked with `nativeID` `anchor`, else at `rect` (as React
/// measures in its surface), `selected` ticked (TableChoicePicker.swift). Each
/// pick is sent as a `choiceToggled` event; resolves when it closes.
RCT_EXPORT_METHOD(chooseMany:(NSArray<NSDictionary *> *)options
                  selected:(NSArray<NSString *> *)selected
                  rect:(NSDictionary *)rect
                  anchor:(nullable NSString *)anchor
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
  __weak TableMacControls *weakSelf = self;
  void (^toggled)(NSString *) = ^(NSString *value) {
    TableMacControls *controls = weakSelf;
    if (controls != nil && controls->_observed) [controls sendEventWithName:@"choiceToggled" body:@{ @"value" : value }];
  };
  void (^done)(void) = ^{
    resolve([NSNull null]);
  };
  NSView *anchored = AnchorIn(CurrentWindow(), anchor);
  if (anchored != nil) {
    [TableChoicePicker.shared showWithOptions:options selected:selected rect:anchored.bounds in:anchored toggled:toggled done:done];
    return;
  }
  NSView *root = CurrentReactRoot();
  if (root == nil) {
    resolve([NSNull null]);
    return;
  }
  double height = [rect[@"height"] doubleValue];
  double y = [rect[@"y"] doubleValue];
  NSRect at = NSMakeRect([rect[@"x"] doubleValue], root.isFlipped ? y : root.bounds.size.height - y - height, [rect[@"width"] doubleValue], height);
  [TableChoicePicker.shared showWithOptions:options selected:selected rect:at in:root toggled:toggled done:done];
}

/// Close the popover of several choices, if one is open.
RCT_EXPORT_METHOD(chooseManyClose)
{
  [TableChoicePicker.shared close];
}

@end
