if (process.platform !== "darwin") {
  console.log("iOS builds require macOS with Xcode.");
  console.log("This Windows computer can prepare and sync the iOS project, but it cannot open/build the iOS app.");
  console.log("Use this command only on a Mac:");
  console.log("npx cap open ios");
  process.exit(0);
}

const { spawnSync } = require("child_process");

spawnSync("npx", ["cap", "open", "ios"], {
  stdio: "inherit",
  shell: true
});
