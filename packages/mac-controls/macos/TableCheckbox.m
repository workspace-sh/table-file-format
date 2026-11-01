// The system's checkbox for the .table library's Toggle slot on the Mac
// (src/index.tsx's MacToggle): a boolean cell and a setting's box. React
// Native macOS has none of its own, and table-ui's default is a square drawn
// with a tick in it.
//
// Controlled, as React's inputs are: a click asks for the other value
// (onChange) and leaves the box as it was until `checked` says otherwise.

#import <AppKit/AppKit.h>
#import <React/RCTComponent.h>
#import <React/RCTViewManager.h>

@interface TableCheckboxView : NSButton
@property (nonatomic, assign) BOOL checked;
@property (nonatomic, copy) RCTBubblingEventBlock onChange;
@end

@implementation TableCheckboxView

- (instancetype)initWithFrame:(NSRect)frame
{
  if ((self = [super initWithFrame:frame])) {
    [self setButtonType:NSButtonTypeSwitch];
    self.title = @"";
    self.imagePosition = NSImageOnly;
    self.target = self;
    self.action = @selector(clicked:);
  }
  return self;
}

- (void)setChecked:(BOOL)checked
{
  _checked = checked;
  self.state = checked ? NSControlStateValueOn : NSControlStateValueOff;
}

- (void)clicked:(id)sender
{
  BOOL wanted = !_checked;
  self.state = _checked ? NSControlStateValueOn : NSControlStateValueOff;
  if (self.onChange) self.onChange(@{@"checked" : @(wanted)});
}

@end

@interface TableCheckboxManager : RCTViewManager
@end

@implementation TableCheckboxManager

RCT_EXPORT_MODULE(TableCheckbox)

- (RCTPlatformView *)view
{
  return [[TableCheckboxView alloc] initWithFrame:NSZeroRect];
}

RCT_EXPORT_VIEW_PROPERTY(checked, BOOL)
RCT_EXPORT_VIEW_PROPERTY(onChange, RCTBubblingEventBlock)
RCT_CUSTOM_VIEW_PROPERTY(label, NSString, TableCheckboxView)
{
  view.accessibilityLabel = json ? [RCTConvert NSString:json] : nil;
}

@end
