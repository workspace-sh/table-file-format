// A panel's glass, behind what it holds: Liquid Glass on macOS 26
// (NSGlassEffectView), the popover material before it (NSVisualEffectView).
// It has no children of its own; JS draws it first inside the panel, filling
// it, and the panel's content goes on top (see GlassSurface.tsx).
//
// cornerRadius: the panel's corners, which the glass follows.

#import <AppKit/AppKit.h>
#import <React/RCTView.h>
#import <React/RCTViewManager.h>

// An RCTView, so the manager's standard props (pointerEvents and the rest)
// have the setters they call: a plain NSView threw on pointerEvents.
@interface TableGlassView : RCTView
@property (nonatomic) CGFloat cornerRadius;
@end

@implementation TableGlassView {
  NSView *_effect;
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
  }
  return self;
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
