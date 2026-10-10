#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(TableSidebar, RCTEventEmitter)

RCT_EXTERN_METHOD(setModel:(NSString *)json)
RCT_EXTERN_METHOD(pick:(NSString *)tag)
RCT_EXTERN_METHOD(setInspectorShown:(BOOL)shown)
RCT_EXTERN_METHOD(setInspectorCell:(NSString *)json)
RCT_EXTERN_METHOD(setSettingsForm:(NSString *)json)
RCT_EXTERN_METHOD(setFormulaEditor:(NSString *)json)
RCT_EXTERN_METHOD(insertInFormula:(NSString *)text cursorBack:(nonnull NSNumber *)cursorBack)
RCT_EXTERN_METHOD(driveFormulaEditor:(NSString *)what text:(NSString *)text)
RCT_EXTERN_METHOD(sendSettingsForm:(NSString *)json)
RCT_EXTERN_METHOD(pressInspectorCell:(NSString *)action)
RCT_EXTERN_METHOD(toggle)

@end
