package sh.workspace.edn

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Autolinking's entry point: the one module, as a TurboModule (its bindings are installed only for one). */
class WorkspaceEdnPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == WorkspaceEdnModule.NAME) WorkspaceEdnModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      WorkspaceEdnModule.NAME to ReactModuleInfo(
        WorkspaceEdnModule.NAME,
        WorkspaceEdnModule::class.java.name,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true,
      ),
    )
  }
}
