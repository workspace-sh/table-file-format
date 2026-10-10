Pod::Spec.new do |s|
  s.name           = 'TableFiles'
  s.version        = '1.0.0'
  s.summary        = 'Replacing a file in one step, for the .table writer'
  s.description    = 'rename(2) for the phone: core\'s writer stages a file and moves it over its target atomically.'
  s.author         = 'workspace.sh'
  s.homepage       = 'https://github.com/workspace-sh/table-file-format'
  s.license        = 'MIT'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version  = '5.9'
  s.source_files   = '**/*.swift'
end
