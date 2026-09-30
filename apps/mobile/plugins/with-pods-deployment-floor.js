const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("expo/config-plugins");

// Raise every pod to the app's own deployment target. Pods keep the minimum
// their podspec declares (RNSVG's filters 12.4, for one), and Xcode 27
// rejects anything under 15.0. A pod can never run below the app that
// embeds it, so the app's target is the honest floor.
const BEGIN = "    # >>> with-pods-deployment-floor";
const END = "    # <<< with-pods-deployment-floor\n";
const SNIPPET = `${BEGIN}
    app_target = podfile_properties['ios.deploymentTarget'] || '15.1'
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        current = build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current && Gem::Version.new(current) < Gem::Version.new(app_target)
          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = app_target
        end
      end
    end
${END}`;

module.exports = function withPodsDeploymentFloor(config) {
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, "Podfile");
      let source = fs.readFileSync(podfile, "utf8");
      const start = source.indexOf(BEGIN);
      if (start !== -1) {
        source = source.slice(0, start) + source.slice(source.indexOf(END, start) + END.length);
      }
      const hook = "post_install do |installer|\n";
      if (!source.includes(hook)) {
        throw new Error("with-pods-deployment-floor: no post_install block in the Podfile");
      }
      fs.writeFileSync(podfile, source.replace(hook, hook + SNIPPET));
      return config;
    },
  ]);
};
