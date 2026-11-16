export function startStream({ url, onMessage, onReconnect, onError }) {
  let stopped = false;
  let controller;
  let retry = 1000;
  let firstConnect = true;

  async function run() {
    while (!stopped) {
      controller = new AbortController();
      try {
        const res = await fetch(url, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("stream HTTP " + res.status);

        if (!firstConnect) onReconnect?.();
        firstConnect = false;
        retry = 1000;

        const decoder = new TextDecoder();
        let buf = "";
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = block.split("\n").find((l) => l.startsWith("data:"));
            if (line) {
              try { onMessage(JSON.parse(line.slice(5).trim())); } catch {}
            }
          }
        }
      } catch (err) {
        if (stopped) return;
        onError?.(err);
      }
      if (stopped) return;
      await new Promise((r) => setTimeout(r, retry));
      retry = Math.min(retry * 2, 30000);
    }
  }

  run();
  return () => { stopped = true; controller?.abort(); };
}