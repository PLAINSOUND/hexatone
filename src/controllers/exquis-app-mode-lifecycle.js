// The final safety boundary for every App Mode entry/exit request, regardless
// of whether it came from a checkbox, an atomic edit or restored settings.
export function createExquisAppModeLifecycle({ gate, loadDriver, onDriverChange, onError = () => {} }) {
  let generation = 0;
  let driver = null;
  let disposed = false;
  const clearDriver = () => {
    driver?.exit();
    driver = null;
    onDriverChange(null);
  };
  return {
    request(createDriver) {
      if (disposed) return;
      const request = ++generation;
      gate.whenReleased(() => {
        if (disposed || request !== generation) return;
        clearDriver();
        if (!createDriver) return;
        // Loading can outlast the quiet interval. Recheck after it completes,
        // rather than constructing a driver with an obsolete held-pad count.
        Promise.resolve().then(loadDriver).then(module => {
          if (disposed || request !== generation) return;
          gate.whenReleased(() => {
            if (disposed || request !== generation) return;
            driver = createDriver(module, gate.heldPads());
            onDriverChange(driver);
          });
        }).catch(error => {
          if (!disposed && request === generation) onError(error);
        });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      gate.cancelTransition();
      // Unmount/disconnection cannot wait for releases from a departed port.
      clearDriver();
    },
  };
}
