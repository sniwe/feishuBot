(function () {
  if (window.audioTestAppRuntimeLoaded) {
    window.audioTestAppBootstrap = true;
    return;
  }

  var scripts = [
    "../frontend/modules/auth-storage.js",
    "../frontend/modules/format-utils.js",
    "../frontend/modules/session-runtime.js",
    "../frontend/modules/runtime-logger.js",
    "../frontend/modules/app-runtime.js"
  ];
  var index = 0;

  function loadNext() {
    if (index >= scripts.length) {
      window.audioTestAppBootstrap = true;
      return;
    }

    var script = document.createElement("script");
    script.src = scripts[index++];
    script.onload = loadNext;
    script.onerror = function () {
      console.error("Failed to load audioTest frontend runtime.");
    };
    document.head.appendChild(script);
  }

  loadNext();
})();
