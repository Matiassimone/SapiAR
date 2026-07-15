require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'ExpoGps'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.author         = 'Matias Simone'
  s.homepage       = 'https://github.com/matiassimone/sapiar'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: 'https://github.com/matiassimone/sapiar.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.swift'
end
