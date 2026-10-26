# The core in the iOS and Mac apps (apple/WorkspaceEdn.mm): the Rust core's
# C binding (edn/crates/ffi), built by build-apple.sh into
# apple/WorkspaceEdn.xcframework, put on the JavaScript runtime for
# @workspace.sh/edn/jsi, its header with it. Run build-apple.sh before
# `pod install`.
Pod::Spec.new do |s|
  s.name         = "WorkspaceEdn"
  s.version      = "0.1.0"
  s.summary      = "Workspace's EDN and formula core (Rust) for React Native on iOS and macOS, through JSI."
  s.license      = "MIT"
  s.author       = "workspace.sh"
  s.homepage     = "https://github.com/workspace-sh/table-file-format"
  s.source       = { :path => "." }
  s.platforms    = { :ios => "26.0", :osx => "26.0" }
  s.source_files = "apple/*.{h,mm}"
  # The core as a dynamic framework (build-apple.sh), embedded in the app.
  s.vendored_frameworks = "apple/WorkspaceEdnCore.xcframework"
  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "HEADER_SEARCH_PATHS" => "\"$(PODS_XCFRAMEWORKS_BUILD_DIR)/WorkspaceEdn/WorkspaceEdnCore.framework/Headers\""
  }
  install_modules_dependencies(s)
end
