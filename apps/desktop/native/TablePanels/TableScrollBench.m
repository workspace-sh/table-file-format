// A scrolling run, for measuring: the same gestures every time, fed to the
// view's scroll as a trackpad's would be, with what the main thread managed
// meanwhile written down. It runs in a build of any configuration, and only
// when asked for on the command line:
//
//   TableDesktop.app --args -open big-1000000/deals -scrollBench /tmp/run.json
//
// Optional: -scrollBenchAfter <seconds before it starts, 25>,
// -scrollBenchScript <standard|slow|flicks|fast>, -scrollBenchQuit YES,
// -scrollBenchGesture YES.
//
// The scrolling arrives as a wheel's does: each event moves the page by
// itself, on the main thread. A trackpad's gesture (began, changed, ended,
// momentum) is tracked by AppKit from the system's own event stream, off the
// main thread, and events handed to a view can't stand in for that:
// -scrollBenchGesture sends them so, and the page doesn't move. To measure
// the gesture's path, post real events from outside the app.
//
// The run is 3 s of slow dragging, eight flicks with momentum, then 4 s of
// fast dragging, all down the page. What's written (JSON):
//   - frames: how many display refreshes the main thread answered, how many
//     it missed, and its longest gaps;
//   - blank: at each answered refresh, the share of the table's place on
//     screen that had no rows drawn (the boxes RowList marks `table-rows`);
//   - moved: how far the page scrolled, against how far the gestures asked.

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#import <React/RCTLog.h>

// -scrollBenchTimeline YES: everything that happens during the run, in order and timed from its
// start: each move of the page, each change of the view tree, each display refresh answered (with
// where the page and the drawn rows were), and each line the JavaScript logs that begins "TR ".
static NSMutableArray<NSArray *> *timeline;
static CFTimeInterval timelineStart;
static BOOL timelineOn;

static void Note(NSString *kind, NSString *what)
{
  if (!timelineOn) return;
  NSArray *entry = @[@(round((CACurrentMediaTime() - timelineStart) * 10000) / 10), kind, what];
  @synchronized(timeline) {
    [timeline addObject:entry];
  }
}

// How often, and for how long, the app's text was drawn and its view tree
// changed during the run: counted by standing in for React Native's own
// methods while a run is asked for.
static NSUInteger viewsPutIn;
static NSUInteger textDraws;
static double textDrawSeconds;
static NSUInteger mounts;
static double mountSeconds;
static NSUInteger textStates;
static NSUInteger textLayouts;
static NSMutableDictionary<NSString *, NSNumber *> *displays;
static BOOL displaysOn;
static NSUInteger viewsTakenOut;
static NSUInteger viewProps;
static NSUInteger viewLayouts;

static void TimeMethod(Class cls, SEL selector, NSUInteger *count, double *seconds)
{
  Method method = class_getInstanceMethod(cls, selector);
  if (method == NULL) return;
  IMP original = method_getImplementation(method);
  const char *types = method_getTypeEncoding(method);
  IMP timed;
  if (strstr(types, "{CGRect") != NULL) {
    timed = imp_implementationWithBlock(^(id self, CGRect rect) {
      CFTimeInterval began = CACurrentMediaTime();
      ((void (*)(id, SEL, CGRect))original)(self, selector, rect);
      *count += 1;
      *seconds += CACurrentMediaTime() - began;
    });
  } else {
    timed = imp_implementationWithBlock(^(id self, void *argument) {
      CFTimeInterval began = CACurrentMediaTime();
      NSUInteger putInBefore = viewsPutIn;
      ((void (*)(id, SEL, void *))original)(self, selector, argument);
      *count += 1;
      *seconds += CACurrentMediaTime() - began;
      if (count == &mounts) Note(@"mount", [NSString stringWithFormat:@"%.1f ms, %lu views put in", (CACurrentMediaTime() - began) * 1000, (unsigned long)(viewsPutIn - putInBefore)]);
    });
  }
  class_replaceMethod(cls, selector, timed, types);
}

/// The same for a method of two arguments, each a reference.
static void CountMethod2(Class cls, SEL selector, NSUInteger *count)
{
  Method method = class_getInstanceMethod(cls, selector);
  if (method == NULL) return;
  IMP original = method_getImplementation(method);
  IMP counted = imp_implementationWithBlock(^(id self, void *first, void *second) {
    ((void (*)(id, SEL, void *, void *))original)(self, selector, first, second);
    *count += 1;
  });
  class_replaceMethod(cls, selector, counted, method_getTypeEncoding(method));
}

/// A text view and what's around it, outwards: which views have a layer of their own, and so a drawing of their own.
static NSArray<NSString *> *ChainFrom(NSView *view)
{
  NSMutableArray<NSString *> *chain = [NSMutableArray array];
  for (NSView *at = view; at != nil && chain.count < 14; at = at.superview) {
    [chain addObject:[NSString stringWithFormat:@"%@ frame %@ bounds %@ visible %@ clips=%d flipped=%d layerBounds %@ transform=%d contents=%d masks=%d",
                                                 at.className, NSStringFromRect(at.frame), NSStringFromRect(at.bounds), NSStringFromRect(at.visibleRect),
                                                 at.clipsToBounds, at.isFlipped, NSStringFromRect(at.layer.bounds),
                                                 !CATransform3DIsIdentity(at.layer.transform), at.layer.contents != nil, at.layer.masksToBounds]];
  }
  return chain;
}

