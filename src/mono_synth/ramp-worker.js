// Dedicated clock, independent of animation frames and page visibility.
let timer;
self.onmessage = ({ data }) => {
  clearInterval(timer);
  timer = null;
  if (data === "start") timer = setInterval(() => self.postMessage("tick"), 8);
};
