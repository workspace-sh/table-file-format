// The core in the iOS and Mac apps: the C binding (edn/crates/ffi) put on
// `globalThis.__workspaceEdn` as the calls @workspace.sh/edn/jsi
// takes (src/api.ts, `Calls`), with the same results as the WebAssembly
// and Node bindings. React Native installs it when the module is first
// asked for (`NativeModules.WorkspaceEdn`), before `jsiEdn()` reads it.
//
// Calls are synchronous on the JavaScript thread. An error is thrown as an
// Error whose message is its JSON ({message, line, column}), as Node's
// binding throws it.

#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>
#import <ReactCommon/RCTTurboModuleWithJSIBindings.h>
#pragma clang diagnostic ignored "-Wdeprecated-implementations"
#include <jsi/jsi.h>
#include <cstring>
#include <string>

#include "workspace_edn.h"

using namespace facebook;

@interface WorkspaceEdn : NSObject <RCTBridgeModule, RCTTurboModule, RCTTurboModuleWithJSIBindings>
@end

namespace {

std::string taken(EdnBytes b)
{
  std::string s(reinterpret_cast<const char *>(b.ptr), b.len);
  edn_bytes_free(b);
  return s;
}

jsi::Function textCall(jsi::Runtime &rt, const char *name, int32_t (*f)(const uint8_t *, size_t, EdnBytes *))
{
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, name), 1,
      [f](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count < 1 || !args[0].isString()) throw jsi::JSError(rt, "expected a string");
        std::string in = args[0].asString(rt).utf8(rt);
        EdnBytes out;
        int32_t status = f(reinterpret_cast<const uint8_t *>(in.data()), in.size(), &out);
        std::string s = taken(out);
        if (status != 0) throw jsi::JSError(rt, s);
        return jsi::String::createFromUtf8(rt, s);
      });
}

// `call(op, input)`: a .table engine operation, its input and answer JSON text (never throws: a
// mistake is {"error": ...}). `callCheck(op, text)` and `callNumber(op, text)`: the per-cell
// exception, a check or number of one text, undefined when op isn't one.
jsi::Function tableCall(jsi::Runtime &rt)
{
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "call"), 2,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count < 2 || !args[0].isString() || !args[1].isString()) throw jsi::JSError(rt, "expected two strings");
        std::string op = args[0].asString(rt).utf8(rt);
        std::string input = args[1].asString(rt).utf8(rt);
        char *out = edn_call(op.c_str(), input.c_str());
        if (!out) throw jsi::JSError(rt, "the engine gave no answer");
        jsi::String answer = jsi::String::createFromUtf8(rt, out);
        edn_call_free(out);
        return answer;
      });
}

jsi::Function tableTextCall(jsi::Runtime &rt, const char *name, bool check)
{
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, name), 2,
      [check](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count < 2 || !args[0].isString() || !args[1].isString()) throw jsi::JSError(rt, "expected two strings");
        std::string op = args[0].asString(rt).utf8(rt);
        std::string in = args[1].asString(rt).utf8(rt);
        const uint8_t *t = reinterpret_cast<const uint8_t *>(in.data());
        if (check) {
          int32_t answer = edn_call_check(op.c_str(), t, in.size());
          return answer < 0 ? jsi::Value::undefined() : jsi::Value(answer == 1);
        }
        double n = 0;
        return edn_call_number(op.c_str(), t, in.size(), &n) != 0 ? jsi::Value::undefined() : jsi::Value(n);
      });
}

// A new typed array (`Uint8Array`, `Float64Array`) holding `bytes`, made by its own constructor so it works on any JSI runtime.
jsi::Object typedArray(jsi::Runtime &rt, const char *type, const void *bytes, size_t length, size_t size)
{
  jsi::Object array = rt.global().getPropertyAsFunction(rt, type).callAsConstructor(rt, static_cast<double>(length)).asObject(rt);
  if (length > 0) {
    jsi::ArrayBuffer buffer = array.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
    std::memcpy(buffer.data(rt), bytes, length * size);
  }
  return array;
}

// `callBytes(op, input, bytes)`: an operation that takes a file's bytes (a Uint8Array).
// `callWindow(op, input)`: rows as typed arrays and one string, or throws {"error": ...}.
jsi::Function tableBytesCall(jsi::Runtime &rt)
{
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "callBytes"), 3,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count < 3 || !args[0].isString() || !args[1].isString() || !args[2].isObject()) throw jsi::JSError(rt, "expected two strings and a Uint8Array");
        std::string op = args[0].asString(rt).utf8(rt);
        std::string input = args[1].asString(rt).utf8(rt);
        jsi::Object bytes = args[2].asObject(rt);
        jsi::ArrayBuffer buffer = bytes.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
        size_t offset = static_cast<size_t>(bytes.getProperty(rt, "byteOffset").asNumber());
        size_t length = static_cast<size_t>(bytes.getProperty(rt, "length").asNumber());
        char *out = edn_call_bytes(op.c_str(), input.c_str(), buffer.data(rt) + offset, length);
        if (!out) throw jsi::JSError(rt, "the engine gave no answer");
        jsi::String answer = jsi::String::createFromUtf8(rt, out);
        edn_call_free(out);
        return answer;
      });
}