// Who asks for a text view to be drawn again (-scrollBenchWhy YES): the
// first few different call stacks that mark a text view, or its layer, as
// needing display during the run.
static NSMutableDictionary<NSString *, NSNumber *> *whyStacks;
static BOOL whyOn;

static void NoteWhy(NSString *what)
{
  if (!whyOn) return;
  NSArray<NSString *> *symbols = NSThread.callStackSymbols;
  NSMutableArray<NSString *> *frames = [NSMutableArray array];
  for (NSUInteger i = 2; i < MIN(symbols.count, (NSUInteger)18); i++) {
    // "3   AppKit    0x0000 -[NSView foo] + 12": keep the library and the symbol.
    NSArray<NSString *> *parts = [symbols[i] componentsSeparatedByCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
    parts = [parts filteredArrayUsingPredicate:[NSPredicate predicateWithFormat:@"length > 0"]];
    if (parts.count > 3) [frames addObject:[[parts subarrayWithRange:NSMakeRange(3, parts.count - 3)] componentsJoinedByString:@" "]];
  }
  NSString *key = [NSString stringWithFormat:@"%@ <- %@", what, [frames componentsJoinedByString:@" <- "]];
  if (whyStacks.count < 12 || whyStacks[key]) whyStacks[key] = @(whyStacks[key].unsignedIntegerValue + 1);
}

static void WatchWhy(void)
{
  whyStacks = [NSMutableDictionary dictionary];
  Class text = NSClassFromString(@"RCTParagraphTextView");
  {
    Method method = class_getInstanceMethod(NSView.class, @selector(setNeedsDisplayInRect:));
    IMP original = method_getImplementation(method);
    class_replaceMethod(NSView.class, @selector(setNeedsDisplayInRect:), imp_implementationWithBlock(^(NSView *self, NSRect rect) {
      if ([self isKindOfClass:text]) NoteWhy(@"view setNeedsDisplayInRect");
      ((void (*)(id, SEL, NSRect))original)(self, @selector(setNeedsDisplayInRect:), rect);
    }), method_getTypeEncoding(method));
  }
  {
    Method method = class_getInstanceMethod(NSView.class, @selector(setNeedsDisplay:));
    IMP original = method_getImplementation(method);
    class_replaceMethod(NSView.class, @selector(setNeedsDisplay:), imp_implementationWithBlock(^(NSView *self, BOOL needs) {
      if (needs && [self isKindOfClass:text]) NoteWhy(@"view setNeedsDisplay");
      ((void (*)(id, SEL, BOOL))original)(self, @selector(setNeedsDisplay:), needs);
    }), method_getTypeEncoding(method));
  }
  {
    Method method = class_getInstanceMethod(CALayer.class, @selector(setNeedsDisplayInRect:));
    IMP original = method_getImplementation(method);
    class_replaceMethod(CALayer.class, @selector(setNeedsDisplayInRect:), imp_implementationWithBlock(^(CALayer *self, CGRect rect) {
      if ([self.delegate isKindOfClass:text]) NoteWhy(@"layer setNeedsDisplayInRect");
      ((void (*)(id, SEL, CGRect))original)(self, @selector(setNeedsDisplayInRect:), rect);
    }), method_getTypeEncoding(method));
  }
  {
    Method method = class_getInstanceMethod(CALayer.class, @selector(setNeedsDisplay));
    IMP original = method_getImplementation(method);
    class_replaceMethod(CALayer.class, @selector(setNeedsDisplay), imp_implementationWithBlock(^(CALayer *self) {
      if ([self.delegate isKindOfClass:text]) NoteWhy(@"layer setNeedsDisplay");
      ((void (*)(id, SEL))original)(self, @selector(setNeedsDisplay));
    }), method_getTypeEncoding(method));
  }
  {
    Method method = class_getInstanceMethod(CALayer.class, @selector(setContents:));
    IMP original = method_getImplementation(method);
    class_replaceMethod(CALayer.class, @selector(setContents:), imp_implementationWithBlock(^(CALayer *self, id contents) {
      if (contents == nil && [self.delegate isKindOfClass:text]) NoteWhy(@"layer contents cleared");
      ((void (*)(id, SEL, id))original)(self, @selector(setContents:), contents);
    }), method_getTypeEncoding(method));
  }
}

static NSView *FirstOfClass(NSView *view, Class cls, int depth)
{
  if ([view isKindOfClass:cls]) return view;
  if (depth > 60) return nil;
  for (NSView *subview in view.subviews) {
    NSView *found = FirstOfClass(subview, cls, depth + 1);
    if (found) return found;
  }
  return nil;
}

typedef struct {
  double at;       // seconds from the start
  int dy;          // pixels, negative down the page
  int phase;       // a drag's: 1 began, 2 changed, 4 ended
  int momentum;    // what follows a flick: 1 began, 2 continues, 3 ended
} BenchEvent;

@interface TableScrollBench : NSObject
@end

@implementation TableScrollBench {
  NSString *_out;
  NSString *_script;
  BOOL _quit;
  BOOL _gesture;
  BOOL _led;
  NSDictionary *_viewsAtStart;
  NSDictionary *_probe;
  id _moves;
  BOOL _queued;
  BOOL _listen;
  double _listenSeconds;
  int _windowField;
  id _monitor;
  NSUInteger _arrived;
  NSUInteger _arrivedNoWindow;
  NSUInteger _arrivedPhased;
  NSString *_firstArrived;
  NSWindow *_window;
  NSView *_target;
  NSScrollView *_scroll;
  CGPoint _at;
  NSMutableData *_events;
  NSUInteger _next;
  CFTimeInterval _start;
  dispatch_source_t _timer;
  CADisplayLink *_link;
  NSMutableArray<NSNumber *> *_ticks;
  NSMutableArray<NSNumber *> *_blank;
  NSMutableArray<NSNumber *> *_places;
  NSMutableArray<NSView *> *_boxes;
  double _startY;
  double _asked;
  double _frame;
  NSUInteger _delivered;
}

+ (void)load
{
  NSString *out = [NSUserDefaults.standardUserDefaults stringForKey:@"scrollBench"];
  if (out.length == 0) return;
  static TableScrollBench *bench;
  bench = [TableScrollBench new];
  // A run is often made with the window out of sight (a locked screen, another app in front),
  // and macOS then naps the app about half a minute after launch: timers come late and the app
  // is given little time, so it scrolls as it never would in front of someone. Not while measuring.
  static id awake;
  awake = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiated | NSActivityLatencyCritical reason:@"A scrolling run is being measured"];
  bench->_out = out;
  bench->_script = [NSUserDefaults.standardUserDefaults stringForKey:@"scrollBenchScript"] ?: @"standard";
  bench->_quit = [NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchQuit"];
  bench->_gesture = [NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchGesture"];
  bench->_queued = [NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchQueue"];
  bench->_listen = [NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchListen"];
  bench->_listenSeconds = [NSUserDefaults.standardUserDefaults doubleForKey:@"scrollBenchSeconds"] ?: 26;
  // -scrollBenchResponsive NO: every scroll view scrolls on the main thread, as before AppKit's
  // responsive scrolling. A gesture handed to a view then moves the page, momentum and all.
  if ([NSUserDefaults.standardUserDefaults objectForKey:@"scrollBenchResponsive"] != nil && ![NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchResponsive"]) {
    Class scroll = NSClassFromString(@"RCTEnhancedScrollView");
    Method method = class_getClassMethod(scroll, @selector(isCompatibleWithResponsiveScrolling));
    if (method != NULL) {
      class_replaceMethod(object_getClass(scroll), @selector(isCompatibleWithResponsiveScrolling), imp_implementationWithBlock(^BOOL(__unused id cls) {
        return NO;
      }), method_getTypeEncoding(method));
    }
  }
  if ([NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchTimeline"]) {
    timeline = [NSMutableArray array];
    RCTSetLogThreshold(RCTLogLevelInfo);
    RCTAddLogFunction(^(__unused RCTLogLevel level, __unused RCTLogSource source, __unused NSString *file, __unused NSNumber *line, NSString *message) {
      if ([message hasPrefix:@"TR "]) Note(@"js", [message substringFromIndex:3]);
    });
  }
  double after = [NSUserDefaults.standardUserDefaults doubleForKey:@"scrollBenchAfter"] ?: 25;
  [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidFinishLaunchingNotification
                                                  object:nil
                                                   queue:NSOperationQueue.mainQueue
                                              usingBlock:^(__unused NSNotification *note) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(after * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [bench begin];
    });
  }];
}

#pragma mark The gestures

- (void)add:(double)at dy:(int)dy phase:(int)phase momentum:(int)momentum
{
  BenchEvent event = {at, dy, phase, momentum};
  [_events appendBytes:&event length:sizeof(event)];
  _asked += dy;
}

/// A drag of the fingers: began, `seconds` of `dy` each 120th of a second, ended. Returns when it ends.
- (double)drag:(int)dy seconds:(double)seconds from:(double)t
{
  const double step = 1.0 / 120;
  // A gesture begins with its first movement: which way it runs decides which scroll view takes it.
  [self add:t dy:dy phase:1 momentum:0];
  int n = (int)(seconds * 120);
  for (int i = 1; i < n; i++) [self add:(t += step) dy:dy phase:2 momentum:0];
  [self add:(t += step) dy:0 phase:4 momentum:0];
  return t;
}

/// What follows a flick: momentum, falling away from `dy` over `seconds`.
- (double)momentum:(int)dy seconds:(double)seconds from:(double)t
{
  const double step = 1.0 / 120;
  int n = (int)(seconds * 120);
  [self add:(t += step) dy:dy phase:0 momentum:1];
  for (int i = 1; i < n; i++) {
    double f = pow(1.0 - (double)i / n, 2);
    [self add:(t += step) dy:(int)round(dy * f) phase:0 momentum:2];
  }
  [self add:(t += step) dy:0 phase:0 momentum:3];
  return t;
}

- (void)write
{
  _events = [NSMutableData data];
  _asked = 0;
  double t = 0;
  BOOL all = [_script isEqualToString:@"standard"];
  if (all || [_script isEqualToString:@"slow"]) t = [self drag:-4 seconds:3 from:t] + 0.3;
  // Brisk, as a hand moving down a table to find something: 2,400 points a second.
  if ([_script isEqualToString:@"medium"]) t = [self drag:-20 seconds:3 from:t];
  // A hard flick: twice as fast at its start as the others, and longer in falling away.
  if ([_script isEqualToString:@"hardflick"]) {
    t = [self drag:-120 seconds:0.2 from:t];
    t = [self momentum:-120 seconds:1.5 from:t] + 1.5;
  }
  if ([_script isEqualToString:@"hardflicks"]) {
    for (int i = 0; i < 4; i++) {
      t = [self drag:-120 seconds:0.2 from:t];
      t = [self momentum:-120 seconds:1.5 from:t] + 0.4;
    }
  }
  // One flick, and then nothing: how long the table takes to fill once the page has stopped.
  if ([_script isEqualToString:@"flick"]) {
    t = [self drag:-60 seconds:0.2 from:t];
    t = [self momentum:-60 seconds:1.0 from:t] + 1.5;
  }
  if (all || [_script isEqualToString:@"flicks"]) {
    for (int i = 0; i < 8; i++) {
      t = [self drag:-60 seconds:0.2 from:t];
      t = [self momentum:-60 seconds:1.0 from:t] + 0.3;
    }
  }
  if (all || [_script isEqualToString:@"fast"]) t = [self drag:-120 seconds:4 from:t];
}

#pragma mark The run

/// -scrollBenchLead <points>: scroll that far down first and let the page settle, so the run
/// measures scrolling in the middle of a table, where a row goes off for each that comes on,
/// and not from its top, where the rows kept drawn above the screen are still being added.
- (void)begin
{
  double lead = [NSUserDefaults.standardUserDefaults doubleForKey:@"scrollBenchLead"];
  if (lead > 0 && !_led) {
    _led = YES;
    NSWindow *window = NSApp.mainWindow ?: NSApp.windows.firstObject;
    NSView *root = window.contentView.superview ?: window.contentView;
    NSPoint inWindow = NSMakePoint(NSWidth(window.frame) * 0.6, NSHeight(window.frame) * 0.4);
    NSView *under = [root hitTest:inWindow] ?: window.contentView;
    // -scrollBenchLeadJump YES: there in one move, not by scrolling through what's between.
    int steps = [NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchLeadJump"] ? 1 : (int)ceil(lead / 300);
    for (int i = 0; i < steps; i++) {
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(i * 0.05 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        CGEventRef scroll = CGEventCreateScrollWheelEvent2(NULL, kCGScrollEventUnitPixel, 1, -(int)(lead / steps), 0, 0);
        CGEventSetIntegerValueField(scroll, kCGScrollWheelEventIsContinuous, 1);
        [under scrollWheel:[NSEvent eventWithCGEvent:scroll]];
        CFRelease(scroll);
      });
    }
    // -scrollBenchLeadRest <seconds>: how long the page is left to settle after it (4).
    double rest = [NSUserDefaults.standardUserDefaults doubleForKey:@"scrollBenchLeadRest"] ?: 4;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)((steps * 0.05 + rest) * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [self begin];
    });
    return;
  }
  _window = NSApp.mainWindow ?: NSApp.windows.firstObject;
  for (NSWindow *window in NSApp.windows) {
    if (window.isVisible && window.frame.size.width * window.frame.size.height > _window.frame.size.width * _window.frame.size.height) _window = window;
  }
  [NSApp activateIgnoringOtherApps:YES];
  [_window makeKeyAndOrderFront:nil];
  NSView *root = _window.contentView.superview ?: _window.contentView;
  NSPoint inWindow = NSMakePoint(NSWidth(_window.frame) * 0.6, NSHeight(_window.frame) * 0.4);
  NSView *under = [root hitTest:inWindow] ?: _window.contentView;
  // The page's own scroll: the outermost one around the point that scrolls down.
  for (NSView *view = under; view != nil; view = view.superview) {
    if ([view isKindOfClass:NSScrollView.class]) {
      NSScrollView *scroll = (NSScrollView *)view;
      if (NSHeight(scroll.documentView.frame) > NSHeight(scroll.contentView.bounds) + 1) _scroll = scroll;
    }
  }
  if (_scroll == nil) {
    [self finishWith:@{@"error": @"no view under the window's middle scrolls down"}];
    return;
  }
  _target = under;
  NSPoint onScreen = [_window convertPointToScreen:inWindow];
  // Quartz measures down from the top of the main screen.
  _at = CGPointMake(onScreen.x, NSMaxY(NSScreen.screens.firstObject.frame) - onScreen.y);
  if (_listen) {
    _events = [NSMutableData data];
    _asked = 0;
  } else {
    [self write];
  }
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    TimeMethod(NSClassFromString(@"RCTParagraphTextView"), @selector(drawRect:), &textDraws, &textDrawSeconds);
    TimeMethod(NSClassFromString(@"RCTMountingManager"), NSSelectorFromString(@"performTransaction:"), &mounts, &mountSeconds);
    if ([NSUserDefaults.standardUserDefaults boolForKey:@"scrollBenchWhy"]) WatchWhy();
    CountMethod2(NSClassFromString(@"RCTParagraphComponentView"), NSSelectorFromString(@"updateState:oldState:"), &textStates);
    CountMethod2(NSClassFromString(@"RCTParagraphComponentView"), NSSelectorFromString(@"updateLayoutMetrics:oldLayoutMetrics:"), &textLayouts);
    {
      // Which views' layers are displayed, by class and size.
      displays = [NSMutableDictionary dictionary];
      Class backing = NSClassFromString(@"NSViewBackingLayer");
      Method method = class_getInstanceMethod(backing, @selector(display));
      IMP original = method_getImplementation(method);
      class_replaceMethod(backing, @selector(display), imp_implementationWithBlock(^(CALayer *self) {
        if (displaysOn) {
          NSView *owner = (NSView *)self.delegate;
          NSString *key = [NSString stringWithFormat:@"%@ %@%@", owner.className, NSHeight(owner.frame) > 10000 ? @"huge" : NSHeight(owner.frame) > 100 ? @"tall" : @"small",
                                                      owner.wantsUpdateLayer ? @"" : @" draws"];
          displays[key] = @(displays[key].unsignedIntegerValue + 1);
        }
        ((void (*)(id, SEL))original)(self, @selector(display));
      }), method_getTypeEncoding(method));
    }
    Class view = NSClassFromString(@"RCTViewComponentView");
    CountMethod2(view, NSSelectorFromString(@"mountChildComponentView:index:"), &viewsPutIn);
    CountMethod2(view, NSSelectorFromString(@"unmountChildComponentView:index:"), &viewsTakenOut);
    CountMethod2(view, NSSelectorFromString(@"updateProps:oldProps:"), &viewProps);
    CountMethod2(view, NSSelectorFromString(@"updateLayoutMetrics:oldLayoutMetrics:"), &viewLayouts);
  });
  textDraws = 0;
  textDrawSeconds = 0;
  mounts = 0;
  mountSeconds = 0;
  textStates = 0;
  textLayouts = 0;
  viewsPutIn = 0;
  viewsTakenOut = 0;
  viewProps = 0;
  viewLayouts = 0;
  whyOn = whyStacks != nil;
  [displays removeAllObjects];
  displaysOn = YES;
  _ticks = [NSMutableArray array];
  _blank = [NSMutableArray array];
  _places = [NSMutableArray array];
  _boxes = [NSMutableArray array];
  _startY = _scroll.contentView.bounds.origin.y;
  _next = 0;
  _delivered = 0;
  _windowField = [self windowField];
  _arrived = 0;
  _arrivedNoWindow = 0;
  _arrivedPhased = 0;
  __weak TableScrollBench *counting = self;
  _monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
    TableScrollBench *me = counting;
    if (me) {
      if (me->_arrived == 0) {
        NSView *root = event.window.contentView.superview ?: event.window.contentView;
        me->_firstArrived = [NSString stringWithFormat:@"at %@ in window %ld, over %@", NSStringFromPoint(event.locationInWindow), (long)event.windowNumber,
                                                       [root hitTest:event.locationInWindow].className];
      }
      me->_arrived++;
      if (event.window == nil) me->_arrivedNoWindow++;
      if (event.phase != NSEventPhaseNone || event.momentumPhase != NSEventPhaseNone) me->_arrivedPhased++;
    }
    return event;
  }];
  if (timeline != nil) {
    __weak NSScrollView *page = _scroll;
    double startY = _startY;
    _moves = [NSNotificationCenter.defaultCenter addObserverForName:NSViewBoundsDidChangeNotification object:_scroll.contentView queue:nil usingBlock:^(__unused NSNotification *note) {
      Note(@"page", [NSString stringWithFormat:@"%.0f", page.contentView.bounds.origin.y - startY]);
    }];
  }
  _link = [_window.contentView displayLinkWithTarget:self selector:@selector(tick:)];
  [_link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  _viewsAtStart = CountViews(_window.contentView.superview ?: _window.contentView);
  _probe = [self probeViews];
  _start = CACurrentMediaTime();
  timelineStart = _start;
  timelineOn = timeline != nil;
  __weak TableScrollBench *weak = self;
  if (_listen) {
    // Nothing is sent from here: the scrolling comes from outside, and this only measures.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(_listenSeconds * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      [weak end];
    });
    return;
  }
  // Queued events are put on the app's queue from another thread, as the system's arrive whatever the main thread is doing.
  _timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, _queued ? dispatch_get_global_queue(QOS_CLASS_USER_INTERACTIVE, 0) : dispatch_get_main_queue());
  dispatch_source_set_timer(_timer, DISPATCH_TIME_NOW, NSEC_PER_SEC / 120, NSEC_PER_MSEC);
  dispatch_source_set_event_handler(_timer, ^{
    [weak deliver];
  });
  dispatch_resume(_timer);
}

