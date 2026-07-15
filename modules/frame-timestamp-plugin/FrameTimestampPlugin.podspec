require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "FrameTimestampPlugin"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/matiassimone/sapiar"
  s.license      = "MIT"
  s.authors      = "Matias Simone"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/matiassimone/sapiar.git" }

  s.source_files = [
    "ios/**/*.{swift}",
    "ios/**/*.{m,mm}",
  ]

  load 'nitrogen/generated/ios/FrameTimestampPlugin+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'VisionCamera'
  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
