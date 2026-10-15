# The Mac's own controls for table-ui's slots (src/index.tsx): the system's
# pop-up menu for a choice and a row's actions, and the system's date
# picker for a date. Any react-native-macos app that draws the .table
# library's views links it: the .table demo and Workspace.
Pod::Spec.new do |s|
  s.name         = "TableMacControls"
  s.version      = "0.1.0"
  s.summary      = "The system's menus and date picker for the .table library's views on macOS."
  s.license      = "MIT"
  s.author       = "workspace.sh"
  s.homepage     = "https://github.com/workspace-sh/table-file-format"
  s.source       = { :path => "." }
  s.platforms    = { :osx => "14.0" }
  s.source_files = "*.{h,m,swift}"
  s.swift_version = "5.9"
  s.dependency "React-Core"
end