- (void)post:(int)dy phase:(int)phase momentum:(int)momentum
{
  if (!_gesture) {
    // A wheel has no phases: only what moves the page is sent.
    if (dy == 0) return;
    phase = 0;
    momentum = 0;
  }
  CGEventRef scroll = CGEventCreateScrollWheelEvent2(NULL, kCGScrollEventUnitPixel, 1, dy, 0, 0);
  if (scroll == NULL) return;
  CGEventSetLocation(scroll, _at);
  CGEventSetIntegerValueField(scroll, kCGScrollWheelEventIsContinuous, 1);
  CGEventSetIntegerValueField(scroll, kCGScrollWheelEventScrollPhase, phase);
  CGEventSetIntegerValueField(scroll, kCGScrollWheelEventMomentumPhase, momentum);
  if (_queued && _windowField >= 0) CGEventSetIntegerValueField(scroll, (CGEventField)_windowField, _window.windowNumber);
  NSEvent *event = [NSEvent eventWithCGEvent:scroll];
  CFRelease(scroll);
  if (_queued) {
    [NSApp postEvent:event atStart:NO];
  } else {
    [_target scrollWheel:event];
  }
  _delivered++;
}

/// Which field of a Quartz event becomes an NSEvent's window: found by trying each.
- (int)windowField
{
  NSInteger number = _window.windowNumber;
  for (int field = 0; field < 256; field++) {
    CGEventRef scroll = CGEventCreateScrollWheelEvent2(NULL, kCGScrollEventUnitPixel, 1, -1, 0, 0);
    if (scroll == NULL) return -1;
    CGEventSetIntegerValueField(scroll, (CGEventField)field, number);
    NSEvent *event = CGEventGetType(scroll) == kCGEventScrollWheel ? [NSEvent eventWithCGEvent:scroll] : nil;
    CFRelease(scroll);
    if (event != nil && event.type == NSEventTypeScrollWheel && event.windowNumber == number) return field;
  }
  return -1;
}

