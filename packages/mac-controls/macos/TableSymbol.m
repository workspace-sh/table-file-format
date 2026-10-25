// An SF Symbol, as a React Native view, for the .table library's views on
// the Mac (table-ui's ErrorMark.macos.tsx draws a failed formula's kind with
// it). React Native macOS has no way of its own to draw one.

#import <AppKit/AppKit.h>
#import <React/RCTViewManager.h>

@interface TableSymbolView : NSImageView
@property (nonatomic, copy) NSString *name;
@property (nonatomic, assign) CGFloat pointSize;
@property (nonatomic, copy) NSString *tint;
@end

@implementation TableSymbolView

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    self.imageScaling = NSImageScaleProportionallyUpOrDown;
    _pointSize = 13;
  }
  return self;
}

- (void)setName:(NSString *)name { _name = [name copy]; [self redraw]; }
- (void)setPointSize:(CGFloat)pointSize { _pointSize = pointSize; [self redraw]; }
- (void)setTint:(NSString *)tint { _tint = [tint copy]; [self redraw]; }

/// A system colour by its name ("systemRed"), else the label's.
static NSColor *ColorNamed(NSString *name)
{
  SEL sel = NSSelectorFromString([name stringByAppendingString:@"Color"]);
  if (name.length > 0 && [NSColor respondsToSelector:sel]) {
    return ((NSColor * (*)(id, SEL))[NSColor methodForSelector:sel])(NSColor.class, sel);
  }
  return NSColor.labelColor;
}

- (void)redraw
{
  if (_name.length == 0) {
    self.image = nil;
    return;
  }
  NSImage *image = [NSImage imageWithSystemSymbolName:_name accessibilityDescription:nil];
  NSImageSymbolConfiguration *config = [NSImageSymbolConfiguration configurationWithPointSize:_pointSize weight:NSFontWeightMedium];
  self.image = [image imageWithSymbolConfiguration:config];
  self.contentTintColor = ColorNamed(_tint);
}

@end

@interface TableSymbolManager : RCTViewManager
@end

@implementation TableSymbolManager

RCT_EXPORT_MODULE(TableSymbol)

- (RCTPlatformView *)view
{
  return [[TableSymbolView alloc] initWithFrame:NSZeroRect];
}

RCT_EXPORT_VIEW_PROPERTY(name, NSString)
RCT_EXPORT_VIEW_PROPERTY(pointSize, CGFloat)
RCT_EXPORT_VIEW_PROPERTY(tint, NSString)

@end
