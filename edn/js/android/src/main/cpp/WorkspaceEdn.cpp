// The core in the Android apps: the C binding (edn/crates/ffi) put on
// `globalThis.__workspaceEdn` as the four calls @workspace.sh/edn/jsi takes
// (src/api.ts, `Calls`), the same as apple/WorkspaceEdn.mm does on Apple.
// React Native installs it when the module is first asked for
// (`NativeModules.WorkspaceEdn`): WorkspaceEdnModule is a TurboModule with
// JSI bindings, and this is its getBindingsInstaller.
//
// Calls are synchronous on the JavaScript thread. An error is thrown as an
// Error whose message is its JSON ({message, line, column}).

#include <fbjni/fbjni.h>
#include <jsi/jsi.h>
#include <ReactCommon/BindingsInstallerHolder.h>
#include <cstring>
#include <string>

#include "workspace_edn.h"

using namespace facebook;

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

void install(jsi::Runtime &rt)
{
  jsi::Object edn(rt);
  edn.setProperty(rt, "canonical", textCall(rt, "canonical", edn_canonical));
  edn.setProperty(rt, "read", textCall(rt, "read", edn_read));
  edn.setProperty(rt, "formula", textCall(rt, "formula", edn_formula));
  edn.setProperty(rt, "computeWorkbook", computeWorkbook(rt));
  rt.global().setProperty(rt, "__workspaceEdn", edn);
}

// sh.workspace.edn.WorkspaceEdnModule, whose getBindingsInstaller is this.
struct WorkspaceEdnModule : jni::JavaClass<WorkspaceEdnModule> {
  static constexpr auto kJavaDescriptor = "Lsh/workspace/edn/WorkspaceEdnModule;";

  static jni::local_ref<react::BindingsInstallerHolder::javaobject> getBindingsInstaller(jni::alias_ref<WorkspaceEdnModule>)
  {
    return react::BindingsInstallerHolder::newObjectCxxArgs(
        [](jsi::Runtime &rt, const std::shared_ptr<react::CallInvoker> &) { install(rt); });
  }

  static void registerNatives()
  {
    javaClassStatic()->registerNatives({makeNativeMethod("getBindingsInstaller", WorkspaceEdnModule::getBindingsInstaller)});
  }
};

} // namespace

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *)
{
  return jni::initialize(vm, [] { WorkspaceEdnModule::registerNatives(); });
}