/// Everything due by now. A late main thread gets what it missed in one event, as the system coalesces a trackpad's.
- (void)deliver
{
  const BenchEvent *events = _events.bytes;
  NSUInteger count = _events.length / sizeof(BenchEvent);
  double now = CACurrentMediaTime() - _start;
  int owed = 0;
  int phase = 0;
  int momentum = 0;
  BOOL any = NO;
  while (_next < count && events[_next].at <= now) {
    BenchEvent event = events[_next++];
    BOOL moves = _gesture ? (event.phase == 2 || event.momentum == 2) : event.dy != 0;
    if (!moves) {
      if (any) [self post:owed phase:phase momentum:momentum];
      any = NO;
      owed = 0;
      [self post:event.dy phase:event.phase momentum:event.momentum];
      continue;
    }
    if (any && (event.phase != phase || event.momentum != momentum)) {
      [self post:owed phase:phase momentum:momentum];
      owed = 0;
    }
    any = YES;
    owed += event.dy;
    phase = event.phase;
    momentum = event.momentum;
  }
  if (any) [self post:owed phase:phase momentum:momentum];
  if (_next >= count && now > events[count - 1].at + 1.0) {
    dispatch_source_cancel(_timer);
    dispatch_async(dispatch_get_main_queue(), ^{
      [self end];
    });
  }
}

