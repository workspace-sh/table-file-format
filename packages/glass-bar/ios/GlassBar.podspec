require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'GlassBar'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = 'MIT'
  s.author         = 'workspace.sh'
  s.homepage       = 'https://github.com/workspace-sh/table-file-format'
  s.platforms      = {
    :ios => '26.0'
  }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/workspace-sh/table-file-format.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The field is a SwiftUI view inside Expo UI's Host, taking its modifiers.
  s.dependency 'ExpoUI'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
