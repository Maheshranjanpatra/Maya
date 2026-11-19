export function startTimer(seconds = 25 * 60, onDone = () => {}, onTick = () => {}) {
  let remaining = seconds;
  let interval;
  let running = false;
  let deadline = 0;

  const timer = {
    get remaining() {
      return remaining;
    },
    get running() {
      return running;
    },
    start() {
      if (running) return;
      running = true;
      deadline = Date.now() + remaining * 1000;
      interval = window.setInterval(() => {
        remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        onTick(remaining);
        if (remaining === 0) {
          timer.pause();
          onDone();
        }
      }, 1000);
    },
    pause() {
      if (running) {
        remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        onTick(remaining);
      }
      running = false;
      window.clearInterval(interval);
    },
    cancel() {
      timer.pause();
      remaining = seconds;
      onTick(remaining);
    }
  };
  return timer;
}

export function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}
