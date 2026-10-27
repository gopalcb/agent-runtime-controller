/** Serialized reconciliation watcher. The processor owns bounded discovery and change detection. */
function watchFolder(processor, onError, interval = 2000) {
  let closed = false;
  let pending;
  const refresh = () => {
    if (closed) return Promise.reject(new Error('Document watcher closed'));
    if (!pending) pending = Promise.resolve().then(processor).finally(() => { pending = undefined; });
    return pending;
  };
  const timer = setInterval(() => { void refresh().catch(onError); }, interval);
  timer.unref();
  return {
    refresh,
    async close() { closed = true; clearInterval(timer); await pending?.catch(() => {}); },
  };
}
module.exports = { watchFolder };