#pragma mark What's measured

- (void)findBoxesIn:(NSView *)view depth:(int)depth
{
  if (depth > 40) return;
  if ([view respondsToSelector:@selector(nativeId)]) {
    NSString *nativeId = [view valueForKey:@"nativeId"];
    if ([nativeId isKindOfClass:NSString.class] && [nativeId isEqualToString:@"table-rows"]) {
      [_boxes addObject:view];
      return;
    }
  }
  for (NSView *subview in view.subviews) [self findBoxesIn:subview depth:depth + 1];
}

/// The share of the table's place on screen with no rows drawn, taking the worse of its panes.
- (double)blankShare
{
  NSView *document = _scroll.documentView;
  [_boxes filterUsingPredicate:[NSPredicate predicateWithBlock:^BOOL(NSView *box, __unused id bindings) {
    return box.window != nil;
  }]];
  if (_boxes.count == 0) [self findBoxesIn:document depth:0];
  NSRect visible = _scroll.contentView.bounds;
  double top = NSMinY(visible) + _scroll.contentInsets.top;
  double bottom = NSMaxY(visible);
  double worst = 0;
  for (NSView *box in _boxes) {
    // The box's parent has the whole list's height: where rows belong.
    NSRect whole = [box.superview convertRect:box.superview.bounds toView:document];
    NSRect drawn = [box convertRect:box.bounds toView:document];
    double from = MAX(top, NSMinY(whole));
    double to = MIN(bottom, NSMaxY(whole));
    if (to - from < 1) continue;
    double covered = MAX(0, MIN(to, NSMaxY(drawn)) - MAX(from, NSMinY(drawn)));
    worst = MAX(worst, 1 - covered / (to - from));
  }
  return worst;
}

