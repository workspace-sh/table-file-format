#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(TableSidebar, RCTEventEmitter)

RCT_EXTERN_METHOD(setModel:(NSString *)json)
RCT_EXTERN_METHOD(pick:(NSString *)tag)
RCT_EXTERN_METHOD(toggle)

@end