jsi::Function tableWindowCall(jsi::Runtime &rt)
{
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "callWindow"), 2,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count < 2 || !args[0].isString() || !args[1].isString()) throw jsi::JSError(rt, "expected two strings");
        std::string op = args[0].asString(rt).utf8(rt);
        std::string input = args[1].asString(rt).utf8(rt);
        EdnWindow w;
        char *error = nullptr;
        if (edn_call_window(op.c_str(), input.c_str(), &w, &error) != 0) {
          std::string message = error ? error : "{\"error\":\"the engine gave no answer\"}";
          edn_call_free(error);
          throw jsi::JSError(rt, message);
        }
        jsi::Object out(rt);
        out.setProperty(rt, "entries", typedArray(rt, "Uint16Array", w.entries, w.entries_len, sizeof(uint16_t)));
        out.setProperty(rt, "kinds", typedArray(rt, "Uint8Array", w.kinds.ptr, w.kinds.len, 1));
        out.setProperty(rt, "numbers", typedArray(rt, "Float64Array", w.numbers, w.numbers_len, sizeof(double)));
        out.setProperty(rt, "texts", jsi::String::createFromUtf8(rt, w.texts.ptr, w.texts.len));
        out.setProperty(rt, "ends", typedArray(rt, "Uint32Array", w.ends, w.ends_len, sizeof(uint32_t)));
        edn_window_free(w);
        return out;
      });
}

jsi::Function computeWorkbook(jsi::Runtime &rt)
{
  return jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "computeWorkbook"), 2,
      [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
        if (count < 2 || !args[0].isString() || !args[1].isObject()) throw jsi::JSError(rt, "expected a string and a Float64Array");
        std::string json = args[0].asString(rt).utf8(rt);
        jsi::Object numbers = args[1].asObject(rt);
        jsi::ArrayBuffer buffer = numbers.getPropertyAsObject(rt, "buffer").getArrayBuffer(rt);
        size_t offset = static_cast<size_t>(numbers.getProperty(rt, "byteOffset").asNumber());
        size_t length = static_cast<size_t>(numbers.getProperty(rt, "length").asNumber());
        const double *data = reinterpret_cast<const double *>(buffer.data(rt) + offset);

        EdnColumns columns;
        EdnBytes error;
        if (edn_compute_workbook(reinterpret_cast<const uint8_t *>(json.data()), json.size(), data, length, &columns, &error) != 0)
          throw jsi::JSError(rt, taken(error));

        jsi::Object out(rt);
        out.setProperty(rt, "kinds", typedArray(rt, "Uint8Array", columns.kinds.ptr, columns.kinds.len, 1));
        out.setProperty(rt, "numbers", typedArray(rt, "Float64Array", columns.numbers, columns.numbers_len, sizeof(double)));
        out.setProperty(rt, "extra", jsi::String::createFromUtf8(rt, reinterpret_cast<const uint8_t *>(columns.extra.ptr), columns.extra.len));
        out.setProperty(rt, "index", jsi::String::createFromUtf8(rt, reinterpret_cast<const uint8_t *>(columns.index.ptr), columns.index.len));
        edn_columns_free(columns);
        return out;
      });
}

} // namespace

@implementation WorkspaceEdn

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

// React Native installs a module's JSI bindings only for a TurboModule, one
// that answers getTurboModule: (RCTTurboModuleManager). It has no methods of
// its own: its calls are the bindings.
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::ObjCTurboModule>(params);
}

// React Native asks for one of these two (the second is older, and is what
// a react-native-macos without the first asks for).
- (void)installJSIBindingsWithRuntime:(jsi::Runtime &)rt
                          callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker
{
  [self installJSIBindingsWithRuntime:rt];
}

- (void)installJSIBindingsWithRuntime:(jsi::Runtime &)rt
{
  jsi::Object edn(rt);
  edn.setProperty(rt, "canonical", textCall(rt, "canonical", edn_canonical));
  edn.setProperty(rt, "read", textCall(rt, "read", edn_read));
  edn.setProperty(rt, "formula", textCall(rt, "formula", edn_formula));
  edn.setProperty(rt, "computeWorkbook", computeWorkbook(rt));
  edn.setProperty(rt, "call", tableCall(rt));
  edn.setProperty(rt, "callCheck", tableTextCall(rt, "callCheck", true));
  edn.setProperty(rt, "callNumber", tableTextCall(rt, "callNumber", false));
  edn.setProperty(rt, "callBytes", tableBytesCall(rt));
  edn.setProperty(rt, "callWindow", tableWindowCall(rt));
  rt.global().setProperty(rt, "__workspaceEdn", edn);
}

@end