- (void)tick:(CADisplayLink *)link
{
  _frame = link.duration;
  [_ticks addObject:@(CACurrentMediaTime() - _start)];
  [_blank addObject:@([self blankShare])];
  [_places addObject:@(_scroll.contentView.bounds.origin.y - _startY)];
  if (timelineOn && _boxes.count) {
    NSView *box = _boxes.lastObject;
    NSRect drawn = [box convertRect:box.bounds toView:_scroll.documentView];
    double y = _scroll.contentView.bounds.origin.y;
    Note(@"shown", [NSString stringWithFormat:@"page %.0f; rows drawn from %.0f above the screen's top to %.0f below its bottom", y - _startY, y - NSMinY(drawn), NSMaxY(drawn) - NSMaxY(_scroll.contentView.bounds)]);
  }
}

- (void)end
{
  whyOn = NO;
  displaysOn = NO;
  timelineOn = NO;
  if (_moves != nil) [NSNotificationCenter.defaultCenter removeObserver:_moves];
  if (_timer != nil && !dispatch_source_testcancel(_timer)) dispatch_source_cancel(_timer);
  _timer = nil;
  if (_monitor != nil) [NSEvent removeMonitor:_monitor];
  _monitor = nil;
  [_link invalidate];
  _link = nil;
  double took = CACurrentMediaTime() - _start;
  double frame = _frame > 0 ? _frame : 1.0 / 60;
  NSUInteger missed = 0;
  NSUInteger late = 0;
  double over = 0;
  NSMutableArray<NSNumber *> *gaps = [NSMutableArray array];
  for (NSUInteger i = 1; i < _ticks.count; i++) {
    double gap = _ticks[i].doubleValue - _ticks[i - 1].doubleValue;
    [gaps addObject:@(gap)];
    if (gap > frame * 1.5) {
      late++;
      missed += (NSUInteger)llround(gap / frame) - 1;
      over += gap - frame;
    }
  }
  [gaps sortUsingSelector:@selector(compare:)];
  double (^at)(double) = ^double(double share) {
    return gaps.count ? gaps[(NSUInteger)MIN(gaps.count - 1, floor(share * gaps.count))].doubleValue * 1000 : 0;
  };
  double sum = 0;
  double worst = 0;
  NSUInteger some = 0;
  NSUInteger half = 0;
  for (NSNumber *share in _blank) {
    sum += share.doubleValue;
    worst = MAX(worst, share.doubleValue);
    if (share.doubleValue > 0.01) some++;
    if (share.doubleValue >= 0.5) half++;
  }
  // The same share, second by second: when in the run the table's place was empty.
  NSMutableArray<NSNumber *> *bySecond = [NSMutableArray array];
  {
    double total = 0;
    NSUInteger counted = 0;
    NSUInteger second = 0;
    for (NSUInteger i = 0; i < _blank.count; i++) {
      NSUInteger at = (NSUInteger)floor(_ticks[i].doubleValue);
      if (at != second) {
        [bySecond addObject:@(counted ? round(100 * total / counted) : -1)];
        for (second++; second < at; second++) [bySecond addObject:@(-1)];
        total = 0;
        counted = 0;
      }
      total += _blank[i].doubleValue;
      counted++;
    }
    if (counted) [bySecond addObject:@(round(100 * total / counted))];
  }
  // And tenth by tenth for the first four seconds, with where the page was: how a scroll starts.
  NSMutableArray<NSString *> *byTenth = [NSMutableArray array];
  {
    NSUInteger i = 0;
    for (NSUInteger tenth = 0; tenth < 40 && i < _blank.count; tenth++) {
      double total = 0;
      NSUInteger counted = 0;
      double place = -1;
      for (; i < _blank.count && _ticks[i].doubleValue < (tenth + 1) * 0.1; i++) {
        total += _blank[i].doubleValue;
        counted++;
        place = _places[i].doubleValue;
      }
      [byTenth addObject:counted ? [NSString stringWithFormat:@"%.0f%% at %.0f (%lu)", 100 * total / counted, place, (unsigned long)counted] : @"-"];
    }
  }
  NSUInteger n = MAX((NSUInteger)1, _blank.count);
  [self finishWith:@{
    @"script": _script,
    @"responsive": @([NSClassFromString(@"RCTEnhancedScrollView") isCompatibleWithResponsiveScrolling]),
    @"as": _listen ? @"listening" : _gesture ? (_queued ? @"gesture, queued" : @"gesture") : (_queued ? @"wheel, queued" : @"wheel"),
    @"arrived": @{@"events": @(_arrived), @"withoutWindow": @(_arrivedNoWindow), @"phased": @(_arrivedPhased), @"windowField": @(_windowField), @"window": @(_window.windowNumber), @"first": _firstArrived ?: @"", @"target": [NSString stringWithFormat:@"%@ at %@", _target.className, NSStringFromPoint([_window convertPointFromScreen:NSMakePoint(_at.x, NSMaxY(NSScreen.screens.firstObject.frame) - _at.y)])]},
    @"seconds": @(took),
    @"events": @{@"written": @(_events.length / sizeof(BenchEvent)), @"delivered": @(_delivered)},
    @"moved": @{@"asked": @(-_asked), @"scrolled": @(_scroll.contentView.bounds.origin.y - _startY)},
    @"frames": @{
      @"refreshMs": @(frame * 1000),
      @"answered": @(_ticks.count),
      @"missed": @(missed),
      @"missedShare": @((double)missed / MAX(1.0, (double)(missed + _ticks.count))),
      @"lateSeconds": @(over),
      @"gapMs": @{@"median": @(at(0.5)), @"p95": @(at(0.95)), @"p99": @(at(0.99)), @"longest": @(at(1.0))},
    },
    @"text": @{@"draws": @(textDraws), @"seconds": @(textDrawSeconds), @"stateUpdates": @(textStates), @"layoutUpdates": @(textLayouts)},
    @"around": [self aroundTheMiddle],
    @"mounts": @{@"count": @(mounts), @"seconds": @(mountSeconds), @"viewsPutIn": @(viewsPutIn), @"viewsTakenOut": @(viewsTakenOut), @"propsChanged": @(viewProps), @"layoutsChanged": @(viewLayouts)},
    @"why": whyStacks ?: @{},
    @"timeline": timeline ?: @[],
    @"viewsAtStart": _viewsAtStart ?: @{},
    @"probe": _probe ?: @{},
    @"probeAtEnd": [self probeViews],
    @"viewsAtEnd": CountViews(_window.contentView.superview ?: _window.contentView),
    @"sublayers": @([self layersUnder:_window.contentView.superview.layer ?: _window.contentView.layer]),
    @"displays": [displays copy] ?: @{},
    @"blank": @{
      @"panes": @(_boxes.count),
      @"meanShare": @(sum / n),
      @"worstShare": @(worst),
      @"framesWithAny": @((double)some / n),
      @"framesHalfOrMore": @((double)half / n),
      @"percentBySecond": bySecond,
      @"byTenth": byTenth,
    },
  }];
}

