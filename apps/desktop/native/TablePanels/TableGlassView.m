// A panel's glass, holding what the panel shows: Liquid Glass on macOS 26
// (NSGlassEffectView), the popover material before it (NSVisualEffectView).
// The panel's content is this view's React children, and they go inside the
// glass's contentView, the one place AppKit keeps content above the glass.
// Drawn as siblings over a childless glass they were composited under it
// (seen on macOS 27.2): the page's text was blurred away with the backdrop.
//
// cornerRadius: the panel's corners, which the glass follows.

#import <AppKit/AppKit.h>
#import <React/RCTView.h>
#import <React/RCTViewManager.h>

// React lays children out from the top left, so what holds them is flipped.
@interface TableGlassContentView : NSView
@end

@implementation TableGlassContentView

- (BOOL)isFlipped
{
  return YES;
}

@end

// An RCTView, so the manager's standard props (pointerEvents and the rest)
// have the setters they call: a plain NSView threw on pointerEvents.
@interface TableGlassView : RCTView
@property (nonatomic) CGFloat cornerRadius;
@end

@implementation TableGlassView {
  NSView *_effect;
  NSView *_content;
}

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    if (@available(macOS 26.0, *)) {
      _effect = [[NSGlassEffectView alloc] initWithFrame:self.bounds];
    } else {
      NSVisualEffectView *material = [[NSVisualEffectView alloc] initWithFrame:self.bounds];
      material.material = NSVisualEffectMaterialPopover;
      material.blendingMode = NSVisualEffectBlendingModeWithinWindow;
      material.state = NSVisualEffectStateActive;
      material.wantsLayer = YES;
      _effect = material;
    }
    _effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [self addSubview:_effect];

    _content = [[TableGlassContentView alloc] initWithFrame:self.bounds];
    _content.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    if (@available(macOS 26.0, *)) {
      ((NSGlassEffectView *)_effect).contentView = _content;
    } else {
      [self addSubview:_content];
    }
  }
  return self;
}

// React's children go in the content view, in their order, not in this view.
- (void)didUpdateReactSubviews
{
  for (NSView *subview in self.reactSubviews) {
    [_content addSubview:subview];
  }
}

- (void)setCornerRadius:(CGFloat)cornerRadius
{
  _cornerRadius = cornerRadius;
  if (@available(macOS 26.0, *)) {
    ((NSGlassEffectView *)_effect).cornerRadius = cornerRadius;
  } else {
    _effect.layer.cornerRadius = cornerRadius;
    _effect.layer.masksToBounds = YES;
  }
}

- (void)layout
{
  [super layout];
  _effect.frame = self.bounds;
  if (_content.superview == self) {
    _content.frame = self.bounds;
  }
}

@end

@interface TableGlassViewManager : RCTViewManager
@end

@implementation TableGlassViewManager

RCT_EXPORT_MODULE(TableGlassView)

- (NSView *)view
{
  return [TableGlassView new];
}

RCT_EXPORT_VIEW_PROPERTY(cornerRadius, CGFloat)

@end
