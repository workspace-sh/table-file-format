package sh.workspace.edn

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.turbomodule.core.interfaces.BindingsInstallerHolder
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import com.facebook.react.turbomodule.core.interfaces.TurboModuleWithJSIBindings

/**
 * The formula core on Android, as `apple/WorkspaceEdn.mm` on Apple. It has no
 * methods of its own: its calls are the JSI bindings React Native installs
 * from [getBindingsInstaller] when the module is first asked for
 * (`NativeModules.WorkspaceEdn`), which puts them on
 * `globalThis.__workspaceEdn` (src/main/cpp/WorkspaceEdn.cpp).
 *
 * React Native installs bindings only for a TurboModule, so this is one, and
 * [WorkspaceEdnPackage] says so.
 */
@ReactModule(name = WorkspaceEdnModule.NAME)
class WorkspaceEdnModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), TurboModule, TurboModuleWithJSIBindings {

  override fun getName(): String = NAME

  external override fun getBindingsInstaller(): BindingsInstallerHolder

  companion object {
    const val NAME = "WorkspaceEdn"

    init {
      System.loadLibrary("workspace_edn")
    }
  }
}