/// How many views are under `view`, how many are hidden or have no window, the most children any one has, and the commonest classes.
static NSDictionary *CountViews(NSView *root)
{
  NSUInteger total = 0;
  NSUInteger hidden = 0;
  NSUInteger most = 0;
  NSString *mostOf = @"";
  NSCountedSet<NSString *> *classes = [NSCountedSet set];
  NSMutableArray<NSView *> *stack = [NSMutableArray arrayWithObject:root];
  while (stack.count) {
    NSView *view = stack.lastObject;
    [stack removeLastObject];
    total++;
    if (view.isHidden) hidden++;
    [classes addObject:view.className];
    NSArray<NSView *> *subviews = view.subviews;
    if (subviews.count > most) {
      most = subviews.count;
      mostOf = [NSString stringWithFormat:@"%@ %.0fx%.0f", view.className, NSWidth(view.frame), NSHeight(view.frame)];
    }
    [stack addObjectsFromArray:subviews];
  }
  NSMutableDictionary *byClass = [NSMutableDictionary dictionary];
  for (NSString *name in classes) {
    if ([classes countForObject:name] * 50 > total) byClass[name] = @([classes countForObject:name]);
  }
  return @{@"views": @(total), @"hidden": @(hidden), @"mostChildren": @(most), @"mostChildrenOf": mostOf, @"byClass": byClass};
}

