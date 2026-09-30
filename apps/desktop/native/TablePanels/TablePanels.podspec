# The macOS app's own native modules: the system Open and Save panels
# (TablePanels), and its own items in the menu bar (TableMenu).
# No published React Native module covers react-native-macos
# (@react-native-documents/picker is iOS only), so it lives here.
Pod::Spec.new do |s|
  s.name         = "TablePanels"
  s.version      = "0.1.0"
  s.summary      = "The system Open panel for the macOS .table app."
  s.license      = "MIT"
  s.author       = "workspace.sh"
  s.homepage     = "https://github.com/workspace-sh/table-file-format"
  s.source       = { :path => "." }
  s.platforms    = { :osx => "14.0" }
  s.source_files = "*.{h,m,mm}"
  s.frameworks   = "UniformTypeIdentifiers"
  s.dependency "React-Core"
end