/// A text view near the middle of the window, and the views around it.
- (NSArray<NSString *> *)aroundTheMiddle
{
  NSView *root = _window.contentView.superview ?: _window.contentView;
  NSView *hit = [root hitTest:NSMakePoint(NSWidth(_window.frame) * 0.6, NSHeight(_window.frame) * 0.4)];
  Class text = NSClassFromString(@"RCTParagraphTextView");
  for (NSView *at = hit; at != nil; at = at.superview) {
    NSView *found = FirstOfClass(at, text, 0);
    if (found) return ChainFrom(found);
  }
  return @[];
}

/// What it costs, now, to put 300 plain views into the page, lay them out, move them and take them
/// out again: AppKit's own work for views coming and going, with nothing of React's in it.
- (NSDictionary *)probeViews
{
  NSView *into = _scroll.documentView;
  NSMutableArray<NSView *> *views = [NSMutableArray array];
  for (int i = 0; i < 300; i++) [views addObject:[[NSView alloc] initWithFrame:NSMakeRect(10 + (i % 20) * 12, _scroll.contentView.bounds.origin.y + 10 + (i / 20) * 12, 10, 10)]];
  CFTimeInterval began = CACurrentMediaTime();
  for (NSView *view in views) [into addSubview:view];
  CFTimeInterval added = CACurrentMediaTime();
  [into layoutSubtreeIfNeeded];
  CFTimeInterval laidOut = CACurrentMediaTime();
  for (NSView *view in views) [view setFrameOrigin:NSMakePoint(view.frame.origin.x + 1, view.frame.origin.y + 1)];
  [into layoutSubtreeIfNeeded];
  CFTimeInterval moved = CACurrentMediaTime();
  for (NSView *view in views) [view removeFromSuperview];
  CFTimeInterval removed = CACurrentMediaTime();
  return @{
    @"addMs": @((added - began) * 1000),
    @"layoutMs": @((laidOut - added) * 1000),
    @"moveMs": @((moved - laidOut) * 1000),
    @"removeMs": @((removed - moved) * 1000),
  };
}

- (NSUInteger)layersUnder:(CALayer *)layer
{
  NSUInteger total = 1;
  for (CALayer *sublayer in layer.sublayers) total += [self layersUnder:sublayer];
  return total;
}

- (void)finishWith:(NSDictionary *)result
{
  NSData *json = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted | NSJSONWritingSortedKeys error:nil];
  [json writeToFile:_out atomically:YES];
  if (_quit) [NSApp terminate:nil];
}

@end
